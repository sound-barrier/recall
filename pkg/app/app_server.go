//go:build serveronly

package app

import (
	"encoding/json"
	"fmt"

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

// SaveExportToFile is not available in server mode (no native dialogs).
// The HTTP API exposes GET /api/v1/exports which streams the same payload.
func (a *App) SaveExportToFile() (string, error) {
	return "", fmt.Errorf("native dialogs unavailable in server mode; use GET /api/v1/exports")
}

// SaveExportToFileCSV is not available in server mode (no native dialogs).
// The HTTP API exposes GET /api/v1/exports?format=csv for the same payload.
func (a *App) SaveExportToFileCSV() (string, error) {
	return "", fmt.Errorf("native dialogs unavailable in server mode; use GET /api/v1/exports?format=csv")
}

// SaveBundleToFile is not available in server mode (no native dialogs).
// The HTTP API exposes POST /api/v1/exports/bundle for the same payload.
func (a *App) SaveBundleToFile(_ []string, _, _ bool) (string, error) {
	return "", fmt.Errorf("native dialogs unavailable in server mode; use POST /api/v1/exports/bundle")
}

// SaveTextToFile is not available in server mode (no native dialogs). The
// browser builds the CSV Blob and triggers a download client-side, so no
// server round-trip is needed.
func (a *App) SaveTextToFile(_, _ string) (string, error) {
	return "", fmt.Errorf("native dialogs unavailable in server mode; the browser downloads the CSV client-side")
}

// LoadImportFromFile is not available in server mode (no native dialogs).
// The HTTP API exposes POST /api/v1/imports which accepts the same payload.
func (a *App) LoadImportFromFile() (string, error) {
	return "", fmt.Errorf("native dialogs unavailable in server mode; use POST /api/v1/imports")
}

// PickTesseractBinary is not available in server mode (no native dialogs).
// The HTTP API exposes PUT /api/v1/settings/tesseract for the same purpose.
func (a *App) PickTesseractBinary() (TesseractStatus, error) {
	return a.tessStatus, fmt.Errorf("native dialogs unavailable in server mode; use PUT /api/v1/settings/tesseract")
}

// PickScreenshotsDir is not available in server mode (no native dialogs).
// The HTTP API exposes PUT /api/v1/settings/screenshots-folder for the same purpose.
func (a *App) PickScreenshotsDir() (string, error) {
	return a.settings.ScreenshotsDir, fmt.Errorf("native dialogs unavailable in server mode; use PUT /api/v1/settings/screenshots-folder")
}
