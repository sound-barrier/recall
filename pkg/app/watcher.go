package app

import (
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"

	"recall/pkg/applog"
)

// watchDebounce is how long we wait after seeing a new screenshot
// before kicking off a parse. The user typically takes 3–4 screenshots
// in quick succession (SUMMARY → TEAMS → PERSONAL → rank screen); we
// don't want to fire ParseScreenshots once per file. 60 seconds is
// generous enough to absorb a slow tab-cycler.
const watchDebounce = 60 * time.Second

// startWatching begins watching the configured screenshots directory
// for newly created image files. Each new file resets a debounce timer;
// when the timer elapses (watchDebounce after the last new file), the
// parser runs and the frontend is notified via a Wails event.
func (a *App) startWatching() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watcher != nil {
		return // already watching
	}
	dir := a.settings.ScreenshotsDir
	logger := applog.Subsystem("watch")
	if dir == "" {
		logger.Info("no screenshots directory configured, skipping")
		return
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		logger.Error("NewWatcher failed", "err", err)
		return
	}
	if err := w.Add(dir); err != nil {
		// `slog.String("dir", dir)` escapes any control char that
		// might have slipped past `safePathChars` at the boundary,
		// so a forged path can't forge a log line — same fix as
		// the historical `%q` formatting in the log.Printf days.
		logger.Error("cannot watch directory", "dir", dir, "err", err)
		_ = w.Close()
		return
	}
	a.watcher = w
	a.watchedDir = dir
	logger.Info("watching", "dir", dir)

	go a.runWatchLoop(w)
}

func (a *App) runWatchLoop(w *fsnotify.Watcher) {
	runWatchEvents(w.Events, w.Errors, a.scheduleParseDebounced)
}

// runWatchEvents is the pure event-loop body, abstracted away from
// *fsnotify.Watcher so tests can feed synthetic channels. Returns when
// either channel closes — matches the production behavior where the
// watcher's goroutine exits on shutdown.
func runWatchEvents(events <-chan fsnotify.Event, errs <-chan error, onTrigger func()) {
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return
			}
			// Care only about new files. Write events fire repeatedly
			// during a screenshot save; Create is the cleanest signal.
			if ev.Op&fsnotify.Create == 0 {
				continue
			}
			ext := strings.ToLower(filepath.Ext(ev.Name))
			if ext != ".png" && ext != ".jpg" && ext != ".jpeg" {
				continue
			}
			applog.Subsystem("watch").Info("new file — debouncing parse",
				"file", filepath.Base(ev.Name),
				"debounce", watchDebounce)
			onTrigger()
		case err, ok := <-errs:
			if !ok {
				return
			}
			applog.Subsystem("watch").Error("event channel error", "err", err)
		}
	}
}

// scheduleParseDebounced (re)arms the debounce timer. Each call resets
// it, so a burst of file-create events within watchDebounce collapses
// into a single ParseScreenshots invocation.
func (a *App) scheduleParseDebounced() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watchTimer != nil {
		a.watchTimer.Stop()
	}
	a.watchTimer = time.AfterFunc(watchDebounce, func() {
		logger := applog.Subsystem("watch")
		logger.Info("debounce elapsed, running ParseScreenshots")
		// ParseScreenshots is synchronous + emits parse-complete itself
		// on success (runClaimedParse owns that emit for every path), so
		// the watcher no longer signals completion separately. A busy
		// slot returns ErrParseInFlight — a logged skip; the debounce
		// re-fires on the next file event.
		if err := a.ParseScreenshots(); err != nil {
			logger.Error("parse failed", "err", err)
			return
		}
	})
}

// stopWatching tears down the watcher and cancels any pending debounce
// timer. Safe to call when no watcher is running.
func (a *App) stopWatching() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watchTimer != nil {
		a.watchTimer.Stop()
		a.watchTimer = nil
	}
	if a.watcher == nil {
		return
	}
	prev := a.watchedDir
	_ = a.watcher.Close()
	a.watcher = nil
	a.watchedDir = ""
	applog.Subsystem("watch").Info("stopped watching", "dir", prev)
}

// GetWatchEnabled reports whether the watcher is currently active.
// Read by the frontend on mount to seed the checkbox state.
func (a *App) GetWatchEnabled() bool {
	return a.settings.WatchEnabled
}

// SetWatchEnabled toggles the directory watcher and persists the
// preference. Enabling/disabling takes effect immediately.
func (a *App) SetWatchEnabled(enabled bool) error {
	a.settings.WatchEnabled = enabled
	if err := a.saveSettings(a.settings); err != nil {
		return err
	}
	if enabled {
		a.startWatching()
	} else {
		a.stopWatching()
	}
	return nil
}
