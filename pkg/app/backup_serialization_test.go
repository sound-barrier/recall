package app_test

import (
	"errors"
	"path/filepath"
	"testing"

	"recall/pkg/app"
)

// Restore swaps the database file out from under the app, so it has to lose
// the race against the OCR write path deliberately rather than by luck. The
// ordering is load-bearing: the parse claim is taken BEFORE the store is torn
// down, so a refusal leaves the app fully serving instead of storeless.
func TestApp_RestoreDatabase_RefusesMidParseWithoutTearingDownTheStore(t *testing.T) {
	a := newRealApp(t)
	seedSummary(t, a, "s.png", "match-2026-05-10T21-29-28")
	snapshot, err := a.BackupDatabase()
	mustNoErr(t, err)

	if _, claimed := app.ClaimParse(a, false); !claimed {
		t.Fatal("could not claim the parse slot to simulate a run in flight")
	}
	t.Cleanup(func() { app.EndParse(a) })

	if err := a.RestoreDatabase(snapshot); !errors.Is(err, app.ErrParseInFlight) {
		t.Fatalf("RestoreDatabase = %v, want ErrParseInFlight", err)
	}

	if app.Store(a) == nil {
		t.Fatal("the refused restore still tore the store down")
	}
	recs, err := a.GetMatchResults()
	mustNoErr(t, err)
	if len(recs) != 1 {
		t.Errorf("read %d matches after the refusal, want the 1 seeded — the live DB was disturbed", len(recs))
	}
	assertNoStagedRestoreFiles(t, a)
}

// The candidate is staged next to the live DB before the claim is attempted, so
// the refusal path owns cleaning it up — otherwise every blocked restore leaves
// a full-size copy of the database behind.
func assertNoStagedRestoreFiles(t *testing.T, a *app.App) {
	t.Helper()
	dbDir := filepath.Dir(a.GetDataLocation().DatabasePath)
	leftovers, err := filepath.Glob(filepath.Join(dbDir, "recall-restore-*.db"))
	mustNoErr(t, err)
	if len(leftovers) != 0 {
		t.Errorf("staged restore files left behind: %v", leftovers)
	}
}
