package app_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/snapshot"
)

// A screenshot belongs to the first profile that parses it. Profiles usually
// watch the same Overwatch folder, so these run two real profiles (real
// stores, real claims ledger) over one shared folder; only OCR is stubbed.

// newSharedFolderApp boots a real App on an isolated data dir, creates the
// "alt" profile, and points both "main" and "alt" at the same folder. It
// returns with "main" active.
func newSharedFolderApp(t *testing.T) (*app.App, string) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	prevBackup := snapshot.BackupToFunc
	snapshot.BackupToFunc = func(_, _ string) error { return nil }
	t.Cleanup(func() { snapshot.BackupToFunc = prevBackup })

	a := app.New()
	a.Startup(context.Background())
	if err := a.StartupError(); err != nil {
		t.Fatalf("startup: %v", err)
	}
	shared := t.TempDir()
	mustNoErr(t, a.SetScreenshotsDir(shared))
	mustNoErr(t, a.CreateProfile("alt"))
	mustNoErr(t, a.SetScreenshotsDir(shared))
	switchTo(t, a, "main")
	return a, shared
}

func switchTo(t *testing.T, a *app.App, name string) {
	t.Helper()
	mustNoErr(t, a.SwitchProfile(name))
	app.TessStatus(a).Found = true
}

func parseCapturingSkip(t *testing.T, a *app.App) map[string]bool {
	t.Helper()
	var skip map[string]bool
	stubParseCapturingSkip(t, &skip)
	app.TessStatus(a).Found = true
	mustNoErr(t, a.ParseScreenshots())
	return skip
}

func pendingCount(t *testing.T, a *app.App) int {
	t.Helper()
	got, err := a.GetNewScreenshotCount()
	mustNoErr(t, err)
	return got.Count
}

func TestClaims_ProfileSkipsScreenshotsAnotherProfileParsed(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, "a.png", []byte("match-one"))
	writeFile(t, shared, "b.png", []byte("match-two"))
	if skip := parseCapturingSkip(t, a); skip["a.png"] || skip["b.png"] {
		t.Fatalf("main must parse unclaimed files; skip=%v", skip)
	}

	switchTo(t, a, "alt")
	if got := pendingCount(t, a); got != 0 {
		t.Errorf("alt pending = %d, want 0: main already owns every file", got)
	}
	if skip := parseCapturingSkip(t, a); !skip["a.png"] || !skip["b.png"] {
		t.Errorf("alt must skip main's screenshots; skip=%v", skip)
	}
}

// Ownership follows the bytes, not the name: a renamed copy of a claimed
// screenshot is still that screenshot.
func TestClaims_RenamedCopyOfClaimedScreenshotIsSkipped(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, "a.png", []byte("match-one"))
	parseCapturingSkip(t, a)

	switchTo(t, a, "alt")
	mustNoErr(t, os.Rename(filepath.Join(shared, "a.png"), filepath.Join(shared, "renamed.png")))
	if skip := parseCapturingSkip(t, a); !skip["renamed.png"] {
		t.Errorf("a renamed copy of main's screenshot must be skipped; skip=%v", skip)
	}
}

// New screenshots go to whichever profile parses them first, and are then off
// limits to the others in both directions.
func TestClaims_NewScreenshotBelongsToTheProfileThatParsedIt(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, "a.png", []byte("match-one"))
	parseCapturingSkip(t, a)

	switchTo(t, a, "alt")
	writeFile(t, shared, "new.png", []byte("match-two"))
	if got := pendingCount(t, a); got != 1 {
		t.Fatalf("alt pending = %d, want 1 (the unclaimed new file)", got)
	}
	if skip := parseCapturingSkip(t, a); skip["new.png"] {
		t.Fatalf("alt must parse the unclaimed new file; skip=%v", skip)
	}

	// The stubbed OCR stores no rows, so main's own a.png stays pending; what
	// matters is that alt's new.png is not main's to parse.
	switchTo(t, a, "main")
	if skip := parseCapturingSkip(t, a); !skip["new.png"] || skip["a.png"] {
		t.Errorf("main must skip alt's new.png and keep its own a.png; skip=%v", skip)
	}
}

// Re-parse All rewrites a profile's own history; it must not pull in files
// another profile owns.
func TestClaims_ReparseAllStillSkipsOtherProfilesScreenshots(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, "a.png", []byte("match-one"))
	parseCapturingSkip(t, a)

	switchTo(t, a, "alt")
	var skip map[string]bool
	stubParseCapturingSkip(t, &skip)
	mustNoErr(t, a.ReParseAll())
	if !skip["a.png"] {
		t.Errorf("Re-parse All in alt must still skip main's screenshot; skip=%v", skip)
	}
}
