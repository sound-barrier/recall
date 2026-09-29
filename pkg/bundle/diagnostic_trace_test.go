package bundle_test

import (
	"encoding/json"
	"strings"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/parser"
)

// v2 fields: what the 2026-09-25 bundle could not answer without a local
// repro — was each file parked, what did each probe read, what does THIS
// build make of the file now, and which roster data did the parser run with.
type traceManifest struct {
	Environment struct {
		TesseractLanguages []string `json:"tesseract_languages"`
	} `json:"environment"`
	Parser struct {
		Generation int               `json:"generation"`
		DataFiles  []parser.DataFile `json:"data_files"`
		LoadError  string            `json:"load_error"`
	} `json:"parser"`
	Failures []struct {
		Filename  string          `json:"filename"`
		Parked    bool            `json:"parked"`
		Diagnosis *traceDiagnosis `json:"diagnosis"`
	} `json:"failures"`
}

type traceDiagnosis struct {
	Type     string             `json:"type"`
	Error    string             `json:"error"`
	Probes   []parser.ProbeStep `json:"probes"`
	OCR      map[string]string  `json:"ocr"`
	DebugDir string             `json:"debug_dir"`
}

func tracedInputs(t *testing.T) bundle.DiagnosticInputs {
	t.Helper()
	in, _ := diagnosticInputs(t)
	in.Parked = map[string]bool{"good.png": true}
	in.Diagnoses = map[string]parser.Diagnosis{
		"good.png": {
			Type:  parser.TypeUnknown,
			Error: "row OCR: expected 6 stat columns, found 0",
			Probes: []parser.ProbeStep{
				{Name: "rank", Matched: false}, {Name: "teams", Matched: true},
			},
			OCR:   map[string]string{"detect_rank": "KED THAN 495"},
			Files: map[string][]byte{"detect_rank.png": []byte("png"), "detect_rank.txt": []byte("KED THAN 495")},
		},
	}
	in.Env.TesseractLanguages = []string{"eng", "osd"}
	in.Parser = bundle.DiagnosticParser{
		Generation: 2,
		DataFiles:  []parser.DataFile{{Name: "heroes.yaml", Source: "override", SHA256: strings.Repeat("a", 64)}},
	}
	return in
}

func TestExportDiagnostic_CarriesEachFailuresDiagnosis(t *testing.T) {
	data, err := bundle.ExportDiagnostic(tracedInputs(t))
	if err != nil {
		t.Fatalf("ExportDiagnostic: %v", err)
	}
	entries := readZip(t, data)
	var m traceManifest
	if err := json.Unmarshal(entries["manifest.json"], &m); err != nil {
		t.Fatalf("manifest decode: %v", err)
	}
	for _, f := range m.Failures {
		if f.Filename == "good.png" {
			assertGoodDiagnosis(t, f.Parked, f.Diagnosis, entries)
			continue
		}
		if f.Parked || f.Diagnosis != nil {
			t.Errorf("%s: parked=%v diagnosis=%v, want neither", f.Filename, f.Parked, f.Diagnosis)
		}
	}
}

func assertGoodDiagnosis(t *testing.T, parked bool, d *traceDiagnosis, entries map[string][]byte) {
	t.Helper()
	if !parked {
		t.Error("good.png parked flag lost")
	}
	if d == nil {
		t.Fatal("good.png diagnosis missing")
	}
	if d.Error != "row OCR: expected 6 stat columns, found 0" || len(d.Probes) != 2 || d.OCR["detect_rank"] != "KED THAN 495" {
		t.Errorf("good.png diagnosis = %+v", d)
	}
	if string(entries[d.DebugDir+"/detect_rank.txt"]) != "KED THAN 495" || entries[d.DebugDir+"/detect_rank.png"] == nil {
		t.Errorf("debug files missing under %q (have %v)", d.DebugDir, keys(entries))
	}
}

func TestExportDiagnostic_CarriesTheParserFingerprint(t *testing.T) {
	data, err := bundle.ExportDiagnostic(tracedInputs(t))
	if err != nil {
		t.Fatalf("ExportDiagnostic: %v", err)
	}
	var m traceManifest
	if err := json.Unmarshal(readZip(t, data)["manifest.json"], &m); err != nil {
		t.Fatalf("manifest decode: %v", err)
	}
	if m.Parser.Generation != 2 || len(m.Parser.DataFiles) != 1 || m.Parser.DataFiles[0].Source != "override" {
		t.Errorf("parser fingerprint = %+v", m.Parser)
	}
	if strings.Join(m.Environment.TesseractLanguages, ",") != "eng,osd" {
		t.Errorf("tesseract languages = %v", m.Environment.TesseractLanguages)
	}
}

// A file that never decoded has a diagnosis (its error is the finding) but no
// crops. Its debug_dir must not name a folder the zip does not contain.
func TestExportDiagnostic_NamesNoDebugDirWithoutFiles(t *testing.T) {
	in := tracedInputs(t)
	in.Diagnoses = map[string]parser.Diagnosis{
		"corrupt.png": {Type: parser.TypeUnknown, Error: "decoding image: png: invalid format"},
	}
	data, err := bundle.ExportDiagnostic(in)
	if err != nil {
		t.Fatalf("ExportDiagnostic: %v", err)
	}
	var m traceManifest
	if err := json.Unmarshal(readZip(t, data)["manifest.json"], &m); err != nil {
		t.Fatalf("manifest decode: %v", err)
	}
	for _, f := range m.Failures {
		if f.Filename != "corrupt.png" {
			continue
		}
		if f.Diagnosis == nil || f.Diagnosis.Error == "" {
			t.Fatalf("corrupt.png diagnosis = %+v, want its decode error", f.Diagnosis)
		}
		if f.Diagnosis.DebugDir != "" {
			t.Errorf("debug_dir = %q for a diagnosis with no files", f.Diagnosis.DebugDir)
		}
	}
}
