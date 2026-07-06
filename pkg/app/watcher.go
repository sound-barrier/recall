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
	dir := a.settingsSnapshot().ScreenshotsDir
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

	go func() {
		defer applog.RecoverPanic("watch")
		a.runWatchLoop(w)
	}()
}

func (a *App) runWatchLoop(w *fsnotify.Watcher) {
	runWatchEvents(w.Events, w.Errors, func() {
		a.noteWatchActivity()
		a.scheduleParseDebounced()
	})
}

// WatchActivityEvent is emitted on the "watch-activity" channel/event
// whenever the watcher sees a new screenshot (pending grows) and when a
// parse run starts (pending resets to 0). Feeds the masthead's
// "watching · N new" dot; LastSeenAt (RFC3339) drives its tooltip.
type WatchActivityEvent struct {
	Pending    int    `json:"pending"`
	LastSeenAt string `json:"last_seen_at,omitempty"`
}

// noteWatchActivity records one watcher file event and broadcasts the
// updated tally.
func (a *App) noteWatchActivity() {
	a.watchMu.Lock()
	a.watchPending++
	a.watchLastSeen = time.Now().UTC()
	ev := a.watchActivityLocked()
	a.watchMu.Unlock()
	a.emitWatchActivity(ev)
}

// resetWatchActivity zeroes the pending tally when a parse run starts —
// whatever the watcher queued is being consumed now. Emits only when
// there was something to clear, so idle parses stay silent.
func (a *App) resetWatchActivity() {
	a.watchMu.Lock()
	if a.watchPending == 0 {
		a.watchMu.Unlock()
		return
	}
	a.watchPending = 0
	ev := a.watchActivityLocked()
	a.watchMu.Unlock()
	a.emitWatchActivity(ev)
}

// watchActivityLocked snapshots the event payload; callers hold watchMu.
func (a *App) watchActivityLocked() WatchActivityEvent {
	ev := WatchActivityEvent{Pending: a.watchPending}
	if !a.watchLastSeen.IsZero() {
		ev.LastSeenAt = a.watchLastSeen.Format(time.RFC3339)
	}
	return ev
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
		defer applog.RecoverPanic("watch")
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
	a.watchPending = 0
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
	return a.settingsSnapshot().WatchEnabled
}

// SetWatchEnabled toggles the directory watcher and persists the
// preference. Enabling/disabling takes effect immediately.
func (a *App) SetWatchEnabled(enabled bool) error {
	snap := a.mutateSettings(func(s *Settings) { s.WatchEnabled = enabled })
	if err := a.saveSettings(snap); err != nil {
		return err
	}
	if enabled {
		a.startWatching()
	} else {
		a.stopWatching()
	}
	return nil
}
