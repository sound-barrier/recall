// Package app holds the Recall application core: the App struct that
// ties together settings, persistence, the parser pipeline, the
// Prometheus metrics lifecycle, and the screenshot file watcher.
//
// The package is intentionally split into per-concern files instead of
// one monolith:
//
//   - settings.go         — on-disk JSON settings + appDataDir
//   - tesseract.go        — TesseractStatus + probe + path validation
//   - watcher.go          — filesystem watcher lifecycle + debounce
//   - metrics_lifecycle.go — Prometheus endpoint start/stop
//   - update.go           — Version + CheckForUpdate (GitHub Releases)
//   - screenshots_dir.go  — ScreenshotsDir get/set + validation
//   - screenshot_handler.go — HTTP /_screenshot/<file> file server
//   - inference.go        — read-time inference helpers + scrapeReader
//   - match_record.go     — MatchRecord type + read API + record loader
//   - merge.go            — the mergedRow shape + all merge orchestration
//   - parse.go            — ParseScreenshots + screenshotType + ParseProgressEvent
//   - sse.go              — SSEHub (server-mode event broadcaster)
//   - app_wails.go        — Wails-only methods (dialogs, events) — !serveronly
//   - app_server.go       — serveronly stubs for the dialog methods
//
// The split mirrors the existing test-file partition (settings_io_test.go,
// tesseract_version_test.go, watcher_events_test.go, etc.). All the
// methods still hang off the same *App so callers (cmd, wails runtime)
// see one cohesive package; the file boundaries are a navigation aid
// for contributors, not a coupling boundary.
package app

import (
	"context"
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
