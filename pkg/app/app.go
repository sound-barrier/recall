// SPDX-License-Identifier: Apache-2.0

// Package app holds the Recall application core: the App struct that
// ties together settings, persistence, the parser pipeline, and the
// screenshot file watcher.
//
// The package is intentionally split into per-concern files instead of
// one monolith:
//
// Filenames match concerns (`tesseract.go`, `watcher.go`,
// `correlation.go`, `aggregate.go`, …); production code and tests
// are 1:1 sibling files. Screenshot classification lives in
// `parser.ScreenshotType` (pure function over `parser.MatchResult`),
// not in this package.
//
// The split mirrors the existing test-file partition (settings_io_test.go,
// tesseract_version_test.go, watcher_events_test.go, etc.). All the
// methods still hang off the same *App so callers (cmd, wails runtime)
// see one cohesive package; the file boundaries are a navigation aid
// for contributors, not a coupling boundary.
package app

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"recall/pkg/applog"
	"recall/pkg/db"
	"recall/pkg/parser"
)

type App struct {
	ctx      context.Context
	settings Settings
	// profiles tracks the per-installation profile set + which one is
	// active. Initialized in Startup; nil for tests wired via
	// NewWithStore. When nil, dataDir() falls back to appBaseDir() so
	// settings IO still resolves under the test's HOME isolation.
	profiles *Profiles
	// profileOverride is set when the launch carries a --profile=<name>
	// CLI flag; Startup uses it to activate the named profile (creating
	// it if needed) without persisting "this is now the default" — the
	// override is for the single launch only.
	profileOverride string
	// store is the persistence layer. *db.SQLStore in production wiring,
	// can be a fake in tests via NewWithStore.
	store db.Store
	// tessStatus is the last result of checkTesseract(). Refreshed on
	// Startup, on SetTesseractPath, on PickTesseractBinary, and on
	// ResetTesseractPath. Read-only from the Wails GetTesseractStatus
	// binding the frontend polls; mutated only on the same goroutine
	// that responds to the bound calls (no lock needed).
	tessStatus TesseractStatus
	// File-watch state. watcher is non-nil while the directory is being
	// observed; watchTimer holds the debounce timer that fires
	// ParseScreenshots after no new files have appeared for
	// watchDebounce. watchMu guards all three plus watchedDir.
	watcher    *fsnotify.Watcher
	watchedDir string
	watchTimer *time.Timer
	watchMu    sync.Mutex
	// parseCancelMu guards the whole parse run-state below: the
	// single-flight flag, the progress snapshot, and the cancel func.
	// One small lock so CancelParse, the GET /parses/active status
	// read, and the claim/end bracketing never wait on the OCR loop
	// (which holds NO lock for its multi-second run — parseRunning is
	// the single-flight gate instead).
	parseCancelMu sync.Mutex
	// parseRunning is true between claimParse and endParse — the
	// single-flight gate. A second parse (user click, watcher debounce,
	// or a concurrent POST) fails fast with ErrParseInFlight rather
	// than queueing.
	parseRunning bool
	// parseDone / parseTotal / parseScope are the per-file progress
	// snapshot surfaced by GET /api/v1/parses/active so a reconnecting
	// or reloading client can resync without replaying the SSE backlog.
	parseDone  int
	parseTotal int
	parseScope string
	// parseCancel is non-nil while a parse is in flight; calling it
	// flips ctx.Done() so the parser library short-circuits at the
	// next between-files boundary. See StartParse + CancelParse.
	parseCancel context.CancelFunc
	// SSEHub is non-nil in --server mode. When set, parse-complete events
	// are broadcast over SSE instead of (or in addition to) the Wails
	// runtime event bus.
	SSEHub *SSEHub
	// startupErr records a non-recoverable Startup failure (profile
	// init, --profile override, DB-dir create, DB open) without
	// crashing the process. Callers can read it via StartupError()
	// and decide how to surface the message — the Wails wrapper
	// renders a native dialog, the server-mode wrapper exits with
	// the message on stderr. Either way the user sees a real
	// reason instead of a window flash with no log.
	startupErr error
}

func New() *App {
	return &App{}
}

// pathIsMissingOrNotADir reports whether `path` is in a state that
// no longer represents a directory. Only ENOENT-style absence or a
// "this is a file, not a dir" mismatch count — a path that exists
// and is a dir but the current process can't enumerate (permission
// denied, network volume unreachable, TCC sandbox declined) returns
// false here.
//
// Used by Startup's validate-and-clear so a transient access issue
// (e.g. a wails-dev rebuild that re-prompts macOS TCC and the user
// dismissed the prompt) doesn't silently wipe a still-valid
// configuration. The user-reported bug shape: "each time I start up
// my app I have to change my screenshot folder" — pre-fix, EPERM
// on the configured dir's Stat path triggered the clear, and the
// next session's GetScreenshotsDir returned "" so the UI showed
// the first-run empty hero again.
//
// The clear-on-ENOENT case is still the original motivation (a
// leaked t.TempDir that got garbage-collected between sessions
// would otherwise persist forever); the "exists-but-unreadable"
// case is what we now preserve.
func pathIsMissingOrNotADir(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		// ENOENT or path-too-long-style absence. errors.Is unwraps
		// PathError so this catches the common "directory was
		// deleted between sessions" shape.
		return errors.Is(err, fs.ErrNotExist)
	}
	return !info.IsDir()
}

// NewWithStore returns an App with its persistence layer pre-wired. Used by
// tests that pass an in-memory fake (or a *db.SQLStore opened at ":memory:").
// Production code paths use New() + Startup() which constructs the SQLStore.
func NewWithStore(s db.Store) *App {
	return &App{store: s}
}

// StartupError returns any non-recoverable failure captured during
// Startup. nil means the app booted cleanly. Surfaces via the Wails
// wrapper's post-Startup dialog + the server-mode wrapper's exit
// path so the user sees a real message instead of a window flash.
func (a *App) StartupError() error { return a.startupErr }

// GetStartupError is the Wails-bound + HTTP-bound view of
// StartupError. Returns the captured message or "" — the empty
// string is the load-bearing default the frontend keys off ("no
// modal needed"). nil-error → "" rather than a sentinel value so
// the JSON wire shape stays a plain string.
//
// Why this exists separately from StartupError(): Wails IPC can't
// transit `error`, and the HTTP layer wants a JSON-friendly string
// anyway. The frontend polls this on mount; non-empty surfaces a
// blocking modal explaining the failure (see App.vue's
// `showStartupErrorModal` watcher).
func (a *App) GetStartupError() string {
	if a.startupErr == nil {
		return ""
	}
	return a.startupErr.Error()
}

// captureFatal records the FIRST startup failure + logs it. Later
// calls are noop'd (the first error is the load-bearing one). The
// caller continues running — degraded state is better than a flash
// crash, and the wrapper renders the captured error after Startup
// returns.
func (a *App) captureFatal(stage string, err error) {
	if a.startupErr != nil {
		return
	}
	a.startupErr = fmt.Errorf("startup: %s: %w", stage, err)
	applog.Subsystem("startup").Error("RECALL STARTUP FAILED", "stage", stage, "err", err)
}

// Startup initializes the app: loads settings, checks Tesseract, opens the
// SQLite database, and starts the metrics/watcher if configured. Called by
// the Wails runtime via OnStartup, or directly by pkg/cmd/server.go in
// headless mode.
//
// Recoverable failures (no profiles dir, --profile target missing, no
// DB dir / DB open failure) are captured via `captureFatal` rather than
// panic-style log.Fatal. The wrapper checks StartupError() after
// Startup returns and surfaces a user-readable dialog (Wails) or
// exits with a clean stderr message (server mode). Previously these
// were silent window-crashes with no log path the user could find.
// saveSettingsBestEffort persists settings, logging (not returning) any
// failure. Used on the best-effort persistence paths — startup defaults,
// profile switches, probe results — where a write failure shouldn't abort
// the operation but must not pass silently.
func (a *App) saveSettingsBestEffort() {
	if err := a.saveSettings(a.settings); err != nil {
		applog.Subsystem("settings").Warn("persist settings failed", "err", err)
	}
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	if !a.initProfiles() {
		return
	}
	// Open the store BEFORE resolving settings so the data path (the
	// frontend's GetMatchResults) is never gated on the Tesseract probe.
	// resolveSettings shells out to `tesseract --version`, which — even with
	// its timeout — can take seconds during a cold-boot Windows Defender scan;
	// gating the DB open behind it left the user on a loading screen with no
	// data. openStore depends only on the active profile dir, not on settings.
	if !a.openStore() {
		return
	}
	a.resolveSettings()
	a.bootReAggregate()
	a.startEnabledServices()
}

// initProfiles loads (or initializes) the profile manager — every
// subsequent path (settings.json, db/recall.db, export base dir) hangs off
// the active profile's directory — and applies the CLI --profile override.
// On failure it has already captured the fatal and returns false.
func (a *App) initProfiles() bool {
	profiles, err := LoadProfiles(appBaseDir())
	if err != nil {
		a.captureFatal("profile manager init", err)
		return false
	}
	a.profiles = profiles

	// CLI --profile=<name> override (set on the App before Startup by
	// main.go / main_server.go). Auto-creates the named profile if it
	// doesn't exist, then activates it. The activation persists, so a
	// fresh launch without --profile remembers the user's last choice.
	if name := a.profileOverride; name != "" {
		if !containsProfile(a.profiles.List(), name) {
			if cerr := a.profiles.Create(name); cerr != nil {
				a.captureFatal("create --profile target "+name, cerr)
				return false
			}
		}
		if aerr := a.profiles.Activate(name); aerr != nil {
			a.captureFatal("activate --profile target "+name, aerr)
			return false
		}
	}
	return true
}

// resolveSettings loads settings and resolves the screenshots-folder +
// tesseract paths, persisting platform defaults / clearing stale values.
func (a *App) resolveSettings() {
	a.settings = a.loadSettings()

	// Validate ScreenshotsDir against the filesystem and clear it
	// when the path is definitively gone (or has become a file
	// where it was a dir). Two real failure modes this catches:
	//   1. A stale t.TempDir() path that leaked into settings.json
	//      from an earlier test run and is now long-deleted.
	//   2. The platform default "screenshots" (a relative path that
	//      `defaultSettings()` returns for first-run wails-dev
	//      ergonomics) which doesn't resolve inside the shipped
	//      Recall.app bundle's cwd.
	// What we DON'T clear: a configured dir that exists but the
	// process can't enumerate (permission denied, TCC sandbox
	// declined, removable / network volume unreachable). Pre-fix
	// this used `isReadableDir` which lumped EPERM in with ENOENT,
	// and a wails-dev rebuild that re-prompted macOS TCC ended up
	// wiping a perfectly-valid configuration on every startup —
	// the user-reported "each time I start up my app I have to
	// change my screenshot folder" regression. Now those transient
	// access issues surface through the layers that need access
	// (watcher fails to start; parse handler returns 4xx; Open
	// button no-ops) instead of silently dropping the setting.
	if a.settings.ScreenshotsDir != "" && pathIsMissingOrNotADir(a.settings.ScreenshotsDir) {
		a.settings.ScreenshotsDir = ""
		a.saveSettingsBestEffort()
	}

	// Resolve tesseract first — if the user hasn't configured a path,
	// pick the platform default and persist it so the value is visible
	// in the Settings → Engine row on first launch. The status check
	// runs regardless; the frontend will render a System Alert banner
	// if the path doesn't resolve to a working binary.
	if a.settings.TesseractPath == "" {
		a.settings.TesseractPath = defaultTesseractPath()
		a.saveSettingsBestEffort()
	}
	a.tessStatus = checkTesseract(a.settings.TesseractPath)
	parser.SetTesseractPath(a.settings.TesseractPath)

	// First-run auto-probe — if the user hasn't set a screenshots
	// folder yet, walk the platform-specific OW default locations
	// and persist the first match. Silent on no-match; the Settings
	// view has a manual "Detect Overwatch Folder" button for the
	// "I moved my install" case.
	a.autoProbeOnFirstRun()
}

// openStore creates the active profile's db dir and opens the SQLStore (if
// one wasn't injected via NewWithStore). On failure it has already captured
// the fatal and returns false.
func (a *App) openStore() bool {
	dbDir := filepath.Join(a.dataDir(), "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		a.captureFatal("create db directory "+dbDir, err)
		return false
	}
	if a.store == nil {
		s, err := db.NewSQLStore(filepath.Join(dbDir, "recall.db"))
		if err != nil {
			a.captureFatal("open SQLite "+filepath.Join(dbDir, "recall.db"), err)
			return false
		}
		a.store = s
	}
	return true
}

// bootReAggregate walks every screenshot row whose canonical hero/map is
// empty but whose raw OCR is preserved, re-runs the matchers against the
// current heroes.yaml / maps.yaml, and promotes any newly-recognised rows
// to canonical. Cheap (~2–5 s on 500 matches) so it runs unconditionally;
// forward-only by design (pre-feature rows have hero_raw=” and no-op).
func (a *App) bootReAggregate() {
	if n, err := a.reAggregateUnknowns(); err != nil {
		fmt.Fprintf(os.Stderr, "boot re-aggregate failed: %v\n", err)
	} else if n > 0 {
		fmt.Fprintf(os.Stderr, "boot re-aggregate promoted %d previously-unknown hero/map row(s) to canonical\n", n)
	}
}

// startEnabledServices starts the file watcher only when the user has
// explicitly enabled it (off by default so the desktop app doesn't watch
// without consent).
func (a *App) startEnabledServices() {
	if a.settings.WatchEnabled {
		a.startWatching()
	}
}
