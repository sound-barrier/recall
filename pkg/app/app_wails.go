//go:build !serveronly

package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// emitWatchActivity broadcasts the watcher's pending-file tally to the
// Wails event bus and (in --server mode) the SSE hub — the masthead's
// "watching · N new" dot.
func (a *App) emitWatchActivity(ev WatchActivityEvent) {
	data, _ := json.Marshal(ev)
	emitEvent("watch-activity", ev)
	a.SSEHub.BroadcastData("watch-activity", string(data))
}

// emitMatchUpdated broadcasts a freshly-aggregated match.Record to the
// Wails event bus and the SSE hub. Fired after each per-screenshot insert
// resolves a match_key so the frontend can incrementally render the affected
// card without waiting for parse-complete.
func (a *App) emitMatchUpdated(rec match.Record) {
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

// emitCoachSessionChanged tells every surface that a coaching session
// opened or ended, so a second window (or a second browser tab in
// --server mode) flips its write gate without polling.
func (a *App) emitCoachSessionChanged(active bool) {
	ev := CoachSessionChangedEvent{Active: active}
	data, _ := json.Marshal(ev)
	emitEvent("coach-session-changed", ev)
	a.SSEHub.BroadcastData("coach-session-changed", string(data))
}

// emitParseComplete notifies the Wails frontend that a parse run finished.
// Gated by the !serveronly build tag so the v3 application import is absent
// from server-only binaries.
func (a *App) emitParseComplete(matchCount int) {
	emitEvent("parse-complete")
	// Also broadcast via SSE when the Wails binary is run with --server.
	a.SSEHub.Broadcast("parse-complete")
	notifyParseComplete(matchCount)
}

// parseCompleteNotifier posts a native "parse complete" desktop notification.
// The desktop runtime (pkg/cmd RunWails) sets it via SetParseCompleteNotifier;
// it stays nil under tests + when the Wails binary runs in --server mode, so
// emitParseComplete silently skips it there.
var parseCompleteNotifier func(matchCount int)

// SetParseCompleteNotifier wires the desktop notification sender — called once
// from RunWails after the notifications service is registered.
func SetParseCompleteNotifier(fn func(matchCount int)) { parseCompleteNotifier = fn }

func notifyParseComplete(matchCount int) {
	if parseCompleteNotifier != nil && matchCount > 0 {
		parseCompleteNotifier(matchCount)
	}
}

// emitParseCanceled notifies the frontend that a parse run was aborted via
// CancelParse. Distinct from parse-complete so the UI can render "stopped" vs
// "done" copy.
func (a *App) emitParseCanceled() {
	emitEvent("parse-canceled")
	a.SSEHub.Broadcast("parse-canceled")
}

// PickTesseractBinary opens a native file chooser and applies the selection
// via SetTesseractPath. Returns the resulting status; on cancel the existing
// status is returned unchanged.
func (a *App) PickTesseractBinary() (TesseractStatus, error) {
	dflt := a.settingsSnapshot().TesseractPath
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
// success; "" if the user canceled.
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
		return "", nil // user canceled
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
// dialog. Returns the chosen path, or "" if the user canceled.
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

// SaveBundleToFile is the bundle-export sibling of SaveTextToFile. Pops a
// native save dialog defaulting to filename, then writes the ExportBundle
// payload to the chosen path. Returns the path on success, "" + nil on user
// cancel.
func (a *App) SaveBundleToFile(matchKeys []string, includeUnknown, includeHidden bool, filename string) (string, error) {
	return a.saveBundleDialog(bundleSelection(matchKeys, includeUnknown, includeHidden), nil, filename)
}

// SaveShareBundleToFile is SaveBundleToFile's share-mode sibling: the same
// selection saved with the player's identity in the manifest, so the coach
// who receives the file can open it as a coaching session (and a mis-clicked
// Import refuses it). A separate method rather than a nullable argument on
// the plain saver, mirroring ExportBundle / ExportShareBundle — the ordinary
// export stays incapable of stamping an identity. The handle is the display
// name the coach sees; the stable player id is minted and persisted by the
// App, never supplied by the caller.
func (a *App) SaveShareBundleToFile(matchKeys []string, includeUnknown, includeHidden bool, player SharePlayer, filename string) (string, error) {
	return a.saveBundleDialog(bundleSelection(matchKeys, includeUnknown, includeHidden), &player, filename)
}

func bundleSelection(matchKeys []string, includeUnknown, includeHidden bool) ExportBundleOptions {
	return ExportBundleOptions{
		MatchKeys:      matchKeys,
		IncludeUnknown: includeUnknown,
		IncludeHidden:  includeHidden,
	}
}

// saveBundleDialog is the shared tail of both bundle savers: prompt for a
// destination, build the payload only once the user has picked one (a cancel
// costs nothing), write it. A nil player is the ordinary export.
//
// The dialog is filled with the name the MODAL showed. It used to hard-code
// `recall-bundle-<ts>.zip` for both modes, contradicting the modal, which
// suggests `recall-share-<ts>.zip` for a share precisely so the two can be
// told apart later on the coach's disk among the player's own backups.
func (a *App) saveBundleDialog(opts ExportBundleOptions, player *SharePlayer, filename string) (string, error) {
	defaultName := strings.TrimSpace(filename)
	if defaultName == "" {
		defaultName = "recall-bundle-" + time.Now().UTC().Format("20060102-150405") + ".zip"
	}
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
	data, err := a.exportBundleFor(opts, player)
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("write bundle: %w", err)
	}
	return path, nil
}

func (a *App) exportBundleFor(opts ExportBundleOptions, player *SharePlayer) ([]byte, error) {
	if player == nil {
		return a.ExportBundle(opts)
	}
	return a.ExportShareBundle(opts, *player)
}

// SaveDiagnosticBundleToFile pops a native save dialog defaulting to
// `recall-diagnostic-<ts>.zip`, then writes the ExportDiagnosticBundle
// payload to the chosen path. Dialog first, build second — a cancel
// costs nothing. Returns the path on success, "" + nil on user cancel.
func (a *App) SaveDiagnosticBundleToFile() (string, error) {
	defaultName := "recall-diagnostic-" + time.Now().UTC().Format("20060102-150405") + ".zip"
	path, err := application.Get().Dialog.SaveFile().
		SetMessage("Save diagnostic bundle").
		SetFilename(defaultName).
		AddFilter("Diagnostic bundle (ZIP)", "*.zip").
		AddFilter("All files", "*").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	data, err := a.ExportDiagnosticBundle()
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("write diagnostic bundle: %w", err)
	}
	return path, nil
}

// LoadRestoreFromFile opens a native open dialog, reads the chosen `.db`
// snapshot, and applies it via RestoreDatabase. Returns the path read on
// success; "" if canceled. REPLACES the current database — the caller is
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

// LoadMatchImportFromFile opens a native open dialog, reads the chosen
// `.zip`, and hands it to ImportMatches — which decides for itself whether
// it is a bundle to merge or a coach's notes to stage. Returns the path +
// the outcome; Path is "" if the user canceled. Additive — never replaces
// existing data.
func (a *App) LoadMatchImportFromFile() (MatchImportResult, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Import matches or coach's notes").
		AddFilter("Recall bundle or notes (ZIP)", "*.zip").
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
	outcome, err := a.ImportMatches(data)
	if err != nil {
		return MatchImportResult{}, err
	}
	return MatchImportResult{Path: path, ImportOutcome: outcome}, nil
}

// LoadCoachBundleFromFile opens a native open dialog, reads the chosen
// player bundle, and opens it as a coaching session. Returns the path read
// plus the session view; Path is "" and Session nil if the user canceled.
func (a *App) LoadCoachBundleFromFile() (CoachSessionResult, error) {
	path, err := application.Get().Dialog.OpenFile().
		SetTitle("Open a player's bundle").
		AddFilter("Recall bundle (ZIP)", "*.zip").
		AddFilter("All files", "*").
		PromptForSingleSelection()
	if err != nil {
		return CoachSessionResult{}, err
	}
	if path == "" {
		return CoachSessionResult{}, nil
	}
	data, err := os.ReadFile(path) // #nosec G304 -- path returned by native dialog
	if err != nil {
		return CoachSessionResult{}, fmt.Errorf("read coach bundle: %w", err)
	}
	view, err := a.OpenCoachSession(data)
	if err != nil {
		return CoachSessionResult{}, err
	}
	return CoachSessionResult{Path: path, Session: &view}, nil
}

// SaveCoachNotesToFile writes the session's notes archive to a
// user-chosen path. The export runs FIRST so the dialog can default to the
// archive's own name — and so a missing coach name or an empty session is
// reported before the user picks a destination. Returns the path on
// success, "" + nil on cancel.
func (a *App) SaveCoachNotesToFile() (string, error) {
	defaultName, payload, err := a.ExportCoachNotes()
	if err != nil {
		return "", err
	}
	path, err := application.Get().Dialog.SaveFile().
		SetMessage("Save notes for the player").
		SetFilename(defaultName).
		AddFilter("Recall coach notes (ZIP)", "*.zip").
		AddFilter("All files", "*").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", nil
	}
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		return "", fmt.Errorf("write coach notes: %w", err)
	}
	return path, nil
}

// PickScreenshotsDir opens a native directory chooser and persists the
// selection. Returns the chosen path. If the user cancels (empty path), the
// existing setting is left alone. Routed through SetScreenshotsDir so the path
// passes the same validation as the PUT /api/v1/settings/screenshots-folder
// HTTP endpoint.
func (a *App) PickScreenshotsDir() (string, error) {
	dflt := a.settingsSnapshot().ScreenshotsDir
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
		return a.settingsSnapshot().ScreenshotsDir, err
	}
	if dir == "" {
		return a.settingsSnapshot().ScreenshotsDir, nil
	}
	if err := a.SetScreenshotsDir(dir); err != nil {
		return a.settingsSnapshot().ScreenshotsDir, err
	}
	return a.settingsSnapshot().ScreenshotsDir, nil
}
