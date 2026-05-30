package app

import (
	"context"
	"os"
	"testing"
)

// Round-trip persistence tests for ScreenshotsDir — pin the
// user-reported regression "each time I start up my app I have to
// change my screenshot folder."
//
// The persistence contract has three steps, each tested below:
//   1. SetScreenshotsDir(p) writes p into settings.json on disk.
//   2. A fresh app instance reads p back via loadSettings.
//   3. Startup's validate-and-clear preserves p when the directory
//      is still a readable dir.
//
// Splitting the assertions per step makes the failure mode obvious:
// if the write half fails, settings.json never had the value; if
// the read half fails, loadSettings returns a stale value; if the
// validate half over-clears, Startup wipes a perfectly-valid path.

func TestScreenshotsDir_PersistsAcrossAppRestart(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	// User's screenshots dir for the session. Must be a real
	// readable directory so SetScreenshotsDir's validateScreenshotsDir
	// accepts it AND Startup's isReadableDir preserves it.
	dir := t.TempDir()

	// ── Session 1: pick the folder ──────────────────────────────
	a1 := NewWithStore(&fakeStore{})
	a1.Startup(context.Background())
	if err := a1.SetScreenshotsDir(dir); err != nil {
		t.Fatalf("session 1 SetScreenshotsDir: %v", err)
	}
	if a1.settings.ScreenshotsDir != dir {
		t.Fatalf("session 1 in-memory dir = %q; want %q", a1.settings.ScreenshotsDir, dir)
	}
	// Sanity: the write reached disk so a fresh loadSettings sees it.
	persisted := loadSettings()
	if persisted.ScreenshotsDir != dir {
		t.Fatalf("session 1 settings.json ScreenshotsDir = %q; want %q (the write to disk silently dropped)", persisted.ScreenshotsDir, dir)
	}

	// ── Session 2: simulate restarting the app ─────────────────
	// New App instance, same HOME/XDG_CONFIG_HOME, so loadSettings
	// reads the same settings.json the previous session wrote.
	a2 := NewWithStore(&fakeStore{})
	a2.Startup(context.Background())

	if a2.settings.ScreenshotsDir != dir {
		t.Errorf("session 2 ScreenshotsDir = %q; want %q (the dir did NOT persist across the simulated app restart)", a2.settings.ScreenshotsDir, dir)
	}
	if got := a2.GetScreenshotsDir(); got != dir {
		t.Errorf("session 2 GetScreenshotsDir() = %q; want %q (the public getter sees the cleared value)", got, dir)
	}
}

func TestScreenshotsDir_PersistsAcrossMultipleRestarts(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	dir := t.TempDir()

	// Set the dir once via session 1.
	a1 := NewWithStore(&fakeStore{})
	a1.Startup(context.Background())
	if err := a1.SetScreenshotsDir(dir); err != nil {
		t.Fatalf("session 1 SetScreenshotsDir: %v", err)
	}

	// Five sequential restarts — each must see the dir survive.
	// The user said "each time I start up my app I have to change my
	// screenshot folder"; this pins that bug shape across N≥2.
	for i := 0; i < 5; i++ {
		a := NewWithStore(&fakeStore{})
		a.Startup(context.Background())
		if a.settings.ScreenshotsDir != dir {
			t.Errorf("restart #%d: ScreenshotsDir = %q; want %q", i+1, a.settings.ScreenshotsDir, dir)
		}
	}
}

// The user-reported bug shape: the dir EXISTS but Startup's
// validate-and-clear can't readdir it (permission denied — common on
// macOS when the wails-dev binary rebuilds and TCC re-prompts, or
// when the dir lives on a removable / network volume that's
// temporarily unreachable). Pre-fix, isReadableDir returned false on
// EPERM and Startup wiped the perfectly-valid setting, forcing the
// user to re-pick on every restart. The fix: only clear when the
// dir is GONE (os.IsNotExist or "not a directory"); preserve on
// any other error so the user keeps their setting and the rest of
// the app surfaces the access issue (the watcher fails to start;
// the parse handler shows ErrInvalidScreenshotsDir; the Open
// button no-ops) instead of silently dropping the configuration.
func TestStartup_PreservesScreenshotsDirWhenExistsButUnreadable(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	// Create a directory that exists but the process can't enumerate.
	// Strip read/execute bits so isReadableDir's Readdirnames fails
	// with EACCES while the dir itself is still present.
	dir := t.TempDir()
	if err := os.Chmod(dir, 0o000); err != nil {
		t.Fatalf("chmod %q to unreadable: %v", dir, err)
	}
	// Restore permissions on cleanup so t.TempDir's own cleanup works.
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })

	if err := saveSettings(Settings{ScreenshotsDir: dir}); err != nil {
		t.Fatalf("seed saveSettings: %v", err)
	}

	a := NewWithStore(&fakeStore{})
	a.Startup(context.Background())

	if a.settings.ScreenshotsDir != dir {
		t.Errorf("Startup wiped a perfectly-valid path because it was temporarily unreadable; got %q want %q", a.settings.ScreenshotsDir, dir)
	}
	// And the persisted shape must match: if Startup re-saved an
	// empty value, the next session reads it back as "" and the bug
	// surfaces on every restart instead of just one.
	persisted := loadSettings()
	if persisted.ScreenshotsDir != dir {
		t.Errorf("settings.json ScreenshotsDir got cleared on disk; got %q want %q", persisted.ScreenshotsDir, dir)
	}
}

func TestScreenshotsDir_PersistsWhenDirContainsCommonRealWorldChars(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	// Use a path with characters that show up in real user setups:
	// spaces (common on macOS / Windows). The user-visible bug
	// shouldn't reproduce here, but locking the contract for
	// space-containing paths catches a future safePathChars
	// tightening that would unintentionally reject them.
	parent := t.TempDir()
	dir := parent + "/Screen Shots"
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatalf("mkdir %q: %v", dir, err)
	}

	a1 := NewWithStore(&fakeStore{})
	a1.Startup(context.Background())
	if err := a1.SetScreenshotsDir(dir); err != nil {
		t.Fatalf("SetScreenshotsDir(%q): %v", dir, err)
	}

	a2 := NewWithStore(&fakeStore{})
	a2.Startup(context.Background())
	if a2.settings.ScreenshotsDir != dir {
		t.Errorf("ScreenshotsDir = %q; want %q (space-containing path did not survive restart)", a2.settings.ScreenshotsDir, dir)
	}
}
