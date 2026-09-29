package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/parser"
	"recall/pkg/tesseract"
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
	fallbackDir := a.settingsSnapshot().ScreenshotsDir
	logPath := filepath.Join(appBaseDir(), "logs", "recall.log")
	return bundle.ExportDiagnostic(bundle.DiagnosticInputs{
		FailedFiles: rows,
		DirByID:     dirByID,
		FallbackDir: fallbackDir,
		LogPaths:    []string{logPath, logPath + ".1"},
		Version:     Version,
		Env: bundle.DiagnosticEnv{
			OS:                 runtime.GOOS,
			Arch:               runtime.GOARCH,
			TesseractPath:      tess.Path,
			TesseractVersion:   tess.Version,
			TesseractFound:     tess.Found,
			TesseractLanguages: tesseractLanguages(),
		},
		Now:       time.Now().UTC(),
		Parked:    a.parkedFailures(),
		Diagnoses: diagnoseRecentFailures(rows, dirByID, fallbackDir),
		Parser:    parserFingerprint(),
	})
}

// DiagnosedFailureCap bounds how many failures an export re-parses. Each
// diagnosis costs a few seconds of OCR and about a megabyte of crops, and the
// ledger is unbounded; the most recent failures are the ones a report is
// about. Past the cap a failure keeps its manifest entry without a trace.
const DiagnosedFailureCap = 10

// DiagnoseScreenshotFunc re-parses one screenshot with every intermediate
// kept. A function variable so tests can stand in for Tesseract.
var DiagnoseScreenshotFunc = parser.Diagnose

// diagnoseRecentFailures re-parses the most recently failed files still on
// disk (rows arrive most recent first), up to DiagnosedFailureCap.
func diagnoseRecentFailures(rows []db.FailedFileRow, dirByID map[int64]string, fallbackDir string) map[string]parser.Diagnosis {
	out := map[string]parser.Diagnosis{}
	for _, r := range rows {
		if len(out) == DiagnosedFailureCap {
			break
		}
		path, ok := failedFilePath(r, dirByID, fallbackDir)
		if !ok {
			continue
		}
		out[r.Filename] = DiagnoseScreenshotFunc(path)
	}
	return out
}

// failedFilePath resolves a ledger row to a file on disk — the same
// dir-resolution rule the bundle uses — and reports whether it exists.
func failedFilePath(r db.FailedFileRow, dirByID map[int64]string, fallbackDir string) (string, bool) {
	if strings.ContainsAny(r.Filename, `/\`) || strings.ContainsRune(r.Filename, 0) {
		return "", false
	}
	dir := dirByID[r.ScreenshotsDirID]
	if dir == "" {
		dir = fallbackDir
	}
	if dir == "" {
		return "", false
	}
	path := filepath.Join(dir, r.Filename)
	if _, err := os.Stat(path); err != nil {
		return "", false
	}
	return path, true
}

// parkedFailures is the parked flag the Unknown tab shows, by filename.
// Best-effort: without it the bundle still carries every failure.
func (a *App) parkedFailures() map[string]bool {
	files, err := a.GetFailedFiles()
	if err != nil {
		return nil
	}
	parked := map[string]bool{}
	for _, f := range files {
		if f.Parked {
			parked[f.Filename] = true
		}
	}
	return parked
}

func parserFingerprint() bundle.DiagnosticParser {
	fp := bundle.DiagnosticParser{Generation: parser.Generation, DataFiles: parser.DataFiles()}
	if err := parser.LoadError(); err != nil {
		fp.LoadError = err.Error()
	}
	return fp
}

// tesseractLanguages is best-effort: an unreadable list is reported empty,
// and the bundle's tesseract_found already says whether the binary exists.
func tesseractLanguages() []string {
	langs, err := tesseract.ListLanguages()
	if err != nil {
		return nil
	}
	return langs
}
