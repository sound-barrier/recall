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
	mustNoErr(t, os.MkdirAll(filepath.Join(base, "logs"), 0o750))
	mustNoErr(t, os.WriteFile(filepath.Join(base, "logs", "recall.log"), []byte("hello\n"), 0o600))

	fake := dbtest.New()
	a := app.NewWithStore(fake)
	shots := t.TempDir()
	app.SettingsOf(a).ScreenshotsDir = shots
	mustNoErr(t, os.WriteFile(filepath.Join(shots, "bad.png"), []byte("not a png"), 0o600))
	mustNoErr(t, fake.RecordFailedFile("bad.png", 0, "decoding image: png: invalid format"))

	data, err := a.ExportDiagnosticBundle()
	mustNoErr(t, err)
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	mustNoErr(t, err)
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
	mustNoErr(t, json.Unmarshal(manifestRaw, &m))
	if m.Schema != "recall-diagnostic/v1" || m.Environment.OS == "" {
		t.Errorf("manifest = schema %q os %q", m.Schema, m.Environment.OS)
	}
	if len(m.Failures) != 1 || m.Failures[0].Filename != "bad.png" || !m.Failures[0].Included {
		t.Errorf("failures = %+v", m.Failures)
	}
}
