package app_test

import (
	"context"
	"testing"

	"recall/pkg/app"
)

// seedSettings writes `s` to <base>/profiles/<active>/settings.json
// so a subsequent App.Startup picks it up via the standard load path.
//
// Used by tests that need to land a particular Settings shape on disk
// BEFORE the App under test runs Startup. Pre-profiles this was a
// straight `(&App{}).saveSettings(s)` call against <base>/settings.json;
// the profile manager moves the file under <base>/profiles/<active>/,
// so the seed has to thread through a real Profiles instance to land
// at the right path.
//
// `t.Setenv("RECALL_DATA_DIR", t.TempDir())` is the caller's
// responsibility — the seed honors it via appBaseDir.
func seedSettings(t *testing.T, s app.Settings) {
	t.Helper()
	a := app.New()
	a.Startup(context.Background())
	// Startup may have stamped defaults (e.g. TesseractPath) into
	// a.settings — overlay the test-supplied seed on top so the
	// caller sees exactly what they asked for.
	*app.AppSettings(a) = s
	if err := app.SaveSettings(a, s); err != nil {
		t.Fatalf("seed settings: %v", err)
	}
}
