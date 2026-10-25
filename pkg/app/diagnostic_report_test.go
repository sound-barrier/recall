package app_test

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/bundle"
	"recall/pkg/db/dbtest"
)

const reportShot = "Overwatch 2 Screenshot 2026.10.09 - 18.27.28.33.png"

func reportApp(t *testing.T) (*app.App, *dbtest.Fake, string) {
	t.Helper()
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	shots := t.TempDir()
	app.SettingsOf(a).ScreenshotsDir = shots
	return a, fake, shots
}

// A screenshot that parsed — into the wrong hero, say — is reportable: the
// report carries it with the user's note and no ledger failure.
func TestApp_ExportDiagnosticBundle_CarriesAPickedParsedFile(t *testing.T) {
	a, _, shots := reportApp(t)
	mustNoErr(t, os.WriteFile(filepath.Join(shots, reportShot), []byte("x"), 0o600))
	calls := stubDiagnose(t)

	m := exportManifest(t, a, app.ReportFile{Filename: reportShot, Note: "hero should be Kiriko"})

	if len(m.Files) != 1 || m.Files[0].Note != "hero should be Kiriko" || m.Files[0].Failure != nil {
		t.Fatalf("files = %+v, want the one picked file with its note and no failure", m.Files)
	}
	if len(*calls) != 1 {
		t.Errorf("diagnosed %d files, want the picked one", len(*calls))
	}
}

// The failed list sends no folder (it has none on the wire); the ledger row
// supplies both the failure and where the file lives.
func TestApp_ExportDiagnosticBundle_JoinsAPickedFailureToTheLedger(t *testing.T) {
	a, fake, shots := reportApp(t)
	mustNoErr(t, os.WriteFile(filepath.Join(shots, "bad.png"), []byte("x"), 0o600))
	mustNoErr(t, fake.RecordFailedFile("bad.png", 0, "decoding image: png: invalid format"))
	mustNoErr(t, fake.RecordFailedFile("other.png", 0, "boom"))
	stubDiagnose(t)

	m := exportManifest(t, a, app.ReportFile{Filename: "bad.png", Note: "this is a SUMMARY"})

	if len(m.Files) != 1 {
		t.Fatalf("files = %+v, want only the picked failure", m.Files)
	}
	if f := m.Files[0]; f.Failure == nil || f.Failure.Error != "decoding image: png: invalid format" || f.Note != "this is a SUMMARY" {
		t.Errorf("bad.png = %+v", f)
	}
}

func TestApp_ExportDiagnosticBundle_RejectsAnInvalidPick(t *testing.T) {
	a, _, _ := reportApp(t)
	cases := map[string][]app.ReportFile{
		"traversal":    {{Filename: "../secret.png"}},
		"separator":    {{Filename: `sub\shot.png`}},
		"negative dir": {{Filename: reportShot, ScreenshotsDirID: -1}},
		"long note":    {{Filename: reportShot, Note: strings.Repeat("x", app.MaxReportNoteRunes+1)}},
		"too many":     make([]app.ReportFile, app.MaxReportFiles+1),
	}
	for name, files := range cases {
		t.Run(name, func(t *testing.T) {
			for i := range files {
				if files[i].Filename == "" {
					files[i].Filename = reportShot
				}
			}
			if _, err := a.ExportDiagnosticBundle(files); !errors.Is(err, app.ErrInvalidReport) {
				t.Errorf("err = %v, want ErrInvalidReport", err)
			}
		})
	}
}

func TestApp_ExportDiagnosticBundle_RedactsTheScreenshotsFolder(t *testing.T) {
	a, _, shots := reportApp(t)
	mustNoErr(t, os.WriteFile(filepath.Join(shots, reportShot), []byte("x"), 0o600))
	stubDiagnose(t)

	data, err := a.ExportDiagnosticBundle([]app.ReportFile{{Filename: reportShot}})
	mustNoErr(t, err)

	manifest := zipEntry(t, data, "manifest.json")
	if strings.Contains(manifest, shots) || !strings.Contains(manifest, "[screenshots]") {
		t.Errorf("manifest kept the screenshots folder path:\n%s", manifest)
	}
}

func TestApp_PreflightDiagnosticBundle_FlagsAMissingFile(t *testing.T) {
	a, _, _ := reportApp(t)

	causes, err := a.PreflightDiagnosticBundle([]app.ReportFile{{Filename: reportShot}})
	mustNoErr(t, err)

	found := false
	for _, c := range causes {
		found = found || (c.Code == bundle.CauseFileMissing && c.Filename == reportShot)
	}
	if !found {
		t.Errorf("causes = %+v, want %s for %s", causes, bundle.CauseFileMissing, reportShot)
	}
}

func zipEntry(t *testing.T, data []byte, name string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	mustNoErr(t, err)
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		mustNoErr(t, err)
		b, err := io.ReadAll(rc)
		mustNoErr(t, err)
		_ = rc.Close()
		return string(b)
	}
	t.Fatalf("zip has no %s", name)
	return ""
}
