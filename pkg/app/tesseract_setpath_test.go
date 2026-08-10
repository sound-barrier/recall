package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
)

// SetTesseractPath is the sink CodeQL flags for command injection: the value
// it accepts reaches exec.Command. What the rejection branch owes the caller is
// twofold — the previously working configuration must survive a bad submission,
// and the reason must land in the cached status so the Engine banner explains
// itself without a second round-trip.
func TestSetTesseractPath_RejectionPreservesConfigAndReportsWhy(t *testing.T) {
	const working = "/opt/homebrew/bin/tesseract"
	rejected := []struct {
		name string
		in   string
	}{
		{"empty", ""},
		{"relative", "bin/tesseract"},
		{"non-canonical", "/usr/local/../bin/tesseract"},
		{"wrong basename", "/usr/bin/imagemagick"},
		{"shell metacharacters", "/usr/bin/tesseract; rm -rf /"},
	}
	for _, tc := range rejected {
		t.Run(tc.name, func(t *testing.T) {
			a := tesseractApp(t, working)

			status, err := a.SetTesseractPath(tc.in)

			if !errors.Is(err, app.ErrInvalidTesseractPath) {
				t.Fatalf("err = %v, want ErrInvalidTesseractPath", err)
			}
			if got := app.SettingsOf(a).TesseractPath; got != working {
				t.Errorf("configured path became %q — a rejected submission clobbered a working setting", got)
			}
			if status.Error != err.Error() {
				t.Errorf("returned status.Error = %q, want the validation message %q", status.Error, err)
			}
			if cached := a.GetTesseractStatus().Error; cached != err.Error() {
				t.Errorf("cached status.Error = %q, want %q — the banner reads the cache", cached, err)
			}
		})
	}
}

func tesseractApp(t *testing.T, configured string) *app.App {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.NewWithStore(dbtest.New())
	app.SettingsOf(a).TesseractPath = configured
	return a
}
