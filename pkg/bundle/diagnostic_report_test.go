package bundle_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/parser"
)

// A report is about the files the user picked, failed or not: a screenshot
// that parsed into the wrong hero is as reportable as one that errored.
func TestExportDiagnostic_CarriesAParsedFileWithItsNote(t *testing.T) {
	in, shots := diagnosticInputs(t)
	writePNG(t, filepath.Join(shots, "misread.png"), 32, 18)
	in.Files = []bundle.DiagnosticFile{{Filename: "misread.png", ScreenshotsDirID: 1, Note: "hero should be Kiriko"}}

	m, entries := exportManifest(t, in)

	if _, ok := entries["screenshots/misread.png"]; !ok {
		t.Fatalf("zip missing screenshots/misread.png (have %v)", keys(entries))
	}
	if len(m.Files) != 1 {
		t.Fatalf("files = %d, want 1", len(m.Files))
	}
	got := m.Files[0]
	if got.Note != "hero should be Kiriko" || !got.Included {
		t.Errorf("misread.png = %+v, want its note and included", got)
	}
	if got.Failure != nil {
		t.Errorf("a file that parsed must carry no failure block, got %+v", got.Failure)
	}
}

func TestExportDiagnostic_RedactsPathsInManifestAndLogs(t *testing.T) {
	in, shots := diagnosticInputs(t)
	home := filepath.Dir(shots)
	escaped := strings.ReplaceAll(home, `\`, `\\`)
	in.Files[0].Failure.Error = "open " + filepath.Join(shots, "good.png") + ": denied"
	in.Env.TesseractPath = filepath.Join(home, "bin", "tesseract")
	writeLog(t, in.LogPaths[0], "watching "+shots+"\nquoted \""+escaped+"\"\n")
	in.Redactions = []bundle.PathRedaction{
		{Path: home, Placeholder: "<home>"},
		{Path: shots, Placeholder: "<screenshots>"},
	}

	m, entries := exportManifest(t, in)

	raw := string(entries["manifest.json"]) + string(entries["logs/recall.log"])
	if strings.Contains(raw, home) || (escaped != home && strings.Contains(raw, escaped)) {
		t.Errorf("a path survived redaction:\n%s", raw)
	}
	good := fileNamed(t, m, "good.png")
	if good.SourceDir != "<screenshots>" {
		t.Errorf("source_dir = %q, want the longest match <screenshots>", good.SourceDir)
	}
	if good.Failure.Error != "open "+filepath.Join("<screenshots>", "good.png")+": denied" {
		t.Errorf("failure error = %q", good.Failure.Error)
	}
	if m.Environment.TesseractPath != filepath.Join("<home>", "bin", "tesseract") {
		t.Errorf("tesseract_path = %q", m.Environment.TesseractPath)
	}
}

func TestExportDiagnostic_RedactsADiagnosisError(t *testing.T) {
	in, shots := diagnosticInputs(t)
	in.Diagnoses = map[string]parser.Diagnosis{
		"good.png": {Type: parser.TypeUnknown, Error: "tesseract read " + shots + "/good.png"},
	}
	in.Redactions = []bundle.PathRedaction{{Path: shots, Placeholder: "<screenshots>"}}

	data, err := bundle.ExportDiagnostic(in)
	if err != nil {
		t.Fatalf("ExportDiagnostic: %v", err)
	}
	if strings.Contains(string(readZip(t, data)["manifest.json"]), shots) {
		t.Error("diagnosis error kept the screenshots path")
	}
}

func TestExportDiagnostic_ManifestCarriesLikelyCauses(t *testing.T) {
	in, _ := diagnosticInputs(t)
	in.Env.TesseractVersion = "4.1.1"

	m, _ := exportManifest(t, in)

	if !hasCause(m.LikelyCauses, bundle.CauseTesseractUnsupported, "") {
		t.Errorf("likely_causes = %+v, want %s", m.LikelyCauses, bundle.CauseTesseractUnsupported)
	}
}

func exportManifest(t *testing.T, in bundle.DiagnosticInputs) (diagManifest, map[string][]byte) {
	t.Helper()
	data, err := bundle.ExportDiagnostic(in)
	if err != nil {
		t.Fatalf("ExportDiagnostic: %v", err)
	}
	entries := readZip(t, data)
	var m diagManifest
	if err := json.Unmarshal(entries["manifest.json"], &m); err != nil {
		t.Fatalf("manifest decode: %v", err)
	}
	return m, entries
}

type diagFile struct {
	Filename   string `json:"filename"`
	Note       string `json:"note"`
	SourceDir  string `json:"source_dir"`
	Resolution string `json:"resolution"`
	Included   bool   `json:"included"`
	Failure    *struct {
		Error         string `json:"error"`
		Attempts      int    `json:"attempts"`
		FirstFailedAt string `json:"first_failed_at"`
		LastFailedAt  string `json:"last_failed_at"`
		Parked        bool   `json:"parked"`
	} `json:"failure"`
}

func fileNamed(t *testing.T, m diagManifest, name string) diagFile {
	t.Helper()
	for _, f := range m.Files {
		if f.Filename == name {
			return f
		}
	}
	t.Fatalf("manifest has no %s", name)
	return diagFile{}
}

func writeLog(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write log: %v", err)
	}
}

func hasCause(causes []bundle.LikelyCause, code, filename string) bool {
	for _, c := range causes {
		if c.Code == code && c.Filename == filename {
			return true
		}
	}
	return false
}
