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

// WatchState is what the folder watcher is doing — not what the Watch
// setting asks for. GET /api/v1/settings/watcher and the "watch-state" event
// carry it.
type WatchState string

const (
	// WatchStateOff is no watcher: Watch is off.
	WatchStateOff WatchState = "off"
	// WatchStateWatching is a watcher open on the screenshots folder.
	WatchStateWatching WatchState = "watching"
	// WatchStateUnavailable is Watch on with no folder it can watch: unset,
	// missing, unreadable, or deleted while watched. It retries on its own.
	WatchStateUnavailable WatchState = "unavailable"
)

// watchRecheckInterval is how often an unavailable watcher looks for its
// folder again.
var watchRecheckInterval = 5 * time.Second

// startWatching begins watching the configured screenshots directory
// for newly created image files. Each new file resets a debounce timer;
// when the timer elapses (watchDebounce after the last new file), the
// parser runs and the frontend is notified via a Wails event. A folder it
// cannot watch leaves it unavailable, looking again every
// watchRecheckInterval.
func (a *App) startWatching() {
	a.watchMu.Lock()
	changed := a.openWatcherLocked()
	a.watchMu.Unlock()
	if changed {
		a.emitWatchState()
	}
}

// openWatcherLocked opens the watcher on the configured folder, or records
// why it cannot, and reports whether the watch state changed. Callers hold
// watchMu.
func (a *App) openWatcherLocked() bool {
	if a.watcher != nil {
		return false // already watching
	}
	dir := a.settingsSnapshot().ScreenshotsDir
	logger := applog.Subsystem("watch")
	if dir == "" {
		logger.Info("no screenshots directory configured, skipping")
		return a.setWatchStateLocked(WatchStateUnavailable)
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		logger.Error("NewWatcher failed", "err", err)
		return a.becomeUnavailableLocked()
	}
	if err := w.Add(dir); err != nil {
		// `slog.String("dir", dir)` escapes any control char that
		// might have slipped past `safePathChars` at the boundary,
		// so a forged path can't forge a log line — same fix as
		// the historical `%q` formatting in the log.Printf days.
		logger.Error("cannot watch directory", "dir", dir, "err", err)
		_ = w.Close()
		return a.becomeUnavailableLocked()
	}
	a.watcher = w
	a.watchedDir = dir
	logger.Info("watching", "dir", dir)

	go func() {
		defer applog.RecoverPanic("watch")
		a.runWatchLoop(w, dir)
	}()
	return a.setWatchStateLocked(WatchStateWatching)
}

// becomeUnavailableLocked records a folder the watcher cannot watch and arms
// the recheck that looks for it again. Callers hold watchMu.
func (a *App) becomeUnavailableLocked() bool {
	if a.watchRecheck != nil {
		a.watchRecheck.Stop()
	}
	a.watchRecheckGen++
	gen := a.watchRecheckGen
	a.watchRecheck = time.AfterFunc(watchRecheckInterval, func() {
		defer applog.RecoverPanic("watch")
		a.recheckWatchedFolder(gen)
	})
	return a.setWatchStateLocked(WatchStateUnavailable)
}

// recheckWatchedFolder tries the folder again for recheck round gen, unless
// a stop or a newer round has replaced it.
func (a *App) recheckWatchedFolder(gen uint64) {
	a.watchMu.Lock()
	if gen != a.watchRecheckGen || a.watchState != WatchStateUnavailable {
		a.watchMu.Unlock()
		return
	}
	a.watchRecheck = nil
	changed := a.openWatcherLocked()
	a.watchMu.Unlock()
	if changed {
		a.emitWatchState()
	}
}

// watchedFolderGone closes watcher w after its folder was deleted or moved
// away, leaving the watch unavailable until the folder returns. A no-op for
// a watcher already replaced or stopped.
func (a *App) watchedFolderGone(w *fsnotify.Watcher) {
	a.watchMu.Lock()
	if a.watcher != w {
		a.watchMu.Unlock()
		return
	}
	applog.Subsystem("watch").Warn("watched directory is gone", "dir", a.watchedDir)
	a.watcher = nil
	a.watchedDir = ""
	a.resetDebounceLocked()
	changed := a.becomeUnavailableLocked()
	a.watchMu.Unlock()
	// Closed off this goroutine: it is the event loop's own, and the close
	// ends that loop.
	go func() { _ = w.Close() }()
	if changed {
		a.emitWatchState()
	}
}

// setWatchStateLocked steps the watch state and reports whether it changed.
// Callers hold watchMu and emit after letting it go.
func (a *App) setWatchStateLocked(next WatchState) bool {
	if a.watchState == next {
		return false
	}
	a.watchState = next
	return true
}

// GetWatchState reports what the watcher is doing now.
func (a *App) GetWatchState() WatchState {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watchState == "" {
		return WatchStateOff
	}
	return a.watchState
}

// WatchStateEvent is the payload of the "watch-state" event.
type WatchStateEvent struct {
	WatchState WatchState `json:"watch_state"`
}

func (a *App) runWatchLoop(w *fsnotify.Watcher, dir string) {
	runWatchEvents(w.Events, w.Errors, watchHandlers{
		dir: dir,
		onNewImage: func() {
			a.noteWatchActivity()
			a.scheduleParseDebounced()
		},
		onDirGone: func() { a.watchedFolderGone(w) },
	})
}

// watchHandlers is what the event loop calls back: onNewImage for each new
// screenshot, onDirGone (when set) once dir itself is removed or renamed.
type watchHandlers struct {
	dir        string
	onNewImage func()
	onDirGone  func()
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
func runWatchEvents(events <-chan fsnotify.Event, errs <-chan error, on watchHandlers) {
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return
			}
			if on.isDirGone(ev) {
				on.onDirGone()
				return
			}
			if !isNewImage(ev) {
				continue
			}
			applog.Subsystem("watch").Info("new file — debouncing parse",
				"file", filepath.Base(ev.Name),
				"debounce", watchDebounce)
			on.onNewImage()
		case err, ok := <-errs:
			if !ok {
				return
			}
			applog.Subsystem("watch").Error("event channel error", "err", err)
		}
	}
}

// isNewImage reports whether ev created a screenshot. Only Create counts:
// Write events fire repeatedly during a save.
func isNewImage(ev fsnotify.Event) bool {
	if ev.Op&fsnotify.Create == 0 {
		return false
	}
	ext := strings.ToLower(filepath.Ext(ev.Name))
	return ext == ".png" || ext == ".jpg" || ext == ".jpeg"
}

// isDirGone reports whether ev removed or renamed the watched folder itself.
func (on watchHandlers) isDirGone(ev fsnotify.Event) bool {
	return on.onDirGone != nil && on.dir != "" &&
		filepath.Clean(ev.Name) == filepath.Clean(on.dir) &&
		ev.Op&(fsnotify.Remove|fsnotify.Rename) != 0
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
	changed := a.closeWatcherLocked()
	a.watchMu.Unlock()
	if changed {
		a.emitWatchState()
	}
}

// closeWatcherLocked stops the watcher, its debounce and its recheck, and
// reports whether the watch state changed. Callers hold watchMu.
func (a *App) closeWatcherLocked() bool {
	a.resetDebounceLocked()
	a.watchPending = 0
	if a.watchRecheck != nil {
		a.watchRecheck.Stop()
		a.watchRecheck = nil
	}
	a.watchRecheckGen++
	if a.watcher != nil {
		prev := a.watchedDir
		_ = a.watcher.Close()
		a.watcher = nil
		a.watchedDir = ""
		applog.Subsystem("watch").Info("stopped watching", "dir", prev)
	}
	return a.setWatchStateLocked(WatchStateOff)
}

// resetDebounceLocked drops any pending round: a timer still out finds its
// generation replaced. Callers hold watchMu.
func (a *App) resetDebounceLocked() {
	if a.watchTrigger.timer != nil {
		a.watchTrigger.timer.Stop()
	}
	a.watchTrigger = debounce{phase: debounceIdle, gen: a.watchTrigger.gen + 1}
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
