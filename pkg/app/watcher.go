package app

import (
	"errors"
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
var watchDebounce = 60 * time.Second

// watchRetryAfterBusy is how soon a debounce that found the run slot busy
// tries again once the slot frees.
var watchRetryAfterBusy = 5 * time.Second

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

// debouncePhase is where the watcher's parse trigger stands.
type debouncePhase int

const (
	// debounceIdle has nothing pending.
	debounceIdle debouncePhase = iota
	// debounceArmed waits on its timer: watchDebounce after the last file.
	debounceArmed
	// debounceDeferred fired while the run slot was busy and waits for the
	// slot to free.
	debounceDeferred
)

// debounce is the watcher's parse trigger, held under watchMu. gen grows on
// every arm and every stop, so a timer that fires after either is stale and
// does nothing. Only the methods below change it.
type debounce struct {
	phase debouncePhase
	gen   uint64
	timer *time.Timer
}

// scheduleParseDebounced (re)arms the debounce timer. Each call resets
// it, so a burst of file-create events within watchDebounce collapses
// into a single parse. A no-op once the watcher has stopped: the event
// loop can still be draining an event when it does.
func (a *App) scheduleParseDebounced() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watcher == nil {
		return
	}
	a.armDebounceLocked(watchDebounce)
}

// armDebounceLocked starts a fresh round that fires after d. Callers hold
// watchMu.
func (a *App) armDebounceLocked(d time.Duration) {
	if a.watchTrigger.timer != nil {
		a.watchTrigger.timer.Stop()
	}
	a.watchTrigger.gen++
	gen := a.watchTrigger.gen
	a.watchTrigger.phase = debounceArmed
	a.watchTrigger.timer = time.AfterFunc(d, func() {
		defer applog.RecoverPanic("watch")
		a.debounceElapsed(gen)
	})
}

// debounceElapsed runs the watched-folder parse for round gen, unless a
// later arm or a stop has replaced it. A busy run slot defers the round
// until the slot frees (runSlotReleased) instead of dropping it.
//
// Deliberately parseSync and NOT ParseScreenshots: the coaching write gate
// sits on the user-initiated entry points, and the watcher is exempt
// (design rule 1). It only ever ingests the coach's own screenshots into
// the coach's own store, invisibly — the frontend suppresses its
// announcements in-session instead.
func (a *App) debounceElapsed(gen uint64) {
	a.watchMu.Lock()
	if gen != a.watchTrigger.gen || a.watchTrigger.phase != debounceArmed {
		a.watchMu.Unlock()
		return
	}
	a.watchTrigger.phase = debounceIdle
	a.watchTrigger.timer = nil
	a.watchMu.Unlock()

	logger := applog.Subsystem("watch")
	logger.Info("debounce elapsed, running the watched-folder parse")
	err := a.parseSync(false)
	switch {
	case errors.Is(err, ErrParseInFlight):
		a.watchMu.Lock()
		if gen == a.watchTrigger.gen {
			a.watchTrigger.phase = debounceDeferred
			logger.Info("run slot busy; parsing once it frees")
		}
		a.watchMu.Unlock()
	case err != nil:
		logger.Error("parse failed", "err", err)
	}
}

// runSlotReleased re-arms a round deferred by a busy slot, shortly: asynchronous,
// because the release can sit inside a request (a VACUUM, a restore) that
// must not wait on a whole parse.
func (a *App) runSlotReleased() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watchTrigger.phase == debounceDeferred && a.watcher != nil {
		a.armDebounceLocked(watchRetryAfterBusy)
	}
}

// stopWatching tears down the watcher and cancels any pending debounce
// timer. Safe to call when no watcher is running.
func (a *App) stopWatching() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watchTrigger.timer != nil {
		a.watchTrigger.timer.Stop()
	}
	a.watchTrigger = debounce{phase: debounceIdle, gen: a.watchTrigger.gen + 1}
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
