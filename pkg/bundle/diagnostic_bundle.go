package bundle

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"image"
	// Register the decoders image.DecodeConfig needs for the two
	// screenshot formats the parser accepts.
	_ "image/jpeg"
	_ "image/png"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"recall/pkg/db"
)

// Diagnostic bundle — a ZIP the user attaches to a bug report (or hands
// an AI assistant) when screenshots won't parse: the failing images,
// each failure's error, the app logs, and a small environment snapshot.
// Pure function over DiagnosticInputs; the app layer assembles the
// inputs (ledger rows, dir map, log paths, version, Tesseract status).
//
// Deliberately excluded: settings.json and the database — the bundle is
// for parser triage, not data transfer, and should stay safe to share.

// DiagnosticEnv is the environment snapshot manifest.json carries.
type DiagnosticEnv struct {
	OS               string `json:"os"`
	Arch             string `json:"arch"`
	TesseractPath    string `json:"tesseract_path"`
	TesseractVersion string `json:"tesseract_version"`
	TesseractFound   bool   `json:"tesseract_found"`
}

// DiagnosticInputs is everything ExportDiagnostic needs, pre-resolved.
// DirByID maps screenshots_dir ids to on-disk paths; FallbackDir (the
// configured screenshots folder) covers id 0 / unknown ids — the same
// resolution rule the export bundle and the screenshot handler use.
type DiagnosticInputs struct {
	FailedFiles []db.FailedFileRow
	DirByID     map[int64]string
	FallbackDir string
	LogPaths    []string
	Version     string
	Env         DiagnosticEnv
	Now         time.Time
}

type diagnosticFailure struct {
	Filename      string `json:"filename"`
	Error         string `json:"error"`
	Attempts      int    `json:"attempts"`
	FirstFailedAt string `json:"first_failed_at"`
	LastFailedAt  string `json:"last_failed_at"`
	SourceDir     string `json:"source_dir"`
	Resolution    string `json:"resolution"`
	Included      bool   `json:"included"`
}

type diagnosticManifest struct {
	Schema        string              `json:"schema"`
	ExportedAt    string              `json:"exported_at"`
	RecallVersion string              `json:"recall_version"`
	Environment   DiagnosticEnv       `json:"environment"`
	FailedCount   int                 `json:"failed_count"`
	Failures      []diagnosticFailure `json:"failures"`
	Logs          []string            `json:"logs"`
}

// ExportDiagnostic builds the ZIP in memory:
//
//	manifest.json          recall-diagnostic/v1 envelope
//	screenshots/<name>     each failed file still present on disk
//	logs/<basename>        each LogPaths entry that exists
//
// Missing screenshots and absent log files are skipped silently (the
// manifest records `included:false` / omits the log); only ZIP-writer
// failures error.
func ExportDiagnostic(in DiagnosticInputs) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	failures := make([]diagnosticFailure, 0, len(in.FailedFiles))
	for _, row := range in.FailedFiles {
		f, err := addDiagnosticScreenshot(zw, in, row)
		if err != nil {
			return nil, err
		}
		failures = append(failures, f)
	}
	sort.Slice(failures, func(i, j int) bool { return failures[i].Filename < failures[j].Filename })

	logs, err := addDiagnosticLogs(zw, in)
	if err != nil {
		return nil, err
	}

	manifest := diagnosticManifest{
		Schema:        "recall-diagnostic/v1",
		ExportedAt:    in.Now.UTC().Format(time.RFC3339),
		RecallVersion: in.Version,
		Environment:   in.Env,
		FailedCount:   len(failures),
		Failures:      failures,
		Logs:          logs,
	}
	if err := bundleWriteJSON(zw, "manifest.json", manifest, in.Now); err != nil {
		return nil, fmt.Errorf("diagnostic bundle: manifest: %w", err)
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("diagnostic bundle: close: %w", err)
	}
	return buf.Bytes(), nil
}

// addDiagnosticScreenshot reads one failed file off disk and writes it
// under screenshots/. The returned failure entry records the source
// dir, the decoded pixel resolution ("unknown" when the image doesn't
// decode — that's often the diagnosis), and whether bytes made it in.
func addDiagnosticScreenshot(zw *zip.Writer, in DiagnosticInputs, row db.FailedFileRow) (diagnosticFailure, error) {
	f := diagnosticFailure{
		Filename:      row.Filename,
		Error:         row.Error,
		Attempts:      row.Attempts,
		FirstFailedAt: row.FirstFailedAt,
		LastFailedAt:  row.LastFailedAt,
		Resolution:    "unknown",
	}
	// The ledger keys on parser-produced basenames; a separator here
	// means something upstream went badly wrong — never let it shape a
	// zip entry path.
	if strings.ContainsAny(row.Filename, `/\`) || strings.ContainsRune(row.Filename, 0) {
		return f, nil
	}
	dir := in.FallbackDir
	if row.ScreenshotsDirID > 0 {
		if p, ok := in.DirByID[row.ScreenshotsDirID]; ok && p != "" {
			dir = p
		}
	}
	f.SourceDir = dir
	if dir == "" {
		return f, nil
	}
	// #nosec G304 -- dir comes from the validated screenshots-folder
	// settings / screenshots_dirs rows; the basename was produced by
	// the parser loop and separator-guarded above.
	body, err := os.ReadFile(filepath.Join(dir, row.Filename))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return f, nil
		}
		return f, fmt.Errorf("diagnostic bundle: read %s: %w", row.Filename, err)
	}
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(body)); err == nil {
		f.Resolution = fmt.Sprintf("%dx%d", cfg.Width, cfg.Height)
	}
	if err := bundleWriteRaw(zw, "screenshots/"+row.Filename, body, in.Now); err != nil {
		return f, fmt.Errorf("diagnostic bundle: write %s: %w", row.Filename, err)
	}
	f.Included = true
	return f, nil
}

// addDiagnosticLogs copies every LogPaths entry that exists into logs/
// and returns the archive paths actually written.
func addDiagnosticLogs(zw *zip.Writer, in DiagnosticInputs) ([]string, error) {
	logs := make([]string, 0, len(in.LogPaths))
	for _, p := range in.LogPaths {
		// #nosec G304 -- log paths are assembled by the app layer from
		// appBaseDir(), never from user input.
		body, err := os.ReadFile(p)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				continue
			}
			return nil, fmt.Errorf("diagnostic bundle: read log %s: %w", p, err)
		}
		name := "logs/" + filepath.Base(p)
		if err := bundleWriteRaw(zw, name, body, in.Now); err != nil {
			return nil, fmt.Errorf("diagnostic bundle: write log %s: %w", p, err)
		}
		logs = append(logs, name)
	}
	return logs, nil
}
