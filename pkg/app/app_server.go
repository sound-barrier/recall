//go:build serveronly

package app

import (
	"encoding/json"
	"errors"

	"recall/pkg/match"
)

// emitParseProgress broadcasts per-file progress to SSE subscribers.
// `a.SSEHub` is read once, atomically; `SSEHub.BroadcastData` itself
// is nil-safe, so the parse loop can fire without a TOCTOU check.
func (a *App) emitParseProgress(p ParseProgressEvent) {
	data, _ := json.Marshal(p)
	a.SSEHub.BroadcastData("parse-progress", string(data))
}

// emitWatchActivity broadcasts the watcher's pending-file tally to SSE
// subscribers — the masthead's "watching · N new" dot.
func (a *App) emitWatchActivity(ev WatchActivityEvent) {
	data, _ := json.Marshal(ev)
	a.SSEHub.BroadcastData("watch-activity", string(data))
}

// emitMatchUpdated broadcasts a freshly-aggregated match.Record to SSE
// subscribers. Counterpart to the Wails build's variant — same wire
// shape, server-only emit path.
func (a *App) emitMatchUpdated(rec match.Record) {
	data, _ := json.Marshal(rec)
	a.SSEHub.BroadcastData("match-updated", string(data))
}

// emitTesseractStatus broadcasts the background-probe status to SSE
// subscribers (server mode has no Wails event bus).
func (a *App) emitTesseractStatus(s TesseractStatus) {
	data, _ := json.Marshal(s)
	a.SSEHub.BroadcastData("tesseract-status", string(data))
}

// emitCoachSessionChanged broadcasts the coaching session's open/closed
// state to SSE subscribers — the server-mode twin of the Wails emit, so
// every connected tab flips its write gate together.
func (a *App) emitCoachSessionChanged(active bool) {
	data, _ := json.Marshal(CoachSessionChangedEvent{Active: active})
	a.SSEHub.BroadcastData("coach-session-changed", string(data))
}

// emitParseComplete broadcasts the run summary to SSE subscribers —
// server mode has no Wails event bus and no desktop notification.
// Terminal event → BroadcastTerminal, so a slow consumer's full buffer
// can't drop it (the spinner would strand).
func (a *App) emitParseComplete(s ParseRunSummary) {
	data, _ := json.Marshal(s)
	a.SSEHub.BroadcastTerminal("parse-complete", string(data))
}

// emitParseCanceled is the SSE-only sibling of the Wails twin in
// app_wails.go (which also emits on the desktop event bus). Lets the
// frontend distinguish "stopped" from "done" without polling.
func (a *App) emitParseCanceled() {
	a.SSEHub.Broadcast("parse-canceled")
}

// SaveBackupToFile is not available in server mode (no native dialogs).
// The HTTP API exposes GET /api/v1/database which streams the same snapshot.
func (a *App) SaveBackupToFile() (string, error) {
	return "", errors.New("native dialogs unavailable in server mode; use GET /api/v1/database")
}

// SaveBundleToFile is not available in server mode (no native dialogs).
// The HTTP API exposes POST /api/v1/exports/bundle for the same payload.
func (a *App) SaveBundleToFile(_ []string, _, _ bool) (string, error) {
	return "", errors.New("native dialogs unavailable in server mode; use POST /api/v1/exports/bundle")
}

// SaveShareBundleToFile is not available in server mode (no native dialogs).
// The HTTP API exposes POST /api/v1/exports/bundle, whose optional `share`
// block produces the same identified payload.
func (a *App) SaveShareBundleToFile(_ []string, _, _ bool, _ SharePlayer) (string, error) {
	return "", errors.New("native dialogs unavailable in server mode; use POST /api/v1/exports/bundle with a share block")
}

// SaveDiagnosticBundleToFile is not available in server mode (no native
// dialogs). The HTTP API exposes POST /api/v1/exports/diagnostic for
// the same payload.
func (a *App) SaveDiagnosticBundleToFile() (string, error) {
	return "", errors.New("native dialogs unavailable in server mode; use POST /api/v1/exports/diagnostic")
}

// SaveTextToFile is not available in server mode (no native dialogs). The
// browser builds the CSV Blob and triggers a download client-side, so no
// server round-trip is needed.
func (a *App) SaveTextToFile(_, _ string) (string, error) {
	return "", errors.New("native dialogs unavailable in server mode; the browser downloads the CSV client-side")
}

// SaveWebPageToFile is not available in server mode (no native dialogs).
// The browser builds the HTML Blob and triggers a download client-side, so
// no server round-trip is needed.
func (a *App) SaveWebPageToFile(_, _, _ string) (string, error) {
	return "", errors.New("native dialogs unavailable in server mode; the browser downloads the page client-side")
}

// LoadRestoreFromFile is not available in server mode (no native dialogs).
// The HTTP API exposes PUT /api/v1/database which accepts the same snapshot.
func (a *App) LoadRestoreFromFile() (string, error) {
	return "", errors.New("native dialogs unavailable in server mode; use PUT /api/v1/database")
}

// LoadMatchImportFromFile is not available in server mode (no native dialogs).
// The HTTP API exposes POST /api/v1/imports which accepts the same bundle.
func (a *App) LoadMatchImportFromFile() (MatchImportResult, error) {
	return MatchImportResult{}, errors.New("native dialogs unavailable in server mode; use POST /api/v1/imports")
}

// LoadCoachBundleFromFile is not available in server mode (no native
// dialogs). The HTTP API exposes POST /api/v1/coach/session, which takes
// the same bundle bytes.
func (a *App) LoadCoachBundleFromFile() (CoachSessionResult, error) {
	return CoachSessionResult{}, errors.New("native dialogs unavailable in server mode; use POST /api/v1/coach/session")
}

// SaveCoachNotesToFile is not available in server mode (no native
// dialogs). The HTTP API exposes POST /api/v1/coach/session/export, which
// streams the same archive.
func (a *App) SaveCoachNotesToFile() (string, error) {
	return "", errors.New("native dialogs unavailable in server mode; use POST /api/v1/coach/session/export")
}

// PickTesseractBinary is not available in server mode (no native dialogs).
// The HTTP API exposes PUT /api/v1/settings/tesseract for the same purpose.
func (a *App) PickTesseractBinary() (TesseractStatus, error) {
	return a.tessStatusSnapshot(), errors.New("native dialogs unavailable in server mode; use PUT /api/v1/settings/tesseract")
}

// PickScreenshotsDir is not available in server mode (no native dialogs).
// The HTTP API exposes PUT /api/v1/settings/screenshots-folder for the same purpose.
func (a *App) PickScreenshotsDir() (string, error) {
	return a.settingsSnapshot().ScreenshotsDir, errors.New("native dialogs unavailable in server mode; use PUT /api/v1/settings/screenshots-folder")
}
