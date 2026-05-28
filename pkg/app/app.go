// Package app holds the Recall application core: the App struct that
// ties together settings, persistence, the parser pipeline, the
// Prometheus metrics lifecycle, and the screenshot file watcher.
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
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"recall/pkg/db"
	"recall/pkg/metrics"
	"recall/pkg/parser"
)

type App struct {
	ctx      context.Context
	settings Settings
	// store is the persistence layer. *db.SQLStore in production wiring,
	// can be a fake in tests via NewWithStore.
	store db.Store
	// tessStatus is the last result of checkTesseract(). Refreshed on
	// Startup, on SetTesseractPath, on PickTesseractBinary, and on
	// ResetTesseractPath. Read-only from the Wails GetTesseractStatus
	// binding the frontend polls; mutated only on the same goroutine
	// that responds to the bound calls (no lock needed).
	tessStatus TesseractStatus
	// metricsServer is non-nil only while the Prometheus endpoint is
	// running. SetPrometheusEnabled toggles between nil and a fresh
	// *metrics.Server (http.Server can't be reused after Shutdown, so
	// each enable creates a new one).
	metricsServer *metrics.Server
	// File-watch state. watcher is non-nil while the directory is being
	// observed; watchTimer holds the debounce timer that fires
	// ParseScreenshots after no new files have appeared for
	// watchDebounce. watchMu guards all three plus watchedDir.
	watcher    *fsnotify.Watcher
	watchedDir string
	watchTimer *time.Timer
	watchMu    sync.Mutex
	// parseMu serializes ParseScreenshots so an auto-trigger from the
	// watcher can't overlap with a user-triggered click (or a second
	// debounce that fires while the first parse is still running).
	parseMu sync.Mutex
	// SSEHub is non-nil in --server mode. When set, parse-complete events
	// are broadcast over SSE instead of (or in addition to) the Wails
	// runtime event bus.
	SSEHub *SSEHub
}

func New() *App {
	return &App{}
}

// isReadableDir reports whether `path` is an existing, readable
// directory. Used by Startup to gate against stale ScreenshotsDir
// values surviving across releases / test runs. Three conditions
// have to hold: the path resolves at all (os.Open), it's a directory
// (Stat().IsDir()), and we can enumerate its contents
// (Readdirnames). Anything else — a file, a deleted dir, a path the
// process lacks read permission on — returns false.
func isReadableDir(path string) bool {
	// #nosec G304 -- path is the user-configured ScreenshotsDir
	// read from their own settings.json. They can already write
	// anything to that file (it lives in their home dir); the
	// only access we perform here is "can I list this dir?", and
	// we discard the result without exposing it elsewhere. The
	// matching validator at the HTTP boundary
	// (validateScreenshotsDir / safePathChars) catches malformed
	// values before they get persisted.
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()
	info, err := f.Stat()
	if err != nil || !info.IsDir() {
		return false
	}
	// Readdirnames(1) succeeds with no error for a readable dir
	// containing at least one entry. io.EOF means readable but empty
	// — also fine. Any other error (permission denied, I/O failure)
	// disqualifies it.
	_, err = f.Readdirnames(1)
	return err == nil || err == io.EOF
}

// NewWithStore returns an App with its persistence layer pre-wired. Used by
// tests that pass an in-memory fake (or a *db.SQLStore opened at ":memory:").
// Production code paths use New() + Startup() which constructs the SQLStore.
func NewWithStore(s db.Store) *App {
	return &App{store: s}
}

// Startup initializes the app: loads settings, checks Tesseract, opens the
// SQLite database, and starts the metrics/watcher if configured. Called by
// the Wails runtime via OnStartup, or directly by pkg/cmd/server.go in
// headless mode.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	a.settings = loadSettings()

	// Validate ScreenshotsDir against the filesystem and clear it if
	// the path no longer resolves to a readable directory. Three real
	// failure modes this catches:
	//   1. A stale t.TempDir() path that leaked into settings.json
	//      from an earlier test run and is now long-deleted.
	//   2. The platform default "screenshots" (a relative path that
	//      `defaultSettings()` returns for first-run wails-dev
	//      ergonomics) which doesn't resolve inside the shipped
	//      Recall.app bundle's cwd.
	//   3. A configured external-drive folder the user has since
	//      unmounted.
	// Clearing it lets autoProbeOnFirstRun (below) re-detect, and
	// stops the "Open" button from silently no-op-ing on a path the
	// OS file manager can't find.
	if a.settings.ScreenshotsDir != "" && !isReadableDir(a.settings.ScreenshotsDir) {
		a.settings.ScreenshotsDir = ""
		_ = saveSettings(a.settings)
	}

	// Resolve tesseract first — if the user hasn't configured a path,
	// pick the platform default and persist it so the value is visible
	// in the Settings → Engine row on first launch. The status check
	// runs regardless; the frontend will render a System Alert banner
	// if the path doesn't resolve to a working binary.
	if a.settings.TesseractPath == "" {
		a.settings.TesseractPath = defaultTesseractPath()
		_ = saveSettings(a.settings)
	}
	a.tessStatus = checkTesseract(a.settings.TesseractPath)
	parser.SetTesseractPath(a.settings.TesseractPath)

	// First-run auto-probe — if the user hasn't set a screenshots
	// folder yet, walk the platform-specific OW default locations
	// and persist the first match. Silent on no-match; the Settings
	// view has a manual "Detect Overwatch Folder" button for the
	// "I moved my install" case.
	a.autoProbeOnFirstRun()

	dbDir := filepath.Join(appDataDir(), "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		log.Fatal("could not create db dir:", err)
	}
	if a.store == nil {
		s, err := db.NewSQLStore(filepath.Join(dbDir, "recall.db"))
		if err != nil {
			log.Fatal("could not init db:", err)
		}
		a.store = s
	}

	// Start the Prometheus metrics endpoint only if the user has
	// explicitly enabled it via the checkbox (default off so the desktop
	// app doesn't open a network port without consent).
	if a.settings.PrometheusEnabled {
		a.startMetrics()
	}
	if a.settings.WatchEnabled {
		a.startWatching()
	}
}
