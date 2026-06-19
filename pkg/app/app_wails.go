//go:build !serveronly

package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"recall/pkg/match"
)

// emitParseProgress sends per-file progress data to the Wails event bus
// and (when running in --server mode with the Wails binary) to the SSE hub.
// `SSEHub.BroadcastData` is nil-safe, so the bare call replaces the prior
// `if a.SSEHub != nil` check and removes the TOCTOU window between the
// check and the call.
func (a *App) emitParseProgress(p ParseProgressEvent) {
	data, _ := json.Marshal(p)
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "parse-progress", p)
	}
	a.SSEHub.BroadcastData("parse-progress", string(data))
}

// emitMatchUpdated broadcasts a freshly-aggregated match.MatchRecord to the
// Wails event bus and the SSE hub. Fired after each per-screenshot
// insert resolves a match_key so the frontend can incrementally
// render the affected card without waiting for parse-complete.
func (a *App) emitMatchUpdated(rec match.MatchRecord) {
	data, _ := json.Marshal(rec)
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "match-updated", rec)
	}
	a.SSEHub.BroadcastData("match-updated", string(data))
}

// emitTesseractStatus notifies the frontend that the background engine probe
// published a new status, so the System Alert / Engine row self-heals once a
// cold-boot Defender scan releases the binary — no app restart needed.
func (a *App) emitTesseractStatus(s TesseractStatus) {
	data, _ := json.Marshal(s)
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "tesseract-status", s)
	}
	a.SSEHub.BroadcastData("tesseract-status", string(data))
}

// emitParseComplete notifies the Wails frontend that a parse run finished.
// Called from scheduleParseDebounced; gated by the !serveronly build tag so
// the wruntime import is absent from server-only binaries.
func (a *App) emitParseComplete() {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "parse-complete")
	}
	// Also broadcast via SSE when the Wails binary is run with --server.
	a.SSEHub.Broadcast("parse-complete")
}

// emitParseCancelled notifies the frontend that a parse run was
// aborted via CancelParse. Distinct from parse-complete so the UI
// can render "stopped" vs "done" copy. Same emission shape as the
// other terminal lifecycle events — Wails event bus AND the SSE
// hub when present.
func (a *App) emitParseCancelled() {
	if a.ctx != nil {
		wruntime.EventsEmit(a.ctx, "parse-cancelled")
	}
	a.SSEHub.Broadcast("parse-cancelled")
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
		return a.tessStatusSnapshot(), err
	}
	if file == "" {
		return a.tessStatusSnapshot(), nil
	}
	return a.SetTesseractPath(file)
}

// SaveExportToFile opens a native save dialog, runs ExportData, and
// writes the resulting JSON to the chosen path. Returns the path on
// success; "" if the user cancelled.
func (a *App) SaveExportToFile() (string, error) {
	defaultName := "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".json"
	path, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:                "Save Recall export",
		DefaultFilename:      defaultName,
		CanCreateDirectories: true,
		Filters: []wruntime.FileFilter{
			{DisplayName: "Recall export (JSON)", Pattern: "*.json"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // user cancelled
	}
	data, err := a.ExportData()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("write export: %w", err)
	}
	return path, nil
}

// SaveExportToFileCSV is the CSV-format sibling of SaveExportToFile:
// opens a save dialog defaulting to `.zip` (the container that wraps
// the per-table CSVs + manifest.json) and writes the ExportDataCSV
// payload at the chosen path. Same return contract as the JSON variant.
func (a *App) SaveExportToFileCSV() (string, error) {
	defaultName := "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".zip"
	path, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:                "Save Recall export (CSV)",
		DefaultFilename:      defaultName,
		CanCreateDirectories: true,
		Filters: []wruntime.FileFilter{
			{DisplayName: "Recall export (ZIP of CSVs)", Pattern: "*.zip"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	data, err := a.ExportDataCSV()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("write csv export: %w", err)
	}
	return path, nil
}

// SaveTextToFile writes caller-supplied text (the flat one-row-per-match
// CSV the matches view assembles client-side) to a user-chosen path via a
// native save dialog. Generic on purpose — it takes the bytes already
// built in the frontend rather than regenerating from the store like the
// SaveExportToFile* family. Returns the chosen path, or "" if the user
// cancelled.
func (a *App) SaveTextToFile(defaultName, contents string) (string, error) {
	if defaultName == "" {
		defaultName = "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".csv"
	}
	path, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:                "Save match data (CSV)",
		DefaultFilename:      defaultName,
		CanCreateDirectories: true,
		Filters: []wruntime.FileFilter{
			{DisplayName: "CSV (Excel / Sheets)", Pattern: "*.csv"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		return "", fmt.Errorf("write text file: %w", err)
	}
	return path, nil
}

// SaveBundleToFile is the bundle-export sibling of SaveExportToFile.
// Pops a native SaveFileDialog defaulting to `recall-bundle-<ts>.zip`,
// then writes the ExportBundle payload to the chosen path. Returns
// the path on success, empty string + nil on user cancel.
func (a *App) SaveBundleToFile(matchKeys []string, includeUnknown, includeHidden bool) (string, error) {
	defaultName := "recall-bundle-" + time.Now().UTC().Format("20060102-150405") + ".zip"
	path, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:                "Save Recall bundle",
		DefaultFilename:      defaultName,
		CanCreateDirectories: true,
		Filters: []wruntime.FileFilter{
			{DisplayName: "Recall bundle (ZIP)", Pattern: "*.zip"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	data, err := a.ExportBundle(ExportBundleOptions{
		MatchKeys:      matchKeys,
		IncludeUnknown: includeUnknown,
		IncludeHidden:  includeHidden,
	})
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("write bundle: %w", err)
	}
	return path, nil
}

// LoadImportFromFile opens a native open dialog, reads the chosen
// file, and applies it via ImportData. Returns the path read on
// success; "" if cancelled. Replaces the current database — caller
// is expected to confirm before invoking.
func (a *App) LoadImportFromFile() (string, error) {
	path, err := wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Open Recall export",
		Filters: []wruntime.FileFilter{
			{DisplayName: "Recall export (JSON or ZIP)", Pattern: "*.json;*.zip"},
			{DisplayName: "All files", Pattern: "*"},
		},
	})
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	data, err := os.ReadFile(path) // #nosec G304 -- path returned by native dialog
	if err != nil {
		return "", fmt.Errorf("read import: %w", err)
	}
	if err := a.ImportData(data); err != nil {
		return "", err
	}
	return path, nil
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
	// validation as the PUT /api/v1/settings/screenshots-folder HTTP endpoint — the
	// native dialog is trusted but funneling everything through one
	// validator keeps behaviour (validation + watcher restart)
	// consistent between Wails and server mode.
	if err := a.SetScreenshotsDir(dir); err != nil {
		return a.settings.ScreenshotsDir, err
	}
	return a.settings.ScreenshotsDir, nil
}
