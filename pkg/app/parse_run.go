package app

import (
	"context"
	"errors"

	"recall/pkg/applog"
)

// Parse run lifecycle: the single-flight run-state machine (claim / end /
// cancel / progress snapshot) plus the sync + async entry points that drive
// it. The OCR loop body itself lives in parse.go.

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

// CancelParse short-circuits an in-flight ParseScreenshots at the
// next between-files boundary by canceling the context the parser
// loop is checking. Returns ErrNoParseInFlight when no parse is
// running. Wails-bound so the desktop Stop button drives it via the
// generated bindings; also reachable via DELETE /api/v1/parses/active
// for server mode.
//
// Cancellation IS NOT immediate — the file currently in OCR
// completes (tesseract is a shell-out, not context-aware) before
// the loop unwinds. Empirically OCR is 1-3 s/file so the user
// notices the difference vs the full batch within seconds.
func (a *App) CancelParse() error {
	a.parseCancelMu.Lock()
	defer a.parseCancelMu.Unlock()
	if a.parseCancel == nil {
		return ErrNoParseInFlight
	}
	a.parseCancel()
	return nil
}

// ActiveParseStatus is the GET /api/v1/parses/active snapshot — enough
// for a reconnecting / reloading client to decide "is a parse running,
// and how far along" without the SSE backlog (which isn't replayed on
// connect). The resync anchor for the async-job pipeline.
type ActiveParseStatus struct {
	Running bool   `json:"running"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Scope   string `json:"scope"`
}

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

// StartParse kicks off a parse in a BACKGROUND goroutine and returns
// immediately — the server's POST /api/v1/parses path. Progress +
// completion reach the client over SSE (parse-progress / parse-complete
// / parse-canceled); GET /api/v1/parses/active is the resync anchor.
// Preconditions are validated synchronously so the caller still gets a
// 409/500 before the 202; a parse already in flight returns
// ErrParseInFlight. This is what makes the run survive a client network
// drop — there's no held-open request to lose.
func (a *App) StartParse(force bool) error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	dir, err := a.validateParsePreconditions()
	if err != nil {
		return err
	}
	ctx, ok := a.claimParse(force)
	if !ok {
		return ErrParseInFlight
	}
	go func() {
		defer applog.RecoverPanic("parse")
		defer a.endParse()
		if runErr := a.runClaimedParse(ctx, force, dir); runErr != nil {
			applog.Subsystem("parse").Error("background parse failed", "err", runErr)
		}
	}()
	return nil
}

// parseSync runs a parse to completion on the caller's goroutine — the
// Wails IPC path, the watcher debounce, and Go tests all rely on the
// call blocking until the OCR loop finishes. Fail-fast single-flight
// (ErrParseInFlight) instead of queuing behind a held mutex.
func (a *App) parseSync(force bool) error {
	dir, err := a.validateParsePreconditions()
	if err != nil {
		return err
	}
	ctx, ok := a.claimParse(force)
	if !ok {
		return ErrParseInFlight
	}
	defer a.endParse()
	return a.runClaimedParse(ctx, force, dir)
}

// ActiveParse returns the current run-state snapshot.
func (a *App) ActiveParse() ActiveParseStatus {
	a.parseCancelMu.Lock()
	defer a.parseCancelMu.Unlock()
	return ActiveParseStatus{
		Running: a.parseRunning,
		Done:    a.parseDone,
		Total:   a.parseTotal,
		Scope:   a.parseScope,
	}
}

func scopeLabel(force bool) string {
	if force {
		return "all"
	}
	return "new"
}

// claimParse takes the single-flight slot: false when a parse is already
// running. On success it stamps the run-state snapshot + creates the
// cancel ctx the OCR loop checks between files. Paired with endParse.
func (a *App) claimParse(force bool) (context.Context, bool) {
	return a.claimRunSlot(scopeLabel(force))
}

// claimRunSlot takes the single-flight slot for any operation that needs
// the store to itself — OCR runs and profile activations alike (a store
// swap under a live parse would close the handle out from under the
// loop). scope labels the run for the ActiveParse resync snapshot.
func (a *App) claimRunSlot(scope string) (context.Context, bool) {
	a.parseCancelMu.Lock()
	defer a.parseCancelMu.Unlock()
	if a.parseRunning {
		return nil, false
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.parseRunning = true
	a.parseCancel = cancel
	a.parseScope = scope
	a.parseDone, a.parseTotal = 0, 0
	return ctx, true
}

// endParse releases the single-flight slot and cancels the ctx (a no-op
// after normal completion; the signal that unwinds the loop on cancel).
func (a *App) endParse() {
	a.parseCancelMu.Lock()
	defer a.parseCancelMu.Unlock()
	if a.parseCancel != nil {
		a.parseCancel()
	}
	a.parseRunning = false
	a.parseCancel = nil
}

// noteProgress snapshots the per-file counter so GET /parses/active can
// report how far along a running parse is to a resyncing client.
func (a *App) noteProgress(done, total int) {
	a.parseCancelMu.Lock()
	a.parseDone, a.parseTotal = done, total
	a.parseCancelMu.Unlock()
}
