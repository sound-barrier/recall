package db_test

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"

	"recall/pkg/db"
)

// seedRealDB creates a file-backed SQLStore at a temp path, writes one
// summary row, closes it, and returns the path.
func seedRealDB(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "src.db")
	store, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	if err := store.UpsertSummary(db.SummaryRow{
		Filename:   "s.png",
		MatchKey:   "match-2026-05-10T21-29-28",
		Map:        "rialto",
		Result:     "victory",
		Date:       "2026-05-10",
		FinishedAt: "21:29",
	}); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	return path
}

func TestBackupTo_RoundTrip(t *testing.T) {
	src := seedRealDB(t)
	dest := filepath.Join(t.TempDir(), "snapshot.db")

	if err := db.BackupTo(src, dest); err != nil {
		t.Fatalf("BackupTo: %v", err)
	}
	if _, err := os.Stat(dest); err != nil {
		t.Fatalf("snapshot not written: %v", err)
	}

	// The snapshot must carry the seeded row.
	restored, err := db.NewSQLStore(dest)
	if err != nil {
		t.Fatalf("open snapshot: %v", err)
	}
	defer func() { _ = restored.Close() }()
	snap, err := restored.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(snap.Summaries) != 1 || snap.Summaries[0].MatchKey != "match-2026-05-10T21-29-28" {
		t.Fatalf("snapshot summaries = %+v, want the seeded row", snap.Summaries)
	}
}

func TestValidateBackupFile_AcceptsRealDB(t *testing.T) {
	src := seedRealDB(t)
	if err := db.ValidateBackupFile(src); err != nil {
		t.Fatalf("ValidateBackupFile on a real Recall DB: %v", err)
	}
}

func TestValidateBackupFile_RejectsGarbage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "garbage.db")
	if err := os.WriteFile(path, []byte("this is not a sqlite database at all"), 0o600); err != nil {
		t.Fatalf("write garbage: %v", err)
	}
	if err := db.ValidateBackupFile(path); err == nil {
		t.Fatal("ValidateBackupFile must reject a non-SQLite file")
	}
}

func TestValidateBackupFile_RejectsWrongSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "other.db")
	conn, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := conn.Exec(`CREATE TABLE unrelated (x INTEGER)`); err != nil {
		t.Fatalf("create unrelated table: %v", err)
	}
	if err := conn.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if err := db.ValidateBackupFile(path); err == nil {
		t.Fatal("ValidateBackupFile must reject a SQLite DB without Recall's schema")
	}
}
