package app_test

import (
	"context"
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
)

func newRealApp(t *testing.T) *app.App {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(context.Background())
	t.Cleanup(func() {
		if s := app.AppStore(a); s != nil {
			_ = s.Close()
		}
	})
	return a
}

func seedSummary(t *testing.T, a *app.App, filename, key string) {
	t.Helper()
	if err := app.AppStore(a).UpsertSummary(db.SummaryRow{
		Filename:   filename,
		MatchKey:   key,
		Map:        "rialto",
		Result:     "victory",
		Date:       "2026-05-10",
		FinishedAt: "21:29",
	}); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}
}

func TestApp_BackupDatabase_ProducesValidSnapshot(t *testing.T) {
	a := newRealApp(t)
	seedSummary(t, a, "s.png", "match-2026-05-10T21-29-28")

	data, err := a.BackupDatabase()
	if err != nil {
		t.Fatalf("BackupDatabase: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("backup produced no bytes")
	}
}

func TestApp_RestoreDatabase_ReplacesAndReopens(t *testing.T) {
	a := newRealApp(t)
	seedSummary(t, a, "a.png", "match-A")

	snapshot, err := a.BackupDatabase()
	if err != nil {
		t.Fatalf("backup: %v", err)
	}

	// Diverge the live DB after the snapshot was taken.
	if err := app.AppStore(a).Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	seedSummary(t, a, "b.png", "match-B")

	if err := a.RestoreDatabase(snapshot); err != nil {
		t.Fatalf("RestoreDatabase: %v", err)
	}

	snap, err := app.AppStore(a).LoadAll()
	if err != nil {
		t.Fatalf("LoadAll after restore: %v", err)
	}
	if len(snap.Summaries) != 1 || snap.Summaries[0].MatchKey != "match-A" {
		t.Fatalf("after restore summaries = %+v, want only match-A", snap.Summaries)
	}
}

func TestApp_RestoreDatabase_RejectsGarbageLeavingDBIntact(t *testing.T) {
	a := newRealApp(t)
	seedSummary(t, a, "a.png", "match-A")

	err := a.RestoreDatabase([]byte("this is not a sqlite database"))
	if !errors.Is(err, app.ErrRestoreInvalid) {
		t.Fatalf("err = %v, want ErrRestoreInvalid", err)
	}

	snap, err := app.AppStore(a).LoadAll()
	if err != nil {
		t.Fatalf("LoadAll after rejected restore: %v", err)
	}
	if len(snap.Summaries) != 1 || snap.Summaries[0].MatchKey != "match-A" {
		t.Fatalf("rejected restore must not touch the live DB; summaries = %+v", snap.Summaries)
	}
}
