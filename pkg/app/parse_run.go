package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"recall/pkg/applog"
)

// The single-flight run slot — one explicit state machine every operation
// that needs the store to itself claims — and the parse entry points that
// drive it. The OCR loop body lives in parse.go.

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

// ErrStoreSwapInProgress is returned by an operation that needs the store
// while a restore, profile switch or rename has it closed. The HTTP layer
// maps it to 409; the caller retries once the swap ends.
var ErrStoreSwapInProgress = errors.New("the database is being swapped — retry in a moment")

// swapsStore reports whether a run of this kind closes the store while it
// runs.
func (k RunKind) swapsStore() bool {
	switch k {
	case RunKindRestore, RunKindProfileSwitch, RunKindProfileRename:
		return true
	case RunKindParse, RunKindReparse, RunKindMaintenance, RunKindScreenshotTakeover:
		return false
	}
	return false
}

// storeSwapping reports whether a store swap holds the run slot now.
func (a *App) storeSwapping() bool {
	a.runMu.Lock()
	defer a.runMu.Unlock()
	return a.run.phase != RunPhaseIdle && a.run.kind.swapsStore()
}

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

// The parse entry points: the sync and async paths that claim the run slot
// as a parse and drive the OCR loop (parse.go).

// ErrNoParseInFlight is returned by CancelParse when no parse is
// running. The HTTP layer maps this to 409 Conflict — the request
// was well-formed, the server's runtime state just doesn't have
// anything to cancel.
var ErrNoParseInFlight = errors.New("no parse in flight")

// ErrParseInFlight is returned by the parse entry points when a parse
// is already running. Single-flight is fail-fast (not queued): a second
// trigger — a user click, a watcher debounce, or a concurrent POST —
// gets this rather than waiting behind the running loop. The HTTP layer
// maps it to 409 Conflict.
var ErrParseInFlight = errors.New("a parse is already in flight")

// ReParseAll re-runs the OCR pipeline against every PNG in the
// watched folder, including ones that are already in the per-type
// tables. The Upsert clauses are idempotent on filename (ON CONFLICT
// UPDATE) so existing rows are rewritten in place — the user's
// match annotations, queue overrides, play-mode overrides, hidden
// flags, and reviews all key on match_key and survive the re-parse.
//
// Use case: after a parser-tightening release lands (e.g. the
// hero-fuzzy-match length-gate that stopped Miyazaki being
// attributed to Mei), the user clicks Settings → Advanced →
// Re-parse all screenshots to retroactively correct the older
// rows. ~1 s per screenshot end-to-end; the progress panel surfaces
// per-file events through the same SSE stream the watcher uses.
//
// Synchronous (blocks until the run finishes) — the Wails IPC path +
// Go tests rely on that. Server mode uses StartParse instead.
func (a *App) ReParseAll() error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	return a.parseSync(true)
}

// ParseScreenshots OCRs every image in screenshots/ and writes each
// result to its per-type table. Correlation (correlate.ResolveMatchKey) runs per
// screenshot in filename-timestamp order so cross-file deps (e.g. a
// PERSONAL adopting the SUMMARY it shares a match with) see the
// already-inserted siblings. Synchronous; see ReParseAll / StartParse.
// The coaching-session gate lives on the USER-initiated entry points
// (here, ReParseAll, StartParse) rather than in parseSync, because the
// folder watcher's debounce calls parseSync directly and must keep
// ingesting the coach's own screenshots into the coach's own store while a
// session is open (design rule 1).
func (a *App) ParseScreenshots() error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	return a.parseSync(false)
}

// StartParse kicks off a parse in a BACKGROUND goroutine and returns the
// run's id immediately — the server's POST /api/v1/parses path. Progress and
// the run's end reach the client as events (parse-progress / run-finished);
// GET /api/v1/parses/active is the resync anchor. Preconditions are validated
// synchronously so the caller still gets a 409/500 before the 202; a run
// already holding the slot returns ErrParseInFlight. This is what makes the
// run survive a client network drop — there's no held-open request to lose.
func (a *App) StartParse(force bool) (RunID, error) {
	if err := a.assertNoCoachSession(); err != nil {
		return 0, err
	}
	dir, err := a.validateParsePreconditions()
	if err != nil {
		return 0, err
	}
	ctx, id, err := a.claimRun(parseKind(force))
	if err != nil {
		return 0, err
	}
	go func() {
		defer applog.RecoverPanic("parse")
		// Nobody is waiting on this goroutine: the run's own run-finished
		// carries the error to the client.
		_ = a.runParse(ctx, id, force, dir)
	}()
	return id, nil
}

// parseSync runs a parse to completion on the caller's goroutine — the
// Wails IPC path, the watcher debounce, and Go tests all rely on the
// call blocking until the OCR loop finishes. Fail-fast single-flight
// (ErrParseInFlight) instead of queuing. A canceled run is not an error
// to the caller: the user asked for it, and run-finished says so.
func (a *App) parseSync(force bool) error {
	dir, err := a.validateParsePreconditions()
	if err != nil {
		return err
	}
	ctx, id, err := a.claimRun(parseKind(force))
	if err != nil {
		return err
	}
	if runErr := a.runParse(ctx, id, force, dir); runErr != nil && !errors.Is(runErr, context.Canceled) {
		return runErr
	}
	return nil
}

// runParse drives a claimed parse and ends its run whatever happens, the
// panic included — the one place a parse's run-finished is emitted.
func (a *App) runParse(ctx context.Context, id RunID, force bool, dir string) (err error) {
	var summary *ParseRunSummary
	err = errRunPanicked
	defer func() { a.finishRun(id, err, summary) }()
	s, err := a.runClaimedParse(ctx, id, force, dir)
	if err != nil {
		applog.Subsystem("parse").Error("parse run ended early", "outcome", outcomeOf(err), "err", err)
		return err
	}
	summary = &s
	return nil
}

func parseKind(force bool) RunKind {
	if force {
		return RunKindReparse
	}
	return RunKindParse
}
