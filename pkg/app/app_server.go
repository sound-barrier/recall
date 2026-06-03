//go:build serveronly

package app

import (
	"encoding/json"
	"fmt"
)

// emitParseProgress broadcasts per-file progress to SSE subscribers.
func (a *App) emitParseProgress(p ParseProgressEvent) {
	if a.SSEHub == nil {
		return
	}
	data, _ := json.Marshal(p)
	a.SSEHub.BroadcastData("parse-progress", string(data))
}

// emitMatchUpdated broadcasts a freshly-aggregated MatchRecord to SSE
// subscribers. Counterpart to the Wails build's variant — same wire
// shape, server-only emit path.
func (a *App) emitMatchUpdated(rec MatchRecord) {
	if a.SSEHub == nil {
		return
	}
	data, _ := json.Marshal(rec)
	a.SSEHub.BroadcastData("match-updated", string(data))
}

// emitParseComplete is a no-op in server mode — the SSE hub handles
// parse-complete notifications instead of the Wails event bus.
func (a *App) emitParseComplete() {
	if a.SSEHub != nil {
		a.SSEHub.Broadcast("parse-complete")
	}
}

// emitParseCancelled is the SSE-only sibling of emitParseCancelled
// in app_wails.go. Lets the frontend distinguish "stopped" from
// "done" without polling.
func (a *App) emitParseCancelled() {
	if a.SSEHub != nil {
		a.SSEHub.Broadcast("parse-cancelled")
	}
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
