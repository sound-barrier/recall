//go:build !serveronly

package main

import (
	"path/filepath"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// emitParseComplete notifies the Wails frontend that a parse run finished.
// Called from scheduleParseDebounced; gated by the !serveronly build tag so
// the wruntime import is absent from server-only binaries.
func (a *App) emitParseComplete() {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "parse-complete")
	}
	// Also broadcast via SSE when the Wails binary is run with --server.
	if a.sseHub != nil {
		a.sseHub.broadcast("parse-complete")
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
	file, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:            "Select Tesseract binary",
		DefaultDirectory: filepath.Dir(dflt),
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
	dir, err := wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:                "Select Overwatch screenshots folder",
		DefaultDirectory:     a.settings.ScreenshotsDir,
		CanCreateDirectories: false,
	})
	if err != nil {
		return a.settings.ScreenshotsDir, err
	}
	if dir == "" {
		return a.settings.ScreenshotsDir, nil
	}
	a.settings.ScreenshotsDir = dir
	if err := saveSettings(a.settings); err != nil {
		return a.settings.ScreenshotsDir, err
	}
	if a.settings.WatchEnabled {
		a.stopWatching()
		a.startWatching()
	}
	return a.settings.ScreenshotsDir, nil
}
