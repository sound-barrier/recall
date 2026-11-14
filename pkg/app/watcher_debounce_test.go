package app_test

import (
	"sync/atomic"
	"testing"
	"time"

	"recall/pkg/app"
	"recall/pkg/parser"
)

// shortDebounce shrinks the watcher's two waits for the duration of a test.
func shortDebounce(t *testing.T) {
	t.Helper()
	prevDebounce, prevRetry := *app.WatchDebounce, *app.WatchRetryAfterBusy
	*app.WatchDebounce, *app.WatchRetryAfterBusy = 10*time.Millisecond, 10*time.Millisecond
	t.Cleanup(func() { *app.WatchDebounce, *app.WatchRetryAfterBusy = prevDebounce, prevRetry })
}

func countParses(t *testing.T) *atomic.Int32 {
	t.Helper()
	var n atomic.Int32
	stubParse(t, func(parser.ProgressFunc) error { n.Add(1); return nil })
	return &n
}

// The traced bug: a debounce that fired while the run slot was busy (a
// manual parse, a restore) logged ErrParseInFlight and dropped the trigger.
// The screenshots it was waiting on sat unparsed until the next file
// arrived, which after the last game of the night is never.
func TestWatcher_ATriggerThatHitsABusySlotRunsOnceTheSlotFrees(t *testing.T) {
	shortDebounce(t)
	a, _ := newParseReadyApp(t)
	parses := countParses(t)
	app.StartWatching(a)
	t.Cleanup(func() { app.StopWatching(a) })

	_, held, err := app.ClaimRun(a, app.RunKindRestore)
	if err != nil {
		t.Fatal(err)
	}
	app.ScheduleParseDebounced(a)
	time.Sleep(50 * time.Millisecond)
	if parses.Load() != 0 {
		t.Fatal("a parse ran while the slot was held")
	}

	app.FinishRun(a, held, nil, nil)
	eventually(t, func() bool { return parses.Load() == 1 }, "the deferred parse never ran")
}

// A file event the loop was still draining when the watcher stopped used
// to arm a fresh timer, and the parse ran against a folder the user had
// already turned watching off for.
func TestWatcher_NothingFiresAfterStop(t *testing.T) {
	shortDebounce(t)
	a, _ := newParseReadyApp(t)
	parses := countParses(t)
	app.StartWatching(a)

	app.ScheduleParseDebounced(a)
	app.StopWatching(a)
	app.ScheduleParseDebounced(a)
	time.Sleep(60 * time.Millisecond)

	if got := parses.Load(); got != 0 {
		t.Errorf("%d parse(s) ran after the watcher stopped, want none", got)
	}
}

func TestWatcher_ABurstCollapsesIntoOneParse(t *testing.T) {
	shortDebounce(t)
	a, _ := newParseReadyApp(t)
	parses := countParses(t)
	app.StartWatching(a)
	t.Cleanup(func() { app.StopWatching(a) })

	for range 5 {
		app.ScheduleParseDebounced(a)
	}
	eventually(t, func() bool { return parses.Load() == 1 }, "the parse never ran")
	time.Sleep(40 * time.Millisecond)
	if got := parses.Load(); got != 1 {
		t.Errorf("a burst ran %d parses, want 1", got)
	}
}
