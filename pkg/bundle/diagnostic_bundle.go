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

	"recall/pkg/parser"
	"recall/pkg/screenshot"
)

// Diagnostic bundle — the ZIP a user attaches to a parse-problem report (or
// hands an AI assistant): the screenshots they picked, what they say is wrong
// with each, each ledgered failure's error, a fresh re-parse trace, the app
// logs, and a small environment snapshot. A picked file need not have failed:
// a screenshot that parsed into the wrong hero is as reportable as one that
// errored. Pure function over DiagnosticInputs; the app layer assembles the
// inputs (picked files, dir map, log paths, version, Tesseract status).
//
// Deliberately excluded: settings.json and the database — the bundle is
// for parser triage, not data transfer, and should stay safe to share.
// Folder paths are replaced by placeholders (Redactions) for the same reason.

// DiagnosticSchema is the manifest's wire-schema identifier. Exported so the
// maintainer's import tooling can refuse a bundle it does not understand.
const DiagnosticSchema = "recall-diagnostic/v3"

// DiagnosticEnv is the environment snapshot manifest.json carries.
type DiagnosticEnv struct {
	OS               string `json:"os"`
	Arch             string `json:"arch"`
	TesseractPath    string `json:"tesseract_path"`
	TesseractVersion string `json:"tesseract_version"`
	TesseractFound   bool   `json:"tesseract_found"`
	// TesseractLanguages is `tesseract --list-langs`; empty when it could
	// not be read. A missing "eng" explains an OCR that reads nothing.
	TesseractLanguages []string `json:"tesseract_languages"`
}

// DiagnosticParser fingerprints the parser the exporting build runs: its
// output generation and the roster data it loaded (and from where).
type DiagnosticParser struct {
	Generation int               `json:"generation"`
	DataFiles  []parser.DataFile `json:"data_files"`
	LoadError  string            `json:"load_error,omitempty"`
}

// DiagnosticFile is one screenshot the report covers.
type DiagnosticFile struct {
	Filename         string
	ScreenshotsDirID int64
	// Note is the reporter's own words on what is wrong ("hero should be
	// Kiriko") — the one fact only they know, and what a golden is
	// corrected to.
	Note string
	// Failure is the file's failed-files ledger entry; nil when it parsed.
	Failure *DiagnosticFailure
}

// DiagnosticFailure is a failed-files ledger entry as the manifest carries it.
type DiagnosticFailure struct {
	Error         string `json:"error"`
	Attempts      int    `json:"attempts"`
	FirstFailedAt string `json:"first_failed_at"`
	LastFailedAt  string `json:"last_failed_at"`
	// Parked marks a failure normal runs no longer retry.
	Parked bool `json:"parked"`
}

// PathRedaction replaces every occurrence of Path in the shared text with
// Placeholder: a user's folder paths name their OS account.
type PathRedaction struct {
	Path        string
	Placeholder string
}

// DiagnosticInputs is everything ExportDiagnostic needs, pre-resolved.
// DirByID maps screenshots_dir ids to on-disk paths; FallbackDir (the
// configured screenshots folder) covers id 0 / unknown ids — the same
// resolution rule the export bundle and the screenshot handler use.
type DiagnosticInputs struct {
	Files       []DiagnosticFile
	DirByID     map[int64]string
	FallbackDir string
	LogPaths    []string
	Version     string
	Env         DiagnosticEnv
	Now         time.Time
	// Diagnoses holds a fresh re-parse per filename; a file without one
	// (past the app's cap, or not on disk) carries no trace.
	Diagnoses  map[string]parser.Diagnosis
	Parser     DiagnosticParser
	Redactions []PathRedaction
}

type diagnosticEntry struct {
	Filename   string             `json:"filename"`
	Note       string             `json:"note,omitempty"`
	SourceDir  string             `json:"source_dir"`
	Resolution string             `json:"resolution"`
	Included   bool               `json:"included"`
	Failure    *DiagnosticFailure `json:"failure,omitempty"`
	// Diagnosis is this build's re-parse of the file; nil when none ran.
	Diagnosis *diagnosticTrace `json:"diagnosis"`
}

// diagnosticTrace is a Diagnosis as the manifest carries it: the crops and
// readings themselves go under DebugDir in the zip.
type diagnosticTrace struct {
	Type     parser.ScreenshotType `json:"type"`
	Error    string                `json:"error"`
	Probes   []parser.ProbeStep    `json:"probes"`
	OCR      map[string]string     `json:"ocr"`
	DebugDir string                `json:"debug_dir,omitempty"`
}

type diagnosticManifest struct {
	Schema        string            `json:"schema"`
	ExportedAt    string            `json:"exported_at"`
	RecallVersion string            `json:"recall_version"`
	Environment   DiagnosticEnv     `json:"environment"`
	Parser        DiagnosticParser  `json:"parser"`
	FileCount     int               `json:"file_count"`
	Files         []diagnosticEntry `json:"files"`
	LikelyCauses  []LikelyCause     `json:"likely_causes"`
	Logs          []string          `json:"logs"`
}

// ExportDiagnostic builds the ZIP in memory:
//
//	manifest.json          recall-diagnostic/v3 envelope
//	screenshots/<name>     each picked file still present on disk
//	debug/<name>/<file>    each diagnosed file's crops + OCR readings
//	logs/<basename>        each LogPaths entry that exists
//
// Missing screenshots and absent log files are skipped silently (the
// manifest records `included:false` / omits the log); only ZIP-writer
// failures error.
func ExportDiagnostic(in DiagnosticInputs) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	redact := newRedactor(in.Redactions)

	entries, facts, err := addDiagnosticFiles(zw, in, redact)
	if err != nil {
		return nil, err
	}
	logs, err := addDiagnosticLogs(zw, in, redact)
	if err != nil {
		return nil, err
	}

	manifest := diagnosticManifest{
		Schema:        DiagnosticSchema,
		ExportedAt:    in.Now.UTC().Format(time.RFC3339),
		RecallVersion: in.Version,
		Environment:   redactEnv(in.Env, redact),
		Parser:        redactParser(in.Parser, redact),
		FileCount:     len(entries),
		Files:         entries,
		LikelyCauses:  likelyCauses(in.Env, facts),
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

// addDiagnosticFiles writes every picked file and its trace, returning the
// manifest entries sorted by filename and what was learned reading each file.
func addDiagnosticFiles(zw *zip.Writer, in DiagnosticInputs, redact redactor) ([]diagnosticEntry, []fileFacts, error) {
	entries := make([]diagnosticEntry, 0, len(in.Files))
	facts := make([]fileFacts, 0, len(in.Files))
	for _, f := range in.Files {
		ff, err := readDiagnosticFile(in, f)
		if err != nil {
			return nil, nil, err
		}
		entry, err := addDiagnosticScreenshot(zw, in, f, ff, redact)
		if err != nil {
			return nil, nil, err
		}
		if entry.Diagnosis, err = addDiagnosticTrace(zw, in, f.Filename, redact); err != nil {
			return nil, nil, err
		}
		entries = append(entries, entry)
		facts = append(facts, ff)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Filename < entries[j].Filename })
	return entries, facts, nil
}

// fileFacts is what reading one picked file off disk established.
type fileFacts struct {
	filename string
	dir      string
	body     []byte // nil when the file is not on disk (or its name is unsafe)
	width    int
	height   int
	decoded  bool
}

// readDiagnosticFile reads one picked file and decodes its pixel size.
// A missing file is a fact, not an error; only an unreadable present
// file errors.
func readDiagnosticFile(in DiagnosticInputs, f DiagnosticFile) (fileFacts, error) {
	ff := fileFacts{filename: f.Filename}
	// The names come from the ledger or the user's pick over HTTP; a
	// separator or ".." must never shape a zip entry or a filesystem path.
	if !safeEntryName(f.Filename) {
		return ff, nil
	}
	ff.dir = resolveDiagnosticDir(in, f.ScreenshotsDirID)
	if ff.dir == "" {
		return ff, nil
	}
	path := filepath.Join(ff.dir, f.Filename)
	if !screenshot.WithinDir(ff.dir, path) {
		return ff, nil
	}
	// #nosec G304 -- dir comes from the validated screenshots-folder
	// settings / screenshots_dirs rows, and path is contained in it above.
	body, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ff, nil
		}
		return ff, fmt.Errorf("diagnostic bundle: read %s: %w", f.Filename, err)
	}
	ff.body = body
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(body)); err == nil {
		ff.width, ff.height, ff.decoded = cfg.Width, cfg.Height, true
	}
	return ff, nil
}

// addDiagnosticScreenshot writes one read file under screenshots/ and
// returns its manifest entry: the source dir, the decoded pixel resolution
// ("unknown" when the image doesn't decode — that's often the diagnosis),
// and whether bytes made it in.
func addDiagnosticScreenshot(zw *zip.Writer, in DiagnosticInputs, f DiagnosticFile, ff fileFacts, redact redactor) (diagnosticEntry, error) {
	entry := diagnosticEntry{
		Filename:   f.Filename,
		Note:       f.Note,
		SourceDir:  redact.apply(ff.dir),
		Resolution: "unknown",
	}
	if f.Failure != nil {
		failure := *f.Failure
		failure.Error = redact.apply(failure.Error)
		entry.Failure = &failure
	}
	if ff.body == nil {
		return entry, nil
	}
	if ff.decoded {
		entry.Resolution = fmt.Sprintf("%dx%d", ff.width, ff.height)
	}
	if err := bundleWriteRaw(zw, "screenshots/"+f.Filename, ff.body, in.Now); err != nil {
		return entry, fmt.Errorf("diagnostic bundle: write %s: %w", f.Filename, err)
	}
	entry.Included = true
	return entry, nil
}

// addDiagnosticTrace writes one diagnosed file's work files under
// debug/<filename>/ and returns its manifest entry; nil when the file was
// not diagnosed or its name is unsafe as a zip path.
func addDiagnosticTrace(zw *zip.Writer, in DiagnosticInputs, filename string, redact redactor) (*diagnosticTrace, error) {
	d, ok := in.Diagnoses[filename]
	if !ok || !safeEntryName(filename) {
		return nil, nil
	}
	trace := &diagnosticTrace{Type: d.Type, Error: redact.apply(d.Error), Probes: d.Probes, OCR: d.OCR}
	names := make([]string, 0, len(d.Files))
	for name := range d.Files {
		if !strings.ContainsAny(name, `/\`) {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return trace, nil // debug_dir stays empty: there is no folder to name
	}
	sort.Strings(names)
	trace.DebugDir = "debug/" + filename
	for _, name := range names {
		if err := bundleWriteRaw(zw, trace.DebugDir+"/"+name, d.Files[name], in.Now); err != nil {
			return nil, fmt.Errorf("diagnostic bundle: write debug %s: %w", name, err)
		}
	}
	return trace, nil
}

func safeEntryName(name string) bool {
	return name != "" && !strings.ContainsAny(name, `/\`) && !strings.ContainsRune(name, 0)
}

// resolveDiagnosticDir resolves the on-disk dir for a picked file — its
// screenshots_dirs entry when known, else the configured fallback.
func resolveDiagnosticDir(in DiagnosticInputs, dirID int64) string {
	if dirID > 0 {
		if p, ok := in.DirByID[dirID]; ok && p != "" {
			return p
		}
	}
	return in.FallbackDir
}

// addDiagnosticLogs copies every LogPaths entry that exists into logs/,
// redacted, and returns the archive paths actually written.
func addDiagnosticLogs(zw *zip.Writer, in DiagnosticInputs, redact redactor) ([]string, error) {
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
		if err := bundleWriteRaw(zw, name, []byte(redact.apply(string(body))), in.Now); err != nil {
			return nil, fmt.Errorf("diagnostic bundle: write log %s: %w", p, err)
		}
		logs = append(logs, name)
	}
	return logs, nil
}

func redactEnv(env DiagnosticEnv, redact redactor) DiagnosticEnv {
	env.TesseractPath = redact.apply(env.TesseractPath)
	return env
}

func redactParser(p DiagnosticParser, redact redactor) DiagnosticParser {
	p.LoadError = redact.apply(p.LoadError)
	files := make([]parser.DataFile, len(p.DataFiles))
	for i, f := range p.DataFiles {
		f.Source = redact.apply(f.Source)
		files[i] = f
	}
	p.DataFiles = files
	return p
}
