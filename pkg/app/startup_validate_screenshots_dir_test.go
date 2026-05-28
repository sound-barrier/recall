package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// Startup validates the loaded settings.ScreenshotsDir against the
// filesystem and clears it when invalid (non-existent / not a directory
// / not readable). Without this guard a stale path — e.g. a long-
// deleted t.TempDir() that leaked into the user's real settings.json,
// or a removed external drive's mountpoint — persists in the UI and
// silently breaks every feature that depends on the screenshots dir
// (the "Open" button no-ops, the watcher fails to start, parse fails).
//
// Test isolation: t.Setenv on HOME + XDG_CONFIG_HOME so appDataDir()
// resolves into a per-test temp dir — same pattern as the existing
// screenshots_dir_test.go tests. The fake db.Store keeps the SQL layer
// out of scope for these settings-state assertions.

func TestStartup_ClearsScreenshotsDirWhenPathDoesNotExist(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	// Persist a non-existent path so Startup's loadSettings() reads it.
	stale := filepath.Join(t.TempDir(), "deleted-by-the-os-an-hour-ago")
	seed := Settings{
		ScreenshotsDir: stale,
		TesseractPath:  "/dev/null", // anything; we don't assert on it
	}
	if err := saveSettings(seed); err != nil {
		t.Fatalf("seed saveSettings: %v", err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("test invariant: stale path %q should not exist", stale)
	}

	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	if a.settings.ScreenshotsDir != "" {
		t.Errorf("Startup must clear an invalid ScreenshotsDir; got %q", a.settings.ScreenshotsDir)
	}

	// Persisted state must match the in-memory clear — otherwise the
	// next Startup re-loads the stale value and the user sees the bug
	// again. (Verify via a fresh load through the same code path the
	// production startup uses.)
	persisted := loadSettings()
	if persisted.ScreenshotsDir != "" {
		t.Errorf("saved settings still carry stale ScreenshotsDir; got %q", persisted.ScreenshotsDir)
	}
}

func TestStartup_ClearsScreenshotsDirWhenPathIsAFile(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	// A file (not a dir) is structurally invalid — a user could have
	// accidentally pointed Recall at a screenshot itself instead of
	// its parent directory.
	tmp := t.TempDir()
	file := filepath.Join(tmp, "screenshot.png")
	if err := os.WriteFile(file, []byte("not a real png"), 0o600); err != nil {
		t.Fatalf("seed file: %v", err)
	}
	if err := saveSettings(Settings{ScreenshotsDir: file}); err != nil {
		t.Fatalf("seed saveSettings: %v", err)
	}

	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	if a.settings.ScreenshotsDir != "" {
		t.Errorf("Startup must clear a ScreenshotsDir that's a file, not a dir; got %q", a.settings.ScreenshotsDir)
	}
}

func TestStartup_PreservesValidScreenshotsDir(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	good := t.TempDir() // exists, is a dir, readable
	if err := saveSettings(Settings{ScreenshotsDir: good}); err != nil {
		t.Fatalf("seed saveSettings: %v", err)
	}

	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	if a.settings.ScreenshotsDir != good {
		t.Errorf("Startup must not touch a valid ScreenshotsDir; got %q want %q",
			a.settings.ScreenshotsDir, good)
	}
}

func TestStartup_ClearsDefaultRelativePathWhenItDoesNotResolve(t *testing.T) {
	// `defaultSettings()` returns ScreenshotsDir="screenshots" (a
	// relative path) so `wails dev` can ship a working default when
	// the repo has a sibling `./screenshots/` directory. In the
	// SHIPPED Recall.app, the cwd is the .app bundle's MacOS folder —
	// no "screenshots" subdir exists — and the relative default would
	// otherwise persist as an unusable absolute path after
	// filepath.Clean. Clearing it on Startup gives autoProbeOnFirstRun
	// a chance to fire.
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	// cwd a directory that does NOT contain a "screenshots" subdir.
	cwd := t.TempDir()
	prevCwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	if err := os.Chdir(cwd); err != nil {
		t.Fatalf("Chdir to bare cwd: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(prevCwd) })

	// No settings file → loadSettings returns defaultSettings() →
	// ScreenshotsDir = "screenshots" (relative).
	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	if a.settings.ScreenshotsDir != "" {
		t.Errorf("Startup must clear the relative 'screenshots' default when it doesn't resolve; got %q",
			a.settings.ScreenshotsDir)
	}
}

// Asserting against the canonical user-reported case: the leaked
// `t.TempDir()` path from a test run pollutes settings.json, the user
// installs the official release, every subsequent startup reads the
// long-deleted path and the UI silently breaks. After Startup runs the
// path should be gone.
func TestStartup_ClearsLeakedTempDirPathFromAPriorTestRun(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	// Mimic the exact shape of the path the user reported:
	// /var/folders/9h/<random>/T/TestSetScreenshotsDir.../002
	leakedBase := t.TempDir() // exists during this test
	leaked := filepath.Join(leakedBase, "TestSetScreenshotsDir_NoWatcherRestartWhenDisabled1636778679", "002")
	if err := os.MkdirAll(leaked, 0o700); err != nil {
		t.Fatalf("seed: create leaked path: %v", err)
	}
	if err := saveSettings(Settings{ScreenshotsDir: leaked}); err != nil {
		t.Fatalf("seed saveSettings: %v", err)
	}
	// Now delete it to simulate the test-temp dir being cleaned up by
	// Go's testing infra long after the settings.json was written.
	if err := os.RemoveAll(leakedBase); err != nil {
		t.Fatalf("simulate post-test-run cleanup: %v", err)
	}

	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	if a.settings.ScreenshotsDir != "" {
		t.Errorf("Startup must clear a leaked deleted-temp path; got %q", a.settings.ScreenshotsDir)
	}
}
