package app_test

import (
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
)

// Phase 4 #14 (server-mode parity audit) landed a behavior change:
// SetScreenshotsDir now restarts the watcher when WatchEnabled is true.
// Previously this side-effect lived inline in the Wails dialog flow
// (PickScreenshotsDir), so the server-mode HTTP path that called
// SetScreenshotsDir directly left the watcher pointed at the OLD dir.
// This test locks the new invariant: after SetScreenshotsDir, the
// watcher (if armed) is watching the new dir.

func TestSetScreenshotsDir_RestartsWatcherWhenEnabled(t *testing.T) {
	oldDir := t.TempDir()
	newDir := t.TempDir()

	// HOME isolation: settings.json writes go under appDataDir() which is
	// keyed off the user-config dir. Steer it to a per-test temp so the
	// real ~/Library/Application Support/Recall/settings.json stays
	// untouched. (Matches the HOME=/tmp/recall-e2e isolation in
	// playwright.config.ts.)
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	a := app.NewWithStore(&fakeStore{})
	app.SettingsOf(a).ScreenshotsDir = oldDir
	app.SettingsOf(a).WatchEnabled = true
	app.StartWatching(a)

	if app.WatchedDir(a) != oldDir {
		t.Fatalf("watcher should start on the old dir; watchedDir=%q want=%q", app.WatchedDir(a), oldDir)
	}
	t.Cleanup(func() { app.StopWatching(a) })

	if err := a.SetScreenshotsDir(newDir); err != nil {
		t.Fatalf("SetScreenshotsDir(newDir): %v", err)
	}
	if app.WatchedDir(a) != newDir {
		t.Errorf("watcher did not migrate to the new dir; watchedDir=%q want=%q", app.WatchedDir(a), newDir)
	}
}

func TestSetScreenshotsDir_NoWatcherRestartWhenDisabled(t *testing.T) {
	oldDir := t.TempDir()
	newDir := t.TempDir()

	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	a := app.NewWithStore(&fakeStore{})
	app.SettingsOf(a).ScreenshotsDir = oldDir
	app.SettingsOf(a).WatchEnabled = false // watcher off — no startWatching call

	if err := a.SetScreenshotsDir(newDir); err != nil {
		t.Fatalf("SetScreenshotsDir(newDir): %v", err)
	}
	if app.Watcher(a) != nil {
		t.Errorf("watcher should stay nil when WatchEnabled is false; got %v", app.Watcher(a))
	}
	if app.WatchedDir(a) != "" {
		t.Errorf("watchedDir should stay empty when WatchEnabled is false; got %q", app.WatchedDir(a))
	}
}

func TestSetScreenshotsDir_InvalidPathLeavesWatcherAlone(t *testing.T) {
	oldDir := t.TempDir()
	// Build a path that fails validation: not in canonical form
	// (filepath.Clean would strip the trailing "/.").
	bogus := filepath.Join(oldDir, "subdir", ".")

	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	a := app.NewWithStore(&fakeStore{})
	app.SettingsOf(a).ScreenshotsDir = oldDir
	app.SettingsOf(a).WatchEnabled = true
	app.StartWatching(a)
	t.Cleanup(func() { app.StopWatching(a) })

	if err := a.SetScreenshotsDir(bogus); err == nil {
		t.Fatal("expected validation error on non-canonical path, got nil")
	}
	if app.WatchedDir(a) != oldDir {
		t.Errorf("watcher should keep the old dir on validation failure; watchedDir=%q want=%q", app.WatchedDir(a), oldDir)
	}
	// The settings file must NOT have been written on the rejected path.
	if app.SettingsOf(a).ScreenshotsDir != oldDir {
		t.Errorf("settings.ScreenshotsDir should keep the old value on validation failure; got %q", app.SettingsOf(a).ScreenshotsDir)
	}
	// Sanity: bogus path doesn't exist anyway, but we want the error to
	// be about canonical form, not file-not-found.
	_, statErr := os.Stat(bogus)
	if statErr == nil {
		t.Fatalf("test fixture invariant broken: %q should not exist", bogus)
	}
}
