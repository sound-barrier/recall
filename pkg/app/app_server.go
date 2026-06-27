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

// emitMatchUpdated broadcasts a freshly-aggregated match.MatchRecord to SSE
// subscribers. Counterpart to the Wails build's variant — same wire
// shape, server-only emit path.
func (a *App) emitMatchUpdated(rec match.MatchRecord) {
	data, _ := json.Marshal(rec)
	a.SSEHub.BroadcastData("match-updated", string(data))
}

// emitTesseractStatus broadcasts the background-probe status to SSE
// subscribers (server mode has no Wails event bus).
func (a *App) emitTesseractStatus(s TesseractStatus) {
	data, _ := json.Marshal(s)
	a.SSEHub.BroadcastData("tesseract-status", string(data))
}

// emitParseComplete is a no-op in server mode — the SSE hub handles
// parse-complete notifications instead of the Wails event bus.
func (a *App) emitParseComplete() {
	a.SSEHub.Broadcast("parse-complete")
}

// emitParseCancelled is the SSE-only sibling of emitParseCancelled
// in app_wails.go. Lets the frontend distinguish "stopped" from
// "done" without polling.
func (a *App) emitParseCancelled() {
	a.SSEHub.Broadcast("parse-cancelled")
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

// SaveTextToFile is not available in server mode (no native dialogs). The
// browser builds the CSV Blob and triggers a download client-side, so no
// server round-trip is needed.
func (a *App) SaveTextToFile(_, _ string) (string, error) {
	return "", errors.New("native dialogs unavailable in server mode; the browser downloads the CSV client-side")
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

// PickTesseractBinary is not available in server mode (no native dialogs).
// The HTTP API exposes PUT /api/v1/settings/tesseract for the same purpose.
func (a *App) PickTesseractBinary() (TesseractStatus, error) {
	return a.tessStatusSnapshot(), errors.New("native dialogs unavailable in server mode; use PUT /api/v1/settings/tesseract")
}

// PickScreenshotsDir is not available in server mode (no native dialogs).
// The HTTP API exposes PUT /api/v1/settings/screenshots-folder for the same purpose.
func (a *App) PickScreenshotsDir() (string, error) {
	return a.settings.ScreenshotsDir, errors.New("native dialogs unavailable in server mode; use PUT /api/v1/settings/screenshots-folder")
}
