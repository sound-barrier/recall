//go:build !serveronly

package app

import (
	"encoding/json"
	"os"
	"path/filepath"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// emitParseProgress sends per-file progress data to the Wails event bus
// and (when running in --server mode with the Wails binary) to the SSE hub.
func (a *App) emitParseProgress(p ParseProgressEvent) {
	data, _ := json.Marshal(p)
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "parse-progress", p)
	}
	if a.SSEHub != nil {
		a.SSEHub.BroadcastData("parse-progress", string(data))
	}
}

// emitParseComplete notifies the Wails frontend that a parse run finished.
// Called from scheduleParseDebounced; gated by the !serveronly build tag so
// the wruntime import is absent from server-only binaries.
func (a *App) emitParseComplete() {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "parse-complete")
	}
	// Also broadcast via SSE when the Wails binary is run with --server.
	if a.SSEHub != nil {
		a.SSEHub.Broadcast("parse-complete")
	}
}

// PickTesseractBinary opens a native file chooser and applies the selection
// via SetTesseractPath. Returns the resulting status; on cancel the existing
// status is returned unchanged.
func (a *App) PickTesseractBinary() (TesseractStatus, error) {
	dflt := a.settings.TesseractPath
	if dflt == "" {
		dflt = defaultTesseractPath()
	}
	dir := filepath.Dir(dflt)
	if _, err := os.Stat(dir); err != nil {
		dir = ""
	}
	file, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:            "Select Tesseract binary",
		DefaultDirectory: dir,
		Filters: []wruntime.FileFilter{
			{DisplayName: "Tesseract executable", Pattern: "tesseract*"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return a.tessStatus, err
	}
	if file == "" {
		return a.tessStatus, nil
	}
	return a.SetTesseractPath(file)
}

// PickScreenshotsDir opens a native directory chooser and persists the
// selection. Returns the chosen path. If the user cancels the dialog
// (Wails returns "" with no error), the existing setting is left alone.
func (a *App) PickScreenshotsDir() (string, error) {
	dflt := a.settings.ScreenshotsDir
	if _, err := os.Stat(dflt); err != nil {
		dflt = ""
	}
	dir, err := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:                "Select Overwatch screenshots folder",
		DefaultDirectory:     dflt,
		CanCreateDirectories: false,
	})
	if err != nil {
		return a.settings.ScreenshotsDir, err
	}
	if dir == "" {
		return a.settings.ScreenshotsDir, nil
	}
	// Route through SetScreenshotsDir so the path passes the same
	// validation as the /api/screenshots-dir HTTP endpoint — the
	// native dialog is trusted but funneling everything through one
	// validator keeps behavior consistent between Wails and server mode.
	if err := a.SetScreenshotsDir(dir); err != nil {
		return a.settings.ScreenshotsDir, err
	}
	if a.settings.WatchEnabled {
		a.stopWatching()
		a.startWatching()
	}
	return a.settings.ScreenshotsDir, nil
}
