package app_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
	"recall/pkg/parser"
)

func stubDiagnose(t *testing.T) *[]string {
	t.Helper()
	var mu sync.Mutex
	calls := &[]string{}
	prev := app.DiagnoseScreenshotFunc
	app.DiagnoseScreenshotFunc = func(path string) parser.Diagnosis {
		mu.Lock()
		*calls = append(*calls, filepath.Base(path))
		mu.Unlock()
		return parser.Diagnosis{Type: parser.TypeUnknown, Error: "row OCR: expected 6 stat columns, found 0"}
	}
	t.Cleanup(func() { app.DiagnoseScreenshotFunc = prev })
	return calls
}

type exportedTraceManifest struct {
	Parser struct {
		Generation int `json:"generation"`
	} `json:"parser"`
	Failures []struct {
		Filename  string          `json:"filename"`
		Parked    bool            `json:"parked"`
		Diagnosis json.RawMessage `json:"diagnosis"`
	} `json:"failures"`
}

func exportManifest(t *testing.T, a *app.App) exportedTraceManifest {
	t.Helper()
	data, err := a.ExportDiagnosticBundle()
	mustNoErr(t, err)
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	mustNoErr(t, err)
	var m exportedTraceManifest
	for _, f := range zr.File {
		if f.Name != "manifest.json" {
			continue
		}
		rc, err := f.Open()
		mustNoErr(t, err)
		mustNoErr(t, json.NewDecoder(rc).Decode(&m))
		_ = rc.Close()
	}
	return m
}

// Each on-disk failure is re-parsed by THIS build at export time, so the
// bundle says what the fixed-or-not parser makes of it now. A re-parse costs
// seconds and ~1 MB of crops, and the ledger is unbounded — so only the most
// recently failed files are diagnosed; the rest keep their manifest entry.
func TestApp_ExportDiagnosticBundle_DiagnosesTheMostRecentFailures(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	shots := t.TempDir()
	app.SettingsOf(a).ScreenshotsDir = shots
	total := app.DiagnosedFailureCap + 2
	for i := range total {
		name := fmt.Sprintf("shot-%02d.png", i)
		mustNoErr(t, os.WriteFile(filepath.Join(shots, name), []byte("x"), 0o600))
		mustNoErr(t, fake.RecordFailedFile(name, 0, "boom"))
		row := fake.FailedFiles[name]
		row.LastFailedAt = fmt.Sprintf("2026-09-%02dT00:00:00Z", i+1)
		fake.FailedFiles[name] = row
	}
	calls := stubDiagnose(t)

	m := exportManifest(t, a)

	if len(*calls) != app.DiagnosedFailureCap {
		t.Fatalf("diagnosed %d files, want the cap %d", len(*calls), app.DiagnosedFailureCap)
	}
	for _, f := range m.Failures {
		oldest := f.Filename == "shot-00.png" || f.Filename == "shot-01.png"
		diagnosed := string(f.Diagnosis) != "null" && len(f.Diagnosis) > 0
		if oldest == diagnosed {
			t.Errorf("%s diagnosed=%v; only the %d most recent failures should be", f.Filename, diagnosed, app.DiagnosedFailureCap)
		}
	}
	if m.Parser.Generation != parser.Generation {
		t.Errorf("parser generation = %d, want %d", m.Parser.Generation, parser.Generation)
	}
}

// The parked flag is the one the Unknown tab shows — derived by the same
// rule, not re-derived for the bundle.
func TestApp_ExportDiagnosticBundle_MarksParkedFailures(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	app.SettingsOf(a).ScreenshotsDir = t.TempDir()
	for range 3 {
		mustNoErr(t, fake.RecordFailedFile("parked.png", 0, "boom"))
	}
	mustNoErr(t, fake.RecordFailedFile("fresh.png", 0, "boom"))
	stubDiagnose(t)

	for _, f := range exportManifest(t, a).Failures {
		if want := f.Filename == "parked.png"; f.Parked != want {
			t.Errorf("%s parked = %v, want %v", f.Filename, f.Parked, want)
		}
	}
}
