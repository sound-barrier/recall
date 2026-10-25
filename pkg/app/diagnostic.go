package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/parser"
	"recall/pkg/screenshot"
	"recall/pkg/tesseract"
)

// ErrNothingToReport is returned by ExportDiagnosticBundle when no file was
// picked and the failure ledger is empty — there's nothing to diagnose, and
// shipping an empty zip would read as a broken export. The HTTP layer maps it
// to 409 Conflict.
var ErrNothingToReport = errors.New("no screenshots to report")

// ErrInvalidReport is returned for a picked-file list the report can't be
// built from: too many files, an unsafe filename, or an oversized note. The
// HTTP layer maps it to 400.
var ErrInvalidReport = errors.New("invalid parse report")

// Bounds on one report. A GitHub issue takes attachments up to 25 MB, which a
// report passes at around eight full-resolution screenshots plus their
// traces, so the file cap is a sanity bound rather than the practical one.
const (
	MaxReportFiles     = 50
	MaxReportNoteRunes = 2000
)

// ReportFile is one screenshot the user picked for a parse-problem report,
// with their own words on what is wrong with it. ScreenshotsDirID 0 means
// the configured screenshots folder.
type ReportFile struct {
	Filename         string `json:"filename"`
	ScreenshotsDirID int64  `json:"screenshots_dir_id"`
	Note             string `json:"note"`
}

// ExportDiagnosticBundle builds the parse-problem report zip: each picked
// screenshot still on disk with its note (or, when none is picked, every
// ledgered failure), the app logs (current + one rotation), and a manifest
// carrying the app version, environment snapshot and likely causes, with
// folder paths redacted. Wails mode saves it via SaveDiagnosticBundleToFile;
// server mode streams it from POST /api/v1/exports/diagnostic.
func (a *App) ExportDiagnosticBundle(files []ReportFile) ([]byte, error) {
	in, err := a.diagnosticInputs(files)
	if err != nil {
		return nil, err
	}
	in.Diagnoses = diagnoseFiles(in)
	return bundle.ExportDiagnostic(in)
}

// PreflightDiagnosticBundle reports what is likely wrong with the picked
// files or the Tesseract install before the user builds a report — the fixes
// the report dialog offers first.
func (a *App) PreflightDiagnosticBundle(files []ReportFile) ([]bundle.LikelyCause, error) {
	in, err := a.diagnosticInputs(files)
	if err != nil {
		return nil, err
	}
	return bundle.PreflightDiagnostic(in), nil
}

func (a *App) diagnosticInputs(picked []ReportFile) (bundle.DiagnosticInputs, error) {
	if err := validateReportFiles(picked); err != nil {
		return bundle.DiagnosticInputs{}, err
	}
	rows, err := a.store.ListFailedFiles()
	if err != nil {
		return bundle.DiagnosticInputs{}, fmt.Errorf("diagnostic bundle: list failed files: %w", err)
	}
	files := reportFiles(picked, rows, a.parkedFailures())
	if len(files) == 0 {
		return bundle.DiagnosticInputs{}, ErrNothingToReport
	}

	dirByID := a.resolveReportDirs(files)
	fallbackDir := a.settingsSnapshot().ScreenshotsDir
	tess := a.tessStatusSnapshot()
	logPath := filepath.Join(appBaseDir(), "logs", "recall.log")
	return bundle.DiagnosticInputs{
		Files:       files,
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
		Now:        time.Now().UTC(),
		Parser:     parserFingerprint(),
		Redactions: reportRedactions(dirByID, fallbackDir),
	}, nil
}

func validateReportFiles(files []ReportFile) error {
	if len(files) > MaxReportFiles {
		return fmt.Errorf("%w: %d files, at most %d", ErrInvalidReport, len(files), MaxReportFiles)
	}
	for _, f := range files {
		if !screenshot.ValidBasename(f.Filename) || strings.ContainsRune(f.Filename, 0) {
			return fmt.Errorf("%w: unsafe filename %q", ErrInvalidReport, f.Filename)
		}
		if f.ScreenshotsDirID < 0 {
			return fmt.Errorf("%w: negative screenshots_dir_id for %q", ErrInvalidReport, f.Filename)
		}
		if utf8.RuneCountInString(f.Note) > MaxReportNoteRunes {
			return fmt.Errorf("%w: note on %q is over %d characters", ErrInvalidReport, f.Filename, MaxReportNoteRunes)
		}
	}
	return nil
}

// reportFiles joins the picked files to the failure ledger: a picked file
// that failed carries its ledger entry, and inherits the ledger's folder when
// the pick named none (the failed list has no folder on the wire). With
// nothing picked, the report covers every ledgered failure, most recent first.
func reportFiles(picked []ReportFile, rows []db.FailedFileRow, parked map[string]bool) []bundle.DiagnosticFile {
	if len(picked) == 0 {
		out := make([]bundle.DiagnosticFile, 0, len(rows))
		for _, r := range rows {
			out = append(out, bundle.DiagnosticFile{Filename: r.Filename, ScreenshotsDirID: r.ScreenshotsDirID, Failure: ledgerFailure(r, parked)})
		}
		return out
	}
	ledger := make(map[string]db.FailedFileRow, len(rows))
	for _, r := range rows {
		ledger[r.Filename] = r
	}
	out := make([]bundle.DiagnosticFile, 0, len(picked))
	seen := map[ReportFile]bool{}
	for _, p := range picked {
		key := ReportFile{Filename: p.Filename, ScreenshotsDirID: p.ScreenshotsDirID}
		if seen[key] {
			continue
		}
		seen[key] = true
		f := bundle.DiagnosticFile{Filename: p.Filename, ScreenshotsDirID: p.ScreenshotsDirID, Note: p.Note}
		if r, ok := ledger[p.Filename]; ok && (p.ScreenshotsDirID == 0 || p.ScreenshotsDirID == r.ScreenshotsDirID) {
			f.ScreenshotsDirID = r.ScreenshotsDirID
			f.Failure = ledgerFailure(r, parked)
		}
		out = append(out, f)
	}
	return out
}

func ledgerFailure(r db.FailedFileRow, parked map[string]bool) *bundle.DiagnosticFailure {
	return &bundle.DiagnosticFailure{
		Error:         r.Error,
		Attempts:      r.Attempts,
		FirstFailedAt: r.FirstFailedAt,
		LastFailedAt:  r.LastFailedAt,
		Parked:        parked[r.Filename],
	}
}

// resolveReportDirs resolves each distinct non-zero dir id once; a lookup
// miss just falls back to the configured folder (same rule as the export
// bundle + the screenshot handler).
func (a *App) resolveReportDirs(files []bundle.DiagnosticFile) map[int64]string {
	dirByID := map[int64]string{}
	for _, f := range files {
		if f.ScreenshotsDirID <= 0 {
			continue
		}
		if _, seen := dirByID[f.ScreenshotsDirID]; seen {
			continue
		}
		if p, err := a.store.LookupScreenshotsDir(f.ScreenshotsDirID); err == nil && p != "" {
			dirByID[f.ScreenshotsDirID] = p
		}
	}
	return dirByID
}

// reportRedactions names every folder path a report could leak: the
// screenshots folders, Recall's own data folder, and the home folder they
// usually sit under (which names the OS account).
func reportRedactions(dirByID map[int64]string, fallbackDir string) []bundle.PathRedaction {
	out := []bundle.PathRedaction{{Path: appBaseDir(), Placeholder: "[recall-data]"}}
	if fallbackDir != "" {
		out = append(out, bundle.PathRedaction{Path: fallbackDir, Placeholder: "[screenshots]"})
	}
	for _, dir := range dirByID {
		out = append(out, bundle.PathRedaction{Path: dir, Placeholder: "[screenshots]"})
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		out = append(out, bundle.PathRedaction{Path: home, Placeholder: "[home]"})
	}
	return out
}

// DiagnosedFailureCap bounds how many files an export re-parses. Each
// diagnosis costs a few seconds of OCR and about a megabyte of crops, and the
// ledger is unbounded; the first files (the most recent failures, or the
// user's picks in order) are the ones a report is about. Past the cap a file
// keeps its manifest entry without a trace.
const DiagnosedFailureCap = 10

// DiagnoseScreenshotFunc re-parses one screenshot with every intermediate
// kept. A function variable so tests can stand in for Tesseract.
var DiagnoseScreenshotFunc = parser.Diagnose

// diagnoseFiles re-parses the report's files still on disk, in order, up to
// DiagnosedFailureCap.
func diagnoseFiles(in bundle.DiagnosticInputs) map[string]parser.Diagnosis {
	out := map[string]parser.Diagnosis{}
	for _, f := range in.Files {
		if len(out) == DiagnosedFailureCap {
			break
		}
		path, ok := reportFilePath(f, in.DirByID, in.FallbackDir)
		if !ok {
			continue
		}
		out[f.Filename] = DiagnoseScreenshotFunc(path)
	}
	return out
}

// reportFilePath resolves a report file to a file on disk — the same
// dir-resolution rule the bundle uses — and reports whether it exists.
func reportFilePath(f bundle.DiagnosticFile, dirByID map[int64]string, fallbackDir string) (string, bool) {
	if !screenshot.ValidBasename(f.Filename) {
		return "", false
	}
	dir := dirByID[f.ScreenshotsDirID]
	if dir == "" {
		dir = fallbackDir
	}
	if dir == "" {
		return "", false
	}
	path := filepath.Join(dir, f.Filename)
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
