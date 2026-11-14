package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// RunKind names what holds the single-flight run slot. Every operation that
// needs the store to itself claims the slot — OCR runs and the store swaps
// alike — and the kind is what lets a client tell them apart: only a parse
// can be canceled, and only a parse has progress worth drawing.
type RunKind string

const (
	// RunKindParse is a normal parse of the files not yet ingested.
	RunKindParse RunKind = "parse"
	// RunKindReparse is Re-parse All: every file in the folder, re-OCR'd.
	RunKindReparse RunKind = "reparse"
	// RunKindRestore swaps in a database snapshot.
	RunKindRestore RunKind = "restore"
	// RunKindMaintenance runs OPTIMIZE or VACUUM.
	RunKindMaintenance RunKind = "maintenance"
	// RunKindProfileSwitch activates another profile.
	RunKindProfileSwitch RunKind = "profile_switch"
	// RunKindProfileRename renames the active profile.
	RunKindProfileRename RunKind = "profile_rename"
	// RunKindScreenshotTakeover moves screenshots another profile owns.
	RunKindScreenshotTakeover RunKind = "screenshot_takeover"
)

// cancelable reports whether CancelParse may stop a run of this kind. The
// store swaps are not: stopping one halfway would strand the app between two
// databases.
func (k RunKind) cancelable() bool {
	switch k {
	case RunKindParse, RunKindReparse:
		return true
	case RunKindRestore, RunKindMaintenance, RunKindProfileSwitch,
		RunKindProfileRename, RunKindScreenshotTakeover:
		return false
	}
	return false
}

// RunPhase is where the run slot stands.
type RunPhase string

const (
	// RunPhaseIdle holds no run.
	RunPhaseIdle RunPhase = "idle"
	// RunPhaseRunning holds a run.
	RunPhaseRunning RunPhase = "running"
	// RunPhaseCanceling holds a run asked to stop, which stops at the next
	// between-files boundary.
	RunPhaseCanceling RunPhase = "canceling"
)

// RunOutcome is how a run ended.
type RunOutcome string

const (
	// RunOutcomeCompleted ran to the end.
	RunOutcomeCompleted RunOutcome = "completed"
	// RunOutcomeCanceled was stopped by CancelParse.
	RunOutcomeCanceled RunOutcome = "canceled"
	// RunOutcomeFailed stopped on an error.
	RunOutcomeFailed RunOutcome = "failed"
)

// RunID identifies one claim of the run slot. Ids grow across the process and
// start from the boot clock, so a browser tab that outlives a server restart
// never mistakes a new run for one it already saw finish.
type RunID int64

// ErrRunNotCancelable is returned by CancelParse when the slot is held by a
// run that cannot be stopped (a restore, a profile switch, …). The HTTP layer
// maps it to 409.
var ErrRunNotCancelable = errors.New("the running operation cannot be canceled")

// errStaleRun is a progress report or end for a run that no longer holds the
// slot. It never reaches a caller: it marks a transition the slot refused.
var errStaleRun = errors.New("stale run")

// runSlot is the single-flight run state: a value each transition steps to
// the next, held by App under runMu. The zero runSlot is idle, never claimed.
// Nothing outside this file assigns its fields.
type runSlot struct {
	phase  RunPhase
	id     RunID
	kind   RunKind
	cancel context.CancelFunc
	done   int
	total  int
	// lastID is the most recent id handed out, kept across idle so ids
	// never repeat.
	lastID RunID
}

func newRunSlot(now time.Time) runSlot {
	return runSlot{phase: RunPhaseIdle, lastID: RunID(now.UnixMicro())}
}

// claim takes an idle slot for a run of kind, which cancel stops.
func (s runSlot) claim(kind RunKind, cancel context.CancelFunc) (runSlot, error) {
	if s.phase != RunPhaseIdle {
		return s, ErrParseInFlight
	}
	id := s.lastID + 1
	return runSlot{phase: RunPhaseRunning, id: id, kind: kind, cancel: cancel, lastID: id}, nil
}

// progress records how far run id has got.
func (s runSlot) progress(id RunID, done, total int) (runSlot, error) {
	if s.phase == RunPhaseIdle || s.id != id {
		return s, errStaleRun
	}
	s.done, s.total = done, total
	return s, nil
}

// requestCancel asks the run holding the slot to stop. Asking twice is the
// same as asking once.
func (s runSlot) requestCancel() (runSlot, error) {
	switch s.phase {
	case RunPhaseIdle:
		return s, ErrNoParseInFlight
	case RunPhaseCanceling:
		return s, nil
	case RunPhaseRunning:
		if !s.kind.cancelable() {
			return s, ErrRunNotCancelable
		}
		s.phase = RunPhaseCanceling
		return s, nil
	}
	return s, fmt.Errorf("run slot in unknown phase %q", s.phase)
}

// end releases the slot held by run id.
func (s runSlot) end(id RunID) (runSlot, error) {
	if s.phase == RunPhaseIdle || s.id != id {
		return s, errStaleRun
	}
	return runSlot{phase: RunPhaseIdle, lastID: s.lastID}, nil
}

// ActiveRun is the GET /api/v1/parses/active snapshot — the resync anchor for
// a client that reconnects or reloads, since events are not replayed. An idle
// slot carries nothing but its phase.
type ActiveRun struct {
	Phase RunPhase
	ID    RunID
	Kind  RunKind
	Done  int
	Total int
}

func (s runSlot) snapshot() ActiveRun {
	if s.phase == RunPhaseIdle {
		return ActiveRun{Phase: RunPhaseIdle}
	}
	return ActiveRun{Phase: s.phase, ID: s.id, Kind: s.kind, Done: s.done, Total: s.total}
}

type activeRunIdleJSON struct {
	State RunPhase `json:"state"`
}

type activeRunBusyJSON struct {
	State RunPhase `json:"state"`
	RunID RunID    `json:"run_id"`
	Kind  RunKind  `json:"kind"`
	Done  int      `json:"done"`
	Total int      `json:"total"`
}

// MarshalJSON writes the shape the phase allows: an idle snapshot has no run
// to describe, so it says only that it is idle.
func (r ActiveRun) MarshalJSON() ([]byte, error) {
	if r.Phase == RunPhaseIdle || r.Phase == "" {
		return json.Marshal(activeRunIdleJSON{State: RunPhaseIdle})
	}
	return json.Marshal(activeRunBusyJSON{State: r.Phase, RunID: r.ID, Kind: r.Kind, Done: r.Done, Total: r.Total})
}

// RunFinishedEvent is the payload of the run-finished event, emitted exactly
// once for every run that claimed the slot, however it ended. Summary rides a
// parse that completed; Error, a run that failed.
type RunFinishedEvent struct {
	RunID   RunID            `json:"run_id"`
	Kind    RunKind          `json:"kind"`
	Outcome RunOutcome       `json:"outcome"`
	Summary *ParseRunSummary `json:"summary,omitempty"`
	Error   string           `json:"error,omitempty"`
}

// outcomeOf classifies how a run's work returned.
func outcomeOf(err error) RunOutcome {
	switch {
	case err == nil:
		return RunOutcomeCompleted
	case errors.Is(err, context.Canceled):
		return RunOutcomeCanceled
	default:
		return RunOutcomeFailed
	}
}

// errRunPanicked stands in for the result of a run whose work panicked, so
// the slot still ends — and says so — on the way out.
var errRunPanicked = errors.New("the run stopped unexpectedly")

// claimRun takes the run slot for a run of kind: ErrParseInFlight when it is
// held. The returned ctx is canceled by CancelParse (cancelable kinds) and by
// the run's end. Every successful claim must be paired with finishRun.
func (a *App) claimRun(kind RunKind) (context.Context, RunID, error) {
	ctx, cancel := context.WithCancel(context.Background())
	a.runMu.Lock()
	defer a.runMu.Unlock()
	next, err := a.run.claim(kind, cancel)
	if err != nil {
		cancel()
		return nil, 0, err
	}
	a.run = next
	return ctx, next.id, nil
}

// finishRun releases the slot held by run id and emits its run-finished
// event. summary is the parse tally when there is one.
func (a *App) finishRun(id RunID, workErr error, summary *ParseRunSummary) {
	a.runMu.Lock()
	kind, cancel := a.run.kind, a.run.cancel
	next, err := a.run.end(id)
	if err == nil {
		a.run = next
	}
	a.runMu.Unlock()
	if err != nil {
		return
	}
	if cancel != nil {
		cancel()
	}
	a.runSlotReleased()
	ev := RunFinishedEvent{RunID: id, Kind: kind, Outcome: outcomeOf(workErr)}
	switch ev.Outcome {
	case RunOutcomeCompleted:
		ev.Summary = summary
	case RunOutcomeFailed:
		ev.Error = workErr.Error()
	case RunOutcomeCanceled:
	}
	a.emitRunFinished(ev)
}

// withRunSlot runs work holding the run slot as a run of kind, for the
// operations that need the store to themselves but report no progress.
func (a *App) withRunSlot(kind RunKind, work func() error) (err error) {
	_, id, claimErr := a.claimRun(kind)
	if claimErr != nil {
		return claimErr
	}
	err = errRunPanicked
	defer func() { a.finishRun(id, err, nil) }()
	err = work()
	return err
}

// noteProgress records how far run id has got, for the resync snapshot. A
// report from a run that no longer holds the slot changes nothing.
func (a *App) noteProgress(id RunID, done, total int) {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	if next, err := a.run.progress(id, done, total); err == nil {
		a.run = next
	}
}

// CancelParse asks the parse holding the run slot to stop at the next
// between-files boundary (the file in OCR finishes first; tesseract is a
// shell-out, not context-aware). ErrNoParseInFlight when nothing runs;
// ErrRunNotCancelable when the slot is held by a store swap. Wails-bound for
// the desktop Stop button; DELETE /api/v1/parses/active in server mode.
func (a *App) CancelParse() error {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	next, err := a.run.requestCancel()
	if err != nil {
		return err
	}
	a.run = next
	a.run.cancel()
	return nil
}

// ActiveParse returns the run slot's current snapshot.
func (a *App) ActiveParse() ActiveRun {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	return a.run.snapshot()
}
