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

// PickTesseractBinary is not available in server mode (no native dialogs).
// The HTTP API exposes POST /api/tesseract-path for the same purpose.
func (a *App) PickTesseractBinary() (TesseractStatus, error) {
	return a.tessStatus, fmt.Errorf("native dialogs unavailable in server mode; use POST /api/tesseract-path")
}

// PickScreenshotsDir is not available in server mode (no native dialogs).
// The HTTP API exposes POST /api/screenshots-dir for the same purpose.
func (a *App) PickScreenshotsDir() (string, error) {
	return a.settings.ScreenshotsDir, fmt.Errorf("native dialogs unavailable in server mode; use POST /api/screenshots-dir")
}
