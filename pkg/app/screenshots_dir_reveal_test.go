package app_test

import (
	"context"
	"errors"
	"os/exec"
	"testing"

	"recall/pkg/app"
)

// Reveal + Reset cover three behaviors:
//
//   - RevealScreenshotsDir surfaces the configured folder in the host
//     OS file manager. The original button used to call
//     BrowserOpenURL('file://…') which Wails v2.12 rejects with
//     "scheme not allowed"; the replacement is a backend method that
//     shells out to the platform-specific opener.
//   - ResetScreenshotsDir clears the persisted value (settings.json
//     gains an empty ScreenshotsDir) and stops the file watcher if it
//     was armed against the now-cleared path. Symmetric with
//     ResetTesseractPath / DELETE /api/v1/settings/screenshots-folder.
//   - Both methods report ErrInvalidScreenshotsDir when called against
//     an empty configuration so the HTTP handlers can return 400
//     instead of falling through to 500.

func TestRevealScreenshotsDir_FailsWhenUnconfigured(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	// Skip Startup entirely so the auto-probe doesn't accidentally
	// adopt some folder on the dev machine (the repo's own
	// ./screenshots, for instance) and turn this from an "empty
	// config" test into a "valid config" test. We only care about
	// the empty-string branch.
	a := app.NewWithStore(&fakeStore{})

	err := a.RevealScreenshotsDir()
	if err == nil {
		t.Fatal("RevealScreenshotsDir should fail when no folder is configured")
	}
	if !errors.Is(err, app.ErrInvalidScreenshotsDir) {
		t.Errorf("error must wrap ErrInvalidScreenshotsDir (so HTTP returns 400, not 500); got %v", err)
	}
}

// Pin the spawn shape so a future refactor can't silently break the
// per-platform opener: macOS = `open`, Linux = `xdg-open`, Windows =
// `explorer`. We swap *app.RevealCommand for a recorder before calling, so
// no real `open` window pops on the dev machine when the test runs.
func TestRevealScreenshotsDir_SpawnsExpectedCommand(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	dir := t.TempDir()
	seedSettings(t, app.Settings{ScreenshotsDir: dir})

	a := app.NewWithStore(&fakeStore{})
	a.Startup(context.Background())
	if app.AppSettings(a).ScreenshotsDir != dir {
		t.Fatalf("test invariant: Startup didn't preserve seed dir; got %q want %q", app.AppSettings(a).ScreenshotsDir, dir)
	}

	// Swap the package-level spawn seam for a recorder. The recorder
	// pretends the open succeeded by exec'ing /usr/bin/true (or a
	// no-op equivalent on Windows) — the real binary never runs.
	var gotName string
	var gotArgs []string
	prev := *app.RevealCommand
	*app.RevealCommand = func(name string, args ...string) *exec.Cmd {
		gotName = name
		gotArgs = args
		return exec.CommandContext(context.Background(), "true")
	}
	t.Cleanup(func() { *app.RevealCommand = prev })

	if err := a.RevealScreenshotsDir(); err != nil {
		t.Fatalf("RevealScreenshotsDir: %v", err)
	}

	if gotName == "" {
		t.Fatal("*app.RevealCommand was never invoked — RevealScreenshotsDir didn't reach the spawn seam")
	}
	// The opener gets the configured path as its sole argument so the
	// file manager opens directly inside that folder (rather than
	// opening to $HOME and forcing the user to navigate).
	if len(gotArgs) != 1 || gotArgs[0] != dir {
		t.Errorf("opener args = %v; want [%q] (single positional arg = configured dir)", gotArgs, dir)
	}
}

func TestResetScreenshotsDir_ClearsInMemoryAndPersistedState(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	dir := t.TempDir()
	seedSettings(t, app.Settings{ScreenshotsDir: dir})
	a := app.NewWithStore(&fakeStore{})
	a.Startup(context.Background())
	if app.AppSettings(a).ScreenshotsDir != dir {
		t.Fatalf("test invariant: seed dir not loaded; got %q want %q", app.AppSettings(a).ScreenshotsDir, dir)
	}

	if err := a.ResetScreenshotsDir(); err != nil {
		t.Fatalf("ResetScreenshotsDir: %v", err)
	}

	if app.AppSettings(a).ScreenshotsDir != "" {
		t.Errorf("in-memory ScreenshotsDir = %q; want \"\" (Reset must clear)", app.AppSettings(a).ScreenshotsDir)
	}
	// And the persisted shape must match — otherwise the next Startup
	// re-loads the old value and Reset is a no-op across restarts.
	persisted := app.LoadSettings(a)
	if persisted.ScreenshotsDir != "" {
		t.Errorf("settings.json ScreenshotsDir = %q; want \"\" (Reset must persist the empty value)", persisted.ScreenshotsDir)
	}
}

// When the watcher is armed against the cleared path, Reset must stop
// it so we don't leak an fsnotify watcher pointed at a now-orphaned
// dir. Pre-fix this would have surfaced as the watcher silently
// continuing to fire ParseScreenshots against the empty configuration
// (which would then fail validation, log noise, and confuse the user).
func TestResetScreenshotsDir_StopsArmedWatcher(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	dir := t.TempDir()
	seedSettings(t, app.Settings{
		ScreenshotsDir: dir,
		WatchEnabled:   true,
	})

	a := app.NewWithStore(&fakeStore{})
	a.Startup(context.Background())
	// startWatching is gated behind Tesseract being ready in some
	// startup paths, so arm the watcher explicitly here to be sure
	// we're exercising the stop path.
	app.StartWatching(a)
	if app.AppWatcher(a) == nil {
		t.Fatal("test invariant: watcher should be armed before Reset")
	}

	if err := a.ResetScreenshotsDir(); err != nil {
		t.Fatalf("ResetScreenshotsDir: %v", err)
	}

	if app.AppWatcher(a) != nil {
		t.Errorf("watcher must be torn down after Reset; got non-nil watcher pointing at %q", app.AppWatchedDir(a))
	}
}
