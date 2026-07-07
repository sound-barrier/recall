package bundle_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"recall/pkg/bundle"
	"recall/pkg/db"
)

func writePNG(t *testing.T, path string, w, h int) {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func diagnosticInputs(t *testing.T) (bundle.DiagnosticInputs, string) {
	t.Helper()
	shots := t.TempDir()
	writePNG(t, filepath.Join(shots, "good.png"), 32, 18)
	if err := os.WriteFile(filepath.Join(shots, "corrupt.png"), []byte("not a png"), 0o600); err != nil {
		t.Fatalf("write corrupt: %v", err)
	}
	logs := t.TempDir()
	if err := os.WriteFile(filepath.Join(logs, "recall.log"), []byte("log line\n"), 0o600); err != nil {
		t.Fatalf("write log: %v", err)
	}
	return bundle.DiagnosticInputs{
		FailedFiles: []db.FailedFileRow{
			{Filename: "good.png", ScreenshotsDirID: 1, Error: "boom", Attempts: 2,
				FirstFailedAt: "2026-07-01T20:00:00Z", LastFailedAt: "2026-07-06T21:30:00Z"},
			{Filename: "corrupt.png", ScreenshotsDirID: 1, Error: "decode", Attempts: 1,
				FirstFailedAt: "2026-07-02T20:00:00Z", LastFailedAt: "2026-07-06T21:31:00Z"},
			{Filename: "vanished.png", ScreenshotsDirID: 1, Error: "gone", Attempts: 4,
				FirstFailedAt: "2026-07-03T20:00:00Z", LastFailedAt: "2026-07-06T21:32:00Z"},
		},
		FallbackDir: shots,
		LogPaths: []string{
			filepath.Join(logs, "recall.log"),
			filepath.Join(logs, "recall.log.1"), // absent — must be skipped silently
		},
		Version: "0.26.0-test",
		Env: bundle.DiagnosticEnv{
			OS: "windows", Arch: "amd64",
			TesseractPath:    `C:\Program Files\Tesseract-OCR\tesseract.exe`,
			TesseractVersion: "5.3.4", TesseractFound: true,
		},
		Now: time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC),
	}, shots
}

func readZip(t *testing.T, data []byte) map[string][]byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip open: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		b := new(bytes.Buffer)
		if _, err := b.ReadFrom(rc); err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		_ = rc.Close()
		out[f.Name] = b.Bytes()
	}
	return out
}

type diagManifest struct {
	Schema        string `json:"schema"`
	ExportedAt    string `json:"exported_at"`
	RecallVersion string `json:"recall_version"`
	Environment   struct {
		OS               string `json:"os"`
		Arch             string `json:"arch"`
		TesseractPath    string `json:"tesseract_path"`
		TesseractVersion string `json:"tesseract_version"`
		TesseractFound   bool   `json:"tesseract_found"`
	} `json:"environment"`
	FailedCount int `json:"failed_count"`
	Failures    []struct {
		Filename      string `json:"filename"`
		Error         string `json:"error"`
		Attempts      int    `json:"attempts"`
		FirstFailedAt string `json:"first_failed_at"`
		LastFailedAt  string `json:"last_failed_at"`
		SourceDir     string `json:"source_dir"`
		Resolution    string `json:"resolution"`
		Included      bool   `json:"included"`
	} `json:"failures"`
	Logs []string `json:"logs"`
}

func TestExportDiagnostic_ZipInventoryAndManifest(t *testing.T) {
	in, shots := diagnosticInputs(t)
	data, err := bundle.ExportDiagnostic(in)
	if err != nil {
		t.Fatalf("ExportDiagnostic: %v", err)
	}
	entries := readZip(t, data)

	for _, want := range []string{"manifest.json", "screenshots/good.png", "screenshots/corrupt.png", "logs/recall.log"} {
		if _, ok := entries[want]; !ok {
			t.Errorf("zip missing %s (have %v)", want, keys(entries))
		}
	}
	if _, ok := entries["screenshots/vanished.png"]; ok {
		t.Error("missing-on-disk file must not get a zip entry")
	}
	if _, ok := entries["logs/recall.log.1"]; ok {
		t.Error("absent rotation must be skipped, not written empty")
	}

	var m diagManifest
	if err := json.Unmarshal(entries["manifest.json"], &m); err != nil {
		t.Fatalf("manifest decode: %v", err)
	}
	if m.Schema != "recall-diagnostic/v1" {
		t.Errorf("schema = %q", m.Schema)
	}
	if m.RecallVersion != "0.26.0-test" || m.FailedCount != 3 {
		t.Errorf("version/count = %q/%d", m.RecallVersion, m.FailedCount)
	}
	if m.Environment.OS != "windows" || !m.Environment.TesseractFound || m.Environment.TesseractVersion != "5.3.4" {
		t.Errorf("environment = %+v", m.Environment)
	}
	if len(m.Logs) != 1 || m.Logs[0] != "logs/recall.log" {
		t.Errorf("logs = %v, want just logs/recall.log", m.Logs)
	}

	if len(m.Failures) != 3 {
		t.Fatalf("failures = %d, want 3", len(m.Failures))
	}
	// Deterministic: sorted by filename.
	if m.Failures[0].Filename != "corrupt.png" || m.Failures[1].Filename != "good.png" || m.Failures[2].Filename != "vanished.png" {
		t.Errorf("failure order = %v", []string{m.Failures[0].Filename, m.Failures[1].Filename, m.Failures[2].Filename})
	}
	byName := map[string]int{}
	for i, f := range m.Failures {
		byName[f.Filename] = i
	}
	good := m.Failures[byName["good.png"]]
	if good.Resolution != "32x18" || !good.Included || good.SourceDir != shots || good.Error != "boom" || good.Attempts != 2 {
		t.Errorf("good.png failure = %+v", good)
	}
	corrupt := m.Failures[byName["corrupt.png"]]
	if corrupt.Resolution != "unknown" || !corrupt.Included {
		t.Errorf("corrupt.png must be included with resolution unknown: %+v", corrupt)
	}
	vanished := m.Failures[byName["vanished.png"]]
	if vanished.Included {
		t.Errorf("vanished.png must be marked included:false: %+v", vanished)
	}
}

func TestExportDiagnostic_GuardsEntryNames(t *testing.T) {
	in, _ := diagnosticInputs(t)
	in.FailedFiles = append(in.FailedFiles, db.FailedFileRow{
		Filename: "../escape.png", ScreenshotsDirID: 1, Error: "x", Attempts: 1,
	})
	data, err := bundle.ExportDiagnostic(in)
	if err != nil {
		t.Fatalf("ExportDiagnostic: %v", err)
	}
	for name := range readZip(t, data) {
		if name == "screenshots/../escape.png" {
			t.Error("path-separator filenames must not become zip entries")
		}
	}
}

func keys(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
