package app

import (
	"context"
	"errors"

	"recall/pkg/applog"
)

// The parse entry points: the sync and async paths that claim the run slot
// (run_slot.go) as a parse and drive the OCR loop (parse.go).

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
