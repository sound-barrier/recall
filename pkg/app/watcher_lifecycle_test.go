package app_test

import (
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
)

// SetWatchEnabled owns the watcher's whole lifecycle. What matters is that the
// toggle never leaves a half-live watcher behind: a dangling fsnotify handle
// keeps firing parses against a folder the user already moved off.

func watchApp(t *testing.T, screenshotsDir string) *app.App {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.NewWithStore(dbtest.New())
	app.SettingsOf(a).ScreenshotsDir = screenshotsDir
	return a
}

func TestSetWatchEnabled_StartsStopsAndIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	a := watchApp(t, dir)

	mustNoErr(t, a.SetWatchEnabled(true))
	first := app.Watcher(a)
	if first == nil {
		t.Fatal("no watcher after enabling with a real directory")
	}
	if got := app.WatchedDir(a); got != dir {
		t.Errorf("WatchedDir = %q, want %q", got, dir)
	}

	// Re-enabling must reuse the running watcher rather than opening a second
	// fsnotify handle on the same directory.
	mustNoErr(t, a.SetWatchEnabled(true))
	if app.Watcher(a) != first {
		t.Error("re-enabling replaced the live watcher — the first handle leaked")
	}

	mustNoErr(t, a.SetWatchEnabled(false))
	if app.Watcher(a) != nil {
		t.Error("watcher survived SetWatchEnabled(false)")
	}
	if got := app.WatchedDir(a); got != "" {
		t.Errorf("WatchedDir = %q after stop, want empty", got)
	}
	if a.GetWatchEnabled() {
		t.Error("GetWatchEnabled still reports true after disabling")
	}
}

// Turning the watcher off consumes whatever it had queued: the masthead's
// "watching · N new" dot must not keep showing a stale backlog against a
// watcher that is no longer running.
func TestSetWatchEnabled_StopClearsThePendingTally(t *testing.T) {
	a := watchApp(t, t.TempDir())
	mustNoErr(t, a.SetWatchEnabled(true))
	app.NoteWatchActivity(a)
	if pending, _ := app.WatchActivity(a); pending != 1 {
		t.Fatalf("pending = %d after one file event, want 1", pending)
	}

	mustNoErr(t, a.SetWatchEnabled(false))

	if pending, _ := app.WatchActivity(a); pending != 0 {
		t.Errorf("pending = %d after stopping, want 0", pending)
	}
}

// The folder can be gone by the time the user flips the toggle (removable
// drive, renamed OneDrive path). The preference still persists — the checkbox
// reflects intent, not reachability — but no watcher is left half-open, so a
// later re-enable against a restored folder starts cleanly.
func TestSetWatchEnabled_MissingDirectoryPersistsIntentWithoutAWatcher(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "gone")
	a := watchApp(t, missing)

	mustNoErr(t, a.SetWatchEnabled(true))

	if !a.GetWatchEnabled() {
		t.Error("the preference was not persisted for an unreachable folder")
	}
	if app.Watcher(a) != nil {
		t.Error("a watcher was created for a directory that does not exist")
	}
	if got := app.WatchedDir(a); got != "" {
		t.Errorf("WatchedDir = %q, want empty when the add failed", got)
	}
}

// No screenshots folder configured at all is the first-run state: enabling the
// watcher has to be a silent no-op rather than an error the UI must explain.
func TestSetWatchEnabled_UnconfiguredDirectoryIsASilentNoOp(t *testing.T) {
	a := watchApp(t, "")

	mustNoErr(t, a.SetWatchEnabled(true))

	if app.Watcher(a) != nil {
		t.Error("a watcher was created with no screenshots folder configured")
	}
	if !a.GetWatchEnabled() {
		t.Error("the preference was not persisted")
	}
}
