package bundle_test

import (
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/bundle"
)

const owName = "Overwatch 2 Screenshot 2026.10.09 - 18.27.28.33.png"

func causeInputs(t *testing.T) (bundle.DiagnosticInputs, string) {
	t.Helper()
	shots := t.TempDir()
	return bundle.DiagnosticInputs{
		FallbackDir: shots,
		Env: bundle.DiagnosticEnv{
			TesseractFound: true, TesseractVersion: "5.3.4", TesseractLanguages: []string{"eng", "osd"},
		},
	}, shots
}

func TestPreflightDiagnostic_HealthyReportHasNoCauses(t *testing.T) {
	in, shots := causeInputs(t)
	writePNG(t, filepath.Join(shots, owName), 64, 36)
	in.Files = []bundle.DiagnosticFile{{Filename: owName}}

	if got := bundle.PreflightDiagnostic(in); len(got) != 0 {
		t.Errorf("causes = %+v, want none", got)
	}
}

func TestPreflightDiagnostic_EnvironmentCauses(t *testing.T) {
	cases := []struct {
		name string
		env  bundle.DiagnosticEnv
		want string
	}{
		{"no tesseract", bundle.DiagnosticEnv{TesseractFound: false}, bundle.CauseTesseractMissing},
		{"tesseract 4", bundle.DiagnosticEnv{TesseractFound: true, TesseractVersion: "4.1.1", TesseractLanguages: []string{"eng"}}, bundle.CauseTesseractUnsupported},
		{"no english", bundle.DiagnosticEnv{TesseractFound: true, TesseractVersion: "5.3.4", TesseractLanguages: []string{"deu", "osd"}}, bundle.CauseTesseractNoEnglish},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in, _ := causeInputs(t)
			in.Env = tc.env
			got := bundle.PreflightDiagnostic(in)
			if len(got) != 1 || got[0].Code != tc.want || got[0].Message == "" {
				t.Errorf("causes = %+v, want exactly %s with a message", got, tc.want)
			}
		})
	}
}

// An unreadable language list says nothing about English; only a list that
// was read and lacks it is a finding.
func TestPreflightDiagnostic_UnknownLanguagesAreNotACause(t *testing.T) {
	in, _ := causeInputs(t)
	in.Env.TesseractLanguages = nil
	if got := bundle.PreflightDiagnostic(in); len(got) != 0 {
		t.Errorf("causes = %+v, want none", got)
	}
}

func TestPreflightDiagnostic_FileCauses(t *testing.T) {
	in, shots := causeInputs(t)
	writePNG(t, filepath.Join(shots, "Overwatch 2 Screenshot 2026.10.09 - 18.27.29.64.png"), 344, 144)
	writePNG(t, filepath.Join(shots, "my match.png"), 64, 36)
	if err := os.WriteFile(filepath.Join(shots, "Overwatch 2 Screenshot 2026.10.09 - 18.27.30.10.png"), []byte("nope"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	in.Files = []bundle.DiagnosticFile{
		{Filename: "Overwatch 2 Screenshot 2026.10.09 - 18.27.29.64.png"},
		{Filename: "my match.png"},
		{Filename: "Overwatch 2 Screenshot 2026.10.09 - 18.27.30.10.png"},
		{Filename: "Overwatch 2 Screenshot 2026.10.09 - 18.27.31.20.png"},
	}

	got := bundle.PreflightDiagnostic(in)

	want := []struct{ code, file string }{
		{bundle.CauseUnusualAspectRatio, "Overwatch 2 Screenshot 2026.10.09 - 18.27.29.64.png"},
		{bundle.CauseUnrecognizedFilename, "my match.png"},
		{bundle.CauseImageUnreadable, "Overwatch 2 Screenshot 2026.10.09 - 18.27.30.10.png"},
		{bundle.CauseFileMissing, "Overwatch 2 Screenshot 2026.10.09 - 18.27.31.20.png"},
	}
	if len(got) != len(want) {
		t.Fatalf("causes = %+v, want %d", got, len(want))
	}
	for _, w := range want {
		if !hasCause(got, w.code, w.file) {
			t.Errorf("missing %s for %s in %+v", w.code, w.file, got)
		}
	}
}
