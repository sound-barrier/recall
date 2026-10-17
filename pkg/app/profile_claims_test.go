package app_test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/parser"
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

// An install that parsed screenshots before the claims ledger existed must
// not let a second profile re-import them: the first start with the ledger
// seeds it from every profile's existing screenshots.
func TestClaims_FirstStartSeedsFromExistingProfiles(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, "a.png", []byte("match-one"))
	parseCapturingSkip(t, a)

	// Back to the pre-ledger world, then a fresh launch.
	base := os.Getenv("RECALL_DATA_DIR")
	for _, f := range []string{"claims.db", "claims.db-wal", "claims.db-shm"} {
		_ = os.Remove(filepath.Join(base, f))
	}
	b := app.New()
	b.Startup(context.Background())
	mustNoErr(t, b.StartupError())

	switchTo(t, b, "alt")
	if skip := parseCapturingSkip(t, b); !skip["a.png"] {
		t.Errorf("alt must skip main's pre-ledger screenshot after seeding; skip=%v", skip)
	}
}

// Screenshots parsed before the content-hash registry existed have a stored
// row but no registry entry. Seeding must still claim them, hashing them from
// the profile's folder.
func TestClaims_SeedingClaimsParsedScreenshotsMissingFromTheRegistry(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	const legacy = "Overwatch Screenshot 2026.01.05 - 21.30.00.00.png"
	writeFile(t, shared, legacy, []byte("legacy-match"))
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, legacy, &parser.MatchResult{Result: "victory", Map: "rialto", Hero: "lucio"}, nil)
		return nil
	})
	app.TessStatus(a).Found = true
	mustNoErr(t, a.ParseScreenshots())

	// Recreate the legacy install: the row stays, the registry entry and the
	// ledger go.
	base := os.Getenv("RECALL_DATA_DIR")
	mainDB, err := sql.Open("sqlite", filepath.Join(base, "profiles", "main", "db", "recall.db"))
	mustNoErr(t, err)
	_, err = mainDB.ExecContext(context.Background(), `DELETE FROM ingested_files`)
	mustNoErr(t, err)
	mustNoErr(t, mainDB.Close())
	for _, f := range []string{"claims.db", "claims.db-wal", "claims.db-shm"} {
		_ = os.Remove(filepath.Join(base, f))
	}

	b := app.New()
	b.Startup(context.Background())
	mustNoErr(t, b.StartupError())
	switchTo(t, b, "alt")
	if skip := parseCapturingSkip(t, b); !skip[legacy] {
		t.Errorf("alt must skip main's pre-registry screenshot; skip=%v", skip)
	}
}

// parseOneMatch makes the active profile parse filename into a stored match
// and returns that match's key.
func parseOneMatch(t *testing.T, a *app.App, filename string) string {
	t.Helper()
	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, filename, &parser.MatchResult{Result: "victory", Map: "rialto", Hero: "lucio"}, nil)
		return nil
	})
	app.TessStatus(a).Found = true
	mustNoErr(t, a.ParseScreenshots())
	records, err := a.GetMatchResults()
	mustNoErr(t, err)
	if len(records) != 1 {
		t.Fatalf("want one stored match, got %d", len(records))
	}
	return records[0].MatchKey
}

const shotA = "Overwatch Screenshot 2026.01.05 - 21.30.00.00.png"

// Deleting the match in the profile that owns its screenshots frees them.
func TestClaims_HardDeleteReleasesTheMatchsScreenshots(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, shotA, []byte("match-one"))
	key := parseOneMatch(t, a, shotA)
	mustNoErr(t, a.HardDeleteMatch(key))

	switchTo(t, a, "alt")
	if skip := parseCapturingSkip(t, a); skip[shotA] {
		t.Errorf("a deleted match's screenshot must be free for alt; skip=%v", skip)
	}
}

// Hiding is a soft delete: the rows stay, so the claim stays.
func TestClaims_HideKeepsTheClaim(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, shotA, []byte("match-one"))
	key := parseOneMatch(t, a, shotA)
	mustNoErr(t, a.HideMatch(key))

	switchTo(t, a, "alt")
	if skip := parseCapturingSkip(t, a); !skip[shotA] {
		t.Errorf("a hidden match still owns its screenshot; skip=%v", skip)
	}
}

// Dismissing a screenshot in the owning profile frees it for the others.
func TestClaims_IgnoreReleasesTheScreenshot(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, "a.png", []byte("match-one"))
	parseCapturingSkip(t, a)
	mustNoErr(t, a.IgnoreScreenshot("a.png"))

	switchTo(t, a, "alt")
	if skip := parseCapturingSkip(t, a); skip["a.png"] {
		t.Errorf("a dismissed screenshot must be free for alt; skip=%v", skip)
	}
}

// Deleting a profile keeps its claims: its screenshots stay off limits.
func TestClaims_DeletedProfileKeepsItsClaims(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	mustNoErr(t, a.CreateProfile("temp"))
	mustNoErr(t, a.SetScreenshotsDir(shared))
	writeFile(t, shared, "a.png", []byte("match-one"))
	parseCapturingSkip(t, a)
	switchTo(t, a, "main")
	mustNoErr(t, a.DeleteProfile("temp"))

	if skip := parseCapturingSkip(t, a); !skip["a.png"] {
		t.Errorf("a deleted profile's screenshot must stay claimed; skip=%v", skip)
	}
}

// Renaming a profile carries its claims and its own screenshots stay its own.
func TestClaims_RenamedProfileKeepsItsClaims(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, "a.png", []byte("match-one"))
	parseCapturingSkip(t, a)
	mustNoErr(t, a.RenameProfile("main", "ranked"))

	if skip := parseCapturingSkip(t, a); skip["a.png"] {
		t.Errorf("the renamed profile must still own a.png; skip=%v", skip)
	}
	switchTo(t, a, "alt")
	if skip := parseCapturingSkip(t, a); !skip["a.png"] {
		t.Errorf("alt must still skip the renamed profile's a.png; skip=%v", skip)
	}
}

// Moving a match hands its screenshots to the target for good: the source,
// still pointed at the same folder, must not import them back.
func TestClaims_MoveTransfersTheScreenshotsToTheTarget(t *testing.T) {
	a, shared := newSharedFolderApp(t)
	writeFile(t, shared, shotA, []byte("match-one"))
	key := parseOneMatch(t, a, shotA)
	mustNoErr(t, a.MoveMatches([]string{key}, "alt"))

	if skip := parseCapturingSkip(t, a); !skip[shotA] {
		t.Errorf("main must not re-import the screenshot it moved to alt; skip=%v", skip)
	}
	// Re-parse All re-reads a profile's own screenshots and skips only
	// foreign ones, so it tells "alt owns it" apart from "already parsed".
	switchTo(t, a, "alt")
	var skip map[string]bool
	stubParseCapturingSkip(t, &skip)
	mustNoErr(t, a.ReParseAll())
	if skip[shotA] {
		t.Errorf("alt owns the moved screenshot and must re-parse it; skip=%v", skip)
	}
}
