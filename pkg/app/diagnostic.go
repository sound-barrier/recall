package app

import (
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"time"

	"recall/pkg/bundle"
)

// ErrNoFailedFiles is returned by ExportDiagnosticBundle when the
// failure ledger is empty — there's nothing to diagnose, and shipping
// an empty zip would read as a broken export. The HTTP layer maps it
// to 409 Conflict.
var ErrNoFailedFiles = errors.New("no failed files to bundle")

// ExportDiagnosticBundle builds the parser-triage zip: every ledgered
// failed screenshot still on disk, the app logs (current + one
// rotation), and a manifest carrying the app version + environment
// snapshot. Wails mode saves it via SaveDiagnosticBundleToFile; server
// mode streams it from POST /api/v1/exports/diagnostic.
func (a *App) ExportDiagnosticBundle() ([]byte, error) {
	rows, err := a.store.ListFailedFiles()
	if err != nil {
		return nil, fmt.Errorf("diagnostic bundle: list failed files: %w", err)
	}
	if len(rows) == 0 {
		return nil, ErrNoFailedFiles
	}

	// Resolve each distinct non-zero dir id once; a lookup miss just
	// falls back to the configured folder (same rule as the export
	// bundle + the screenshot handler).
	dirByID := map[int64]string{}
	for _, r := range rows {
		if r.ScreenshotsDirID <= 0 {
			continue
		}
		if _, seen := dirByID[r.ScreenshotsDirID]; seen {
			continue
		}
		if p, err := a.store.LookupScreenshotsDir(r.ScreenshotsDirID); err == nil && p != "" {
			dirByID[r.ScreenshotsDirID] = p
		}
	}

	tess := a.tessStatusSnapshot()
	logPath := filepath.Join(appBaseDir(), "logs", "recall.log")
	return bundle.ExportDiagnostic(bundle.DiagnosticInputs{
		FailedFiles: rows,
		DirByID:     dirByID,
		FallbackDir: a.settingsSnapshot().ScreenshotsDir,
		LogPaths:    []string{logPath, logPath + ".1"},
		Version:     Version,
		Env: bundle.DiagnosticEnv{
			OS:               runtime.GOOS,
			Arch:             runtime.GOARCH,
			TesseractPath:    tess.Path,
			TesseractVersion: tess.Version,
			TesseractFound:   tess.Found,
		},
		Now: time.Now().UTC(),
	})
}
