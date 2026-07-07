package app_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
)

func TestApp_ExportDiagnosticBundle_EmptyLedgerIsSentinel(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	if _, err := a.ExportDiagnosticBundle(); !errors.Is(err, app.ErrNoFailedFiles) {
		t.Fatalf("err = %v, want ErrNoFailedFiles", err)
	}
}

func TestApp_ExportDiagnosticBundle_AssemblesLedgerLogsAndEnv(t *testing.T) {
	base := t.TempDir()
	t.Setenv("RECALL_DATA_DIR", base)
	if err := os.MkdirAll(filepath.Join(base, "logs"), 0o750); err != nil {
		t.Fatalf("mkdir logs: %v", err)
	}
	if err := os.WriteFile(filepath.Join(base, "logs", "recall.log"), []byte("hello\n"), 0o600); err != nil {
		t.Fatalf("write log: %v", err)
	}

	fake := dbtest.New()
	a := app.NewWithStore(fake)
	shots := t.TempDir()
	app.AppSettings(a).ScreenshotsDir = shots
	if err := os.WriteFile(filepath.Join(shots, "bad.png"), []byte("not a png"), 0o600); err != nil {
		t.Fatalf("write shot: %v", err)
	}
	if err := fake.RecordFailedFile("bad.png", 0, "decoding image: png: invalid format"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	data, err := a.ExportDiagnosticBundle()
	if err != nil {
		t.Fatalf("ExportDiagnosticBundle: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	names := map[string]bool{}
	var manifestRaw []byte
	for _, f := range zr.File {
		names[f.Name] = true
		if f.Name == "manifest.json" {
			rc, _ := f.Open()
			b := new(bytes.Buffer)
			_, _ = b.ReadFrom(rc)
			_ = rc.Close()
			manifestRaw = b.Bytes()
		}
	}
	for _, want := range []string{"manifest.json", "screenshots/bad.png", "logs/recall.log"} {
		if !names[want] {
			t.Errorf("zip missing %s (have %v)", want, names)
		}
	}
	var m struct {
		Schema      string `json:"schema"`
		Environment struct {
			OS string `json:"os"`
		} `json:"environment"`
		Failures []struct {
			Filename string `json:"filename"`
			Included bool   `json:"included"`
		} `json:"failures"`
	}
	if err := json.Unmarshal(manifestRaw, &m); err != nil {
		t.Fatalf("manifest: %v", err)
	}
	if m.Schema != "recall-diagnostic/v1" || m.Environment.OS == "" {
		t.Errorf("manifest = schema %q os %q", m.Schema, m.Environment.OS)
	}
	if len(m.Failures) != 1 || m.Failures[0].Filename != "bad.png" || !m.Failures[0].Included {
		t.Errorf("failures = %+v", m.Failures)
	}
}
