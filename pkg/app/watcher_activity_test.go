package app_test

import (
	"testing"

	"recall/pkg/app"
	"recall/pkg/parser"
)

// The masthead's "watching · N new" tally: each watcher file event
// increments pending (stamping last-seen), and any parse run consumes
// the queue — the count resets the moment the run starts, on every
// parse path (the watcher debounce funnels into the same
// runClaimedParse choke point the manual buttons use).

func TestWatchActivity_FileEventsIncrement_ParseRunResets(t *testing.T) {
	a, _ := newParseReadyApp(t)

	app.NoteWatchActivity(a)
	app.NoteWatchActivity(a)
	pending, lastSeen := app.AppWatchActivity(a)
	if pending != 2 {
		t.Fatalf("pending after two file events = %d, want 2", pending)
	}
	if lastSeen == "" {
		t.Fatal("last-seen stamp missing after a file event")
	}

	stubParse(t, func(progress parser.ProgressFunc) error { return nil })
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	pending, lastSeen = app.AppWatchActivity(a)
	if pending != 0 {
		t.Errorf("pending after a parse run = %d, want 0 (run consumes the queue)", pending)
	}
	if lastSeen == "" {
		t.Error("last-seen stamp must survive the reset (tooltip keeps the last activity)")
	}
}

func TestWatchActivity_ResetIsIdempotentWhenNothingPending(t *testing.T) {
	a, _ := newParseReadyApp(t)
	app.ResetWatchActivity(a)
	if pending, _ := app.AppWatchActivity(a); pending != 0 {
		t.Errorf("pending = %d, want 0", pending)
	}
}
