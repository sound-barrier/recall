package app

import (
	"os"
	"path/filepath"
	"testing"
)

// Phase 4 #14 (server-mode parity audit) landed a behaviour change:
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

	a := NewWithStore(&fakeStore{})
	a.settings.ScreenshotsDir = oldDir
	a.settings.WatchEnabled = true
	a.startWatching()

	if a.watchedDir != oldDir {
		t.Fatalf("watcher should start on the old dir; watchedDir=%q want=%q", a.watchedDir, oldDir)
	}
	t.Cleanup(a.stopWatching)

	if err := a.SetScreenshotsDir(newDir); err != nil {
		t.Fatalf("SetScreenshotsDir(newDir): %v", err)
	}
	if a.watchedDir != newDir {
		t.Errorf("watcher did not migrate to the new dir; watchedDir=%q want=%q", a.watchedDir, newDir)
	}
}

func TestSetScreenshotsDir_NoWatcherRestartWhenDisabled(t *testing.T) {
	oldDir := t.TempDir()
	newDir := t.TempDir()

	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	a := NewWithStore(&fakeStore{})
	a.settings.ScreenshotsDir = oldDir
	a.settings.WatchEnabled = false // watcher off — no startWatching call

	if err := a.SetScreenshotsDir(newDir); err != nil {
		t.Fatalf("SetScreenshotsDir(newDir): %v", err)
	}
	if a.watcher != nil {
		t.Errorf("watcher should stay nil when WatchEnabled is false; got %v", a.watcher)
	}
	if a.watchedDir != "" {
		t.Errorf("watchedDir should stay empty when WatchEnabled is false; got %q", a.watchedDir)
	}
}

func TestSetScreenshotsDir_InvalidPathLeavesWatcherAlone(t *testing.T) {
	oldDir := t.TempDir()
	// Build a path that fails validation: not in canonical form
	// (filepath.Clean would strip the trailing "/.").
	bogus := filepath.Join(oldDir, "subdir", ".")

	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	a := NewWithStore(&fakeStore{})
	a.settings.ScreenshotsDir = oldDir
	a.settings.WatchEnabled = true
	a.startWatching()
	t.Cleanup(a.stopWatching)

	if err := a.SetScreenshotsDir(bogus); err == nil {
		t.Fatal("expected validation error on non-canonical path, got nil")
	}
	if a.watchedDir != oldDir {
		t.Errorf("watcher should keep the old dir on validation failure; watchedDir=%q want=%q", a.watchedDir, oldDir)
	}
	// The settings file must NOT have been written on the rejected path.
	if a.settings.ScreenshotsDir != oldDir {
		t.Errorf("settings.ScreenshotsDir should keep the old value on validation failure; got %q", a.settings.ScreenshotsDir)
	}
	// Sanity: bogus path doesn't exist anyway, but we want the error to
	// be about canonical form, not file-not-found.
	_, statErr := os.Stat(bogus)
	if statErr == nil {
		t.Fatalf("test fixture invariant broken: %q should not exist", bogus)
	}
}
