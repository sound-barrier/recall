//go:build !serveronly

package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"recall/pkg/match"
)

// emitEvent fires a Wails v3 application event when the desktop app is running.
// application.Get() returns the running *application.App; it's nil only under
// unit tests / server mode, where the SSE hub carries the same payload instead.
func emitEvent(name string, data ...any) {
	if a := application.Get(); a != nil {
		a.Event.Emit(name, data...)
	}
}

// emitParseProgress sends per-file progress data to the Wails event bus and
// (when the Wails binary runs in --server mode) to the SSE hub.
// `SSEHub.BroadcastData` is nil-safe, so the bare call removes the TOCTOU window
// a prior `if a.SSEHub != nil` check would open.
func (a *App) emitParseProgress(p ParseProgressEvent) {
	data, _ := json.Marshal(p)
	emitEvent("parse-progress", p)
	a.SSEHub.BroadcastData("parse-progress", string(data))
}

// emitMatchUpdated broadcasts a freshly-aggregated match.MatchRecord to the
// Wails event bus and the SSE hub. Fired after each per-screenshot insert
// resolves a match_key so the frontend can incrementally render the affected
// card without waiting for parse-complete.
func (a *App) emitMatchUpdated(rec match.MatchRecord) {
	data, _ := json.Marshal(rec)
	emitEvent("match-updated", rec)
	a.SSEHub.BroadcastData("match-updated", string(data))
}

// emitTesseractStatus notifies the frontend that the background engine probe
// published a new status, so the System Alert / Engine row self-heals once a
// cold-boot Defender scan releases the binary — no app restart needed.
func (a *App) emitTesseractStatus(s TesseractStatus) {
	data, _ := json.Marshal(s)
	emitEvent("tesseract-status", s)
	a.SSEHub.BroadcastData("tesseract-status", string(data))
}

// emitParseComplete notifies the Wails frontend that a parse run finished.
// Gated by the !serveronly build tag so the v3 application import is absent
// from server-only binaries.
func (a *App) emitParseComplete() {
	emitEvent("parse-complete")
	// Also broadcast via SSE when the Wails binary is run with --server.
	a.SSEHub.Broadcast("parse-complete")
}

// emitParseCancelled notifies the frontend that a parse run was aborted via
// CancelParse. Distinct from parse-complete so the UI can render "stopped" vs
// "done" copy.
func (a *App) emitParseCancelled() {
	emitEvent("parse-cancelled")
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
	file, err := application.Get().Dialog.OpenFile().
		SetTitle("Select Tesseract binary").
		SetDirectory(dir).
		AddFilter("Tesseract executable", "tesseract*").
		AddFilter("All files", "*").
		PromptForSingleSelection()
	if err != nil {
		return a.tessStatusSnapshot(), err
	}
	if file == "" {
		return a.tessStatusSnapshot(), nil
	}
	return a.SetTesseractPath(file)
}

// SaveBackupToFile opens a native save dialog and writes a complete native
// SQLite snapshot (BackupDatabase) to the chosen path. Returns the path on
// success; "" if the user cancelled.
func (a *App) SaveBackupToFile() (string, error) {
	defaultName := "recall-backup-" + time.Now().UTC().Format("20060102-150405") + ".db"
	path, err := application.Get().Dialog.SaveFile().
		SetMessage("Save Recall backup").
		SetFilename(defaultName).
		AddFilter("Recall backup (SQLite)", "*.db").
		AddFilter("All files", "*").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil // user cancelled
	}
	data, err := a.BackupDatabase()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("write backup: %w", err)
	}
	return path, nil
}

// SaveTextToFile writes caller-supplied text (the flat one-row-per-match CSV the
// matches view assembles client-side) to a user-chosen path via a native save
// dialog. Returns the chosen path, or "" if the user cancelled.
func (a *App) SaveTextToFile(defaultName, contents string) (string, error) {
	if defaultName == "" {
		defaultName = "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".csv"
	}
	path, err := application.Get().Dialog.SaveFile().
		SetMessage("Save match data (CSV)").
		SetFilename(defaultName).
		AddFilter("CSV (Excel / Sheets)", "*.csv").
		AddFilter("All files", "*").
		PromptForSingleSelection()
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

// SaveBundleToFile is the bundle-export sibling of SaveTextToFile. Pops a native
// save dialog defaulting to `recall-bundle-<ts>.zip`, then writes the
// ExportBundle payload to the chosen path. Returns the path on success, "" + nil
// on user cancel.
func (a *App) SaveBundleToFile(matchKeys []string, includeUnknown, includeHidden bool) (string, error) {
	defaultName := "recall-bundle-" + time.Now().UTC().Format("20060102-150405") + ".zip"
	path, err := application.Get().Dialog.SaveFile().
		SetMessage("Save Recall bundle").
		SetFilename(defaultName).
		AddFilter("Recall bundle (ZIP)", "*.zip").
		AddFilter("All files", "*").
		PromptForSingleSelection()
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

// LoadRestoreFromFile opens a native open dialog, reads the chosen `.db`
// snapshot, and applies it via RestoreDatabase. Returns the path read on
// success; "" if cancelled. REPLACES the current database — the caller is
// expected to confirm before invoking.
func (a *App) LoadRestoreFromFile() (string, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Restore Recall backup").
		AddFilter("Recall backup (SQLite)", "*.db").
		AddFilter("All files", "*").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	data, err := os.ReadFile(path) // #nosec G304 -- path returned by native dialog
	if err != nil {
		return "", fmt.Errorf("read restore: %w", err)
	}
	if err := a.RestoreDatabase(data); err != nil {
		return "", err
	}
	return path, nil
}

// LoadMatchImportFromFile opens a native open dialog, reads the chosen bundle
// `.zip`, and merges it via ImportMatches. Returns the path + the merge counts;
// Path is "" if the user cancelled. Additive — never replaces existing data.
func (a *App) LoadMatchImportFromFile() (MatchImportResult, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Import Recall matches").
		AddFilter("Recall bundle (ZIP)", "*.zip").
		AddFilter("All files", "*").
		PromptForSingleSelection()
	if err != nil {
		return MatchImportResult{}, err
	}
	if path == "" {
		return MatchImportResult{}, nil
	}
	data, err := os.ReadFile(path) // #nosec G304 -- path returned by native dialog
	if err != nil {
		return MatchImportResult{}, fmt.Errorf("read import: %w", err)
	}
	summary, err := a.ImportMatches(data)
	if err != nil {
		return MatchImportResult{}, err
	}
	return MatchImportResult{Path: path, Imported: summary.Imported, Skipped: summary.Skipped}, nil
}

// PickScreenshotsDir opens a native directory chooser and persists the
// selection. Returns the chosen path. If the user cancels (empty path), the
// existing setting is left alone. Routed through SetScreenshotsDir so the path
// passes the same validation as the PUT /api/v1/settings/screenshots-folder
// HTTP endpoint.
func (a *App) PickScreenshotsDir() (string, error) {
	dflt := a.settings.ScreenshotsDir
	if _, err := os.Stat(dflt); err != nil {
		dflt = ""
	}
	dir, err := application.Get().Dialog.OpenFile().
		SetTitle("Select Overwatch screenshots folder").
		SetDirectory(dflt).
		CanChooseDirectories(true).
		CanChooseFiles(false).
		PromptForSingleSelection()
	if err != nil {
		return a.settings.ScreenshotsDir, err
	}
	if dir == "" {
		return a.settings.ScreenshotsDir, nil
	}
	if err := a.SetScreenshotsDir(dir); err != nil {
		return a.settings.ScreenshotsDir, err
	}
	return a.settings.ScreenshotsDir, nil
}
