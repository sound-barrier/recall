package app_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"recall/pkg/app"
	"recall/pkg/parser"
)

// runFinished is the run-finished payload as a client decodes it.
type runFinished struct {
	RunID   app.RunID `json:"run_id"`
	Kind    string    `json:"kind"`
	Outcome string    `json:"outcome"`
	Summary *struct {
		FilesParsed int `json:"files_parsed"`
		FilesFailed int `json:"files_failed"`
	} `json:"summary"`
	Error string `json:"error"`
}

// subscribeRunFinished wires an SSE hub onto a and returns a reader that
// waits for the next run-finished event.
func subscribeRunFinished(t *testing.T, a *app.App) func() (runFinished, bool) {
	t.Helper()
	a.SSEHub = app.NewSSEHub()
	events := a.SSEHub.Subscribe()
	return func() (runFinished, bool) {
		deadline := time.After(2 * time.Second)
		for {
			select {
			case msg := <-events:
				if msg.Event != "run-finished" {
					continue
				}
				var ev runFinished
				if err := json.Unmarshal([]byte(msg.Data), &ev); err != nil {
					t.Fatalf("run-finished payload %q: %v", msg.Data, err)
				}
				return ev, true
			case <-deadline:
				return runFinished{}, false
			}
		}
	}
}

// noMoreRunFinished asserts nothing further arrives within a short wait.
func noMoreRunFinished(t *testing.T, next func() (runFinished, bool)) {
	t.Helper()
	if ev, ok := next(); ok {
		t.Errorf("unexpected extra run-finished %+v", ev)
	}
}

func activeJSON(t *testing.T, a *app.App) map[string]any {
	t.Helper()
	raw, err := json.Marshal(a.ActiveParse())
	if err != nil {
		t.Fatalf("marshal ActiveParse: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
	return out
}

func mustClaim(t *testing.T, a *app.App, kind app.RunKind) (context.Context, app.RunID) {
	t.Helper()
	ctx, id, err := app.ClaimRun(a, kind)
	if err != nil {
		t.Fatalf("ClaimRun(%s) = %v", kind, err)
	}
	return ctx, id
}

// An idle slot describes no run: the snapshot is the phase and nothing else,
// so a client cannot read a previous run's scope or counts as current.
func TestActiveParse_IdleCarriesOnlyItsState(t *testing.T) {
	a := app.New()
	_, id := mustClaim(t, a, app.RunKindReparse)
	app.NoteProgress(a, id, 7, 40)
	app.FinishRun(a, id, nil, nil)

	got := activeJSON(t, a)
	if len(got) != 1 || got["state"] != "idle" {
		t.Errorf("idle snapshot = %v, want exactly {state: idle}", got)
	}
}

func TestActiveParse_RunningDescribesTheRun(t *testing.T) {
	a := app.New()
	_, id := mustClaim(t, a, app.RunKindReparse)
	defer app.FinishRun(a, id, nil, nil)
	app.NoteProgress(a, id, 7, 40)

	got := activeJSON(t, a)
	want := map[string]any{"state": "running", "run_id": float64(id), "kind": "reparse", "done": float64(7), "total": float64(40)}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("snapshot[%s] = %v, want %v (snapshot %v)", k, got[k], v, got)
		}
	}
}

func TestClaimRun_IsSingleFlight(t *testing.T) {
	a := app.New()
	_, first := mustClaim(t, a, app.RunKindParse)
	if _, _, err := app.ClaimRun(a, app.RunKindRestore); !errors.Is(err, app.ErrParseInFlight) {
		t.Errorf("second claim = %v, want ErrParseInFlight", err)
	}
	app.FinishRun(a, first, nil, nil)
	_, second := mustClaim(t, a, app.RunKindParse)
	defer app.FinishRun(a, second, nil, nil)
	if second <= first {
		t.Errorf("run ids went %d then %d, want them to grow", first, second)
	}
}

// A report or an end carrying an old run's id must not touch the run that
// holds the slot now.
func TestRunSlot_IgnoresAStaleRun(t *testing.T) {
	a := app.New()
	next := subscribeRunFinished(t, a)
	_, old := mustClaim(t, a, app.RunKindParse)
	app.FinishRun(a, old, nil, nil)
	if _, ok := next(); !ok {
		t.Fatal("the first run's end emitted no run-finished")
	}
	_, current := mustClaim(t, a, app.RunKindParse)
	defer app.FinishRun(a, current, nil, nil)

	app.NoteProgress(a, old, 9, 9)
	app.FinishRun(a, old, nil, nil)

	got := activeJSON(t, a)
	if got["state"] != "running" || got["run_id"] != float64(current) || got["done"] != float64(0) {
		t.Errorf("after stale reports, snapshot = %v, want run %d untouched", got, current)
	}
	noMoreRunFinished(t, next)
}

func TestCancelParse_Transitions(t *testing.T) {
	cases := []struct {
		name       string
		kind       app.RunKind
		wantErr    error
		wantCancel bool
		wantState  string
	}{
		{"parse", app.RunKindParse, nil, true, "canceling"},
		{"reparse", app.RunKindReparse, nil, true, "canceling"},
		{"restore", app.RunKindRestore, app.ErrRunNotCancelable, false, "running"},
		{"maintenance", app.RunKindMaintenance, app.ErrRunNotCancelable, false, "running"},
		{"profile switch", app.RunKindProfileSwitch, app.ErrRunNotCancelable, false, "running"},
		{"profile rename", app.RunKindProfileRename, app.ErrRunNotCancelable, false, "running"},
		{"screenshot takeover", app.RunKindScreenshotTakeover, app.ErrRunNotCancelable, false, "running"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := app.New()
			ctx, id := mustClaim(t, a, tc.kind)
			defer app.FinishRun(a, id, nil, nil)

			if err := a.CancelParse(); !errors.Is(err, tc.wantErr) {
				t.Fatalf("CancelParse = %v, want %v", err, tc.wantErr)
			}
			if canceled := ctx.Err() != nil; canceled != tc.wantCancel {
				t.Errorf("ctx canceled = %v, want %v", canceled, tc.wantCancel)
			}
			if got := activeJSON(t, a)["state"]; got != tc.wantState {
				t.Errorf("state = %v, want %s", got, tc.wantState)
			}
		})
	}
}

func TestCancelParse_IdleAndRepeated(t *testing.T) {
	a := app.New()
	if err := a.CancelParse(); !errors.Is(err, app.ErrNoParseInFlight) {
		t.Errorf("idle CancelParse = %v, want ErrNoParseInFlight", err)
	}
	_, id := mustClaim(t, a, app.RunKindParse)
	if err := a.CancelParse(); err != nil {
		t.Fatalf("CancelParse = %v", err)
	}
	if err := a.CancelParse(); err != nil {
		t.Errorf("second CancelParse = %v, want nil: asking twice is asking once", err)
	}
	app.FinishRun(a, id, context.Canceled, nil)
	if err := a.CancelParse(); !errors.Is(err, app.ErrNoParseInFlight) {
		t.Errorf("CancelParse after the run ended = %v, want ErrNoParseInFlight", err)
	}
}

// Every claim ends in exactly one run-finished, its outcome read from how
// the work returned.
func TestFinishRun_EmitsOneEventPerRun(t *testing.T) {
	cases := []struct {
		name        string
		err         error
		wantOutcome string
	}{
		{"completed", nil, "completed"},
		{"canceled", context.Canceled, "canceled"},
		{"failed", errors.New("disk full"), "failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a := app.New()
			next := subscribeRunFinished(t, a)
			_, id := mustClaim(t, a, app.RunKindMaintenance)
			app.FinishRun(a, id, tc.err, nil)

			ev, ok := next()
			if !ok {
				t.Fatal("no run-finished emitted")
			}
			if ev.RunID != id || ev.Kind != "maintenance" || ev.Outcome != tc.wantOutcome {
				t.Errorf("run-finished = %+v, want run %d maintenance %s", ev, id, tc.wantOutcome)
			}
			if tc.wantOutcome == "failed" && ev.Error != "disk full" {
				t.Errorf("error = %q, want the run's error", ev.Error)
			}
			noMoreRunFinished(t, next)
		})
	}
}

// The traced bug: a parse that failed after POST /parses had answered 202
// emitted nothing, so the client waited on a run that had already ended —
// Stop showing, Run hidden, folder controls locked, the error unseen.
func TestStartParse_AFailedRunStillSaysItEnded(t *testing.T) {
	a, _ := newParseReadyApp(t)
	next := subscribeRunFinished(t, a)
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 2, "a.png", nil, errors.New("unreadable"))
		return errors.New("screenshots folder vanished")
	})

	id, err := a.StartParse(false)
	if err != nil {
		t.Fatalf("StartParse = %v", err)
	}
	ev, ok := next()
	if !ok {
		t.Fatal("the failed run emitted no run-finished")
	}
	if ev.RunID != id || ev.Kind != "parse" || ev.Outcome != "failed" || ev.Error != "screenshots folder vanished" {
		t.Errorf("run-finished = %+v, want run %d parse failed with its error", ev, id)
	}
	if got := activeJSON(t, a)["state"]; got != "idle" {
		t.Errorf("state after the failed run = %v, want idle", got)
	}
}

// A panic inside the run still releases the slot and says the run failed.
func TestStartParse_APanickingRunStillEnds(t *testing.T) {
	a, _ := newParseReadyApp(t)
	next := subscribeRunFinished(t, a)
	stubParse(t, func(parser.ProgressFunc) error { panic("boom") })

	if _, err := a.StartParse(false); err != nil {
		t.Fatalf("StartParse = %v", err)
	}
	ev, ok := next()
	if !ok || ev.Outcome != "failed" {
		t.Fatalf("run-finished = %+v (%v), want failed", ev, ok)
	}
	if got := activeJSON(t, a)["state"]; got != "idle" {
		t.Errorf("state after the panic = %v, want idle", got)
	}
}

// A completed parse carries its tally; a canceled one is not an error to
// the synchronous caller.
func TestParseScreenshots_EndsWithItsOutcome(t *testing.T) {
	t.Run("completed", func(t *testing.T) {
		a, _ := newParseReadyApp(t)
		next := subscribeRunFinished(t, a)
		stubParse(t, func(progress parser.ProgressFunc) error {
			progress(1, 1, "a.png", nil, errors.New("unreadable"))
			return nil
		})
		if err := a.ParseScreenshots(); err != nil {
			t.Fatalf("ParseScreenshots = %v", err)
		}
		ev, ok := next()
		if !ok || ev.Outcome != "completed" || ev.Summary == nil || ev.Summary.FilesFailed != 1 {
			t.Errorf("run-finished = %+v (%v), want completed with files_failed 1", ev, ok)
		}
	})
	t.Run("canceled", func(t *testing.T) {
		a, _ := newParseReadyApp(t)
		next := subscribeRunFinished(t, a)
		stubParse(t, func(parser.ProgressFunc) error { return context.Canceled })
		if err := a.ParseScreenshots(); err != nil {
			t.Fatalf("ParseScreenshots = %v, want nil for a canceled run", err)
		}
		ev, ok := next()
		if !ok || ev.Outcome != "canceled" || ev.Summary != nil {
			t.Errorf("run-finished = %+v (%v), want canceled with no summary", ev, ok)
		}
	})
}

// Every progress event names the run it belongs to, so a client can tell a
// late event from a finished run apart from the run it is watching.
func TestParseScreenshots_ProgressCarriesTheRunID(t *testing.T) {
	a, _ := newParseReadyApp(t)
	a.SSEHub = app.NewSSEHub()
	events := a.SSEHub.Subscribe()
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, "a.png", nil, errors.New("unreadable"))
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots = %v", err)
	}
	var progressID, finishedID app.RunID
	for progressID == 0 || finishedID == 0 {
		select {
		case msg := <-events:
			var ev struct {
				RunID app.RunID `json:"run_id"`
			}
			_ = json.Unmarshal([]byte(msg.Data), &ev)
			switch msg.Event {
			case "parse-progress":
				progressID = ev.RunID
			case "run-finished":
				finishedID = ev.RunID
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("progress id %d, finished id %d: an event was missing", progressID, finishedID)
		}
	}
	if progressID != finishedID {
		t.Errorf("progress carried run %d, run-finished %d", progressID, finishedID)
	}
}
