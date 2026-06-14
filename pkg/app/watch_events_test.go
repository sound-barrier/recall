package app_test

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"

	"recall/pkg/app"
)

// runWatchEvents pipes fsnotify events into the parse-trigger callback,
// filtering for new image files. These tests feed synthetic channels so
// nothing on disk is touched.

func TestRunWatchEvents_TriggersOnImageCreate(t *testing.T) {
	events := make(chan fsnotify.Event, 4)
	errs := make(chan error)
	var calls atomic.Int32

	done := make(chan struct{})
	go func() {
		app.RunWatchEvents(events, errs, func() { calls.Add(1) })
		close(done)
	}()

	events <- fsnotify.Event{Name: "/tmp/2026.05.10 - 21.29.28 _summary.png", Op: fsnotify.Create}
	events <- fsnotify.Event{Name: "/tmp/sb.jpg", Op: fsnotify.Create}
	events <- fsnotify.Event{Name: "/tmp/foo.jpeg", Op: fsnotify.Create}

	// Close the events channel to make runWatchEvents return — we want a
	// deterministic shutdown rather than polling.
	close(events)
	<-done

	if got := calls.Load(); got != 3 {
		t.Errorf("expected 3 trigger calls, got %d", got)
	}
}

func TestRunWatchEvents_IgnoresNonImageExtensions(t *testing.T) {
	events := make(chan fsnotify.Event, 4)
	errs := make(chan error)
	var calls atomic.Int32

	done := make(chan struct{})
	go func() {
		app.RunWatchEvents(events, errs, func() { calls.Add(1) })
		close(done)
	}()

	events <- fsnotify.Event{Name: "/tmp/notes.txt", Op: fsnotify.Create}
	events <- fsnotify.Event{Name: "/tmp/log.json", Op: fsnotify.Create}
	close(events)
	<-done

	if got := calls.Load(); got != 0 {
		t.Errorf("non-image extensions must not trigger; got %d calls", got)
	}
}

func TestRunWatchEvents_IgnoresNonCreateOps(t *testing.T) {
	events := make(chan fsnotify.Event, 4)
	errs := make(chan error)
	var calls atomic.Int32

	done := make(chan struct{})
	go func() {
		app.RunWatchEvents(events, errs, func() { calls.Add(1) })
		close(done)
	}()

	// Write / Chmod / Rename events on a real image still mustn't trigger:
	// only Create is the cleanest "new screenshot landed" signal.
	events <- fsnotify.Event{Name: "/tmp/a.png", Op: fsnotify.Write}
	events <- fsnotify.Event{Name: "/tmp/a.png", Op: fsnotify.Chmod}
	close(events)
	<-done

	if got := calls.Load(); got != 0 {
		t.Errorf("only Create should trigger; got %d calls", got)
	}
}

func TestRunWatchEvents_ReturnsOnErrChanClose(t *testing.T) {
	events := make(chan fsnotify.Event)
	errs := make(chan error)

	done := make(chan struct{})
	go func() {
		app.RunWatchEvents(events, errs, func() {})
		close(done)
	}()

	close(errs)

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("runWatchEvents did not return when errs channel closed")
	}
}

func TestRunWatchEvents_LogsErrorsAndContinues(t *testing.T) {
	events := make(chan fsnotify.Event, 1)
	errs := make(chan error, 1)
	var calls atomic.Int32

	done := make(chan struct{})
	go func() {
		app.RunWatchEvents(events, errs, func() { calls.Add(1) })
		close(done)
	}()

	// Error must NOT terminate the loop — only channel close does.
	errs <- errors.New("transient fsnotify error")
	events <- fsnotify.Event{Name: "/tmp/2026.05.10 - 21.29.28 .png", Op: fsnotify.Create}
	close(events)
	<-done

	if got := calls.Load(); got != 1 {
		t.Errorf("loop must keep processing events after an error; got %d trigger calls", got)
	}
}
