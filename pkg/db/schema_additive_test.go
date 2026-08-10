package db_test

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"

	"recall/pkg/db"
)

// Simulates upgrading a DB created before played_at_utc existed: a table
// without the column gets it added (idempotently), so inserts that reference
// it succeed instead of 500ing — the graceful-upgrade path that lets Re-parse
// All backfill without wiping history.
func TestEnsureAdditiveColumns_AddsMissingColumnIdempotently(t *testing.T) {
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = d.Close() }()

	// An "old" summary_screenshots without played_at_utc.
	if _, err := d.Exec(`CREATE TABLE summary_screenshots (
		id INTEGER PRIMARY KEY, filename TEXT, date TEXT, finished_at TEXT)`); err != nil {
		t.Fatalf("create old table: %v", err)
	}
	if _, err := d.Exec(`CREATE TABLE user_match_data (match_key TEXT PRIMARY KEY)`); err != nil {
		t.Fatalf("create old user_match_data: %v", err)
	}

	if has, err := db.ColumnExists(d, "summary_screenshots", "played_at_utc"); err != nil || has {
		t.Fatalf("precondition: column should be absent (has=%v err=%v)", has, err)
	}

	if err := db.EnsureAdditiveColumns(d); err != nil {
		t.Fatalf("ensureAdditiveColumns: %v", err)
	}
	for _, tbl := range []string{"summary_screenshots", "user_match_data"} {
		if has, err := db.ColumnExists(d, tbl, "played_at_utc"); err != nil || !has {
			t.Errorf("%s.played_at_utc missing after ensure (has=%v err=%v)", tbl, has, err)
		}
	}
	// An insert referencing the new column now works.
	if _, err := d.Exec(`INSERT INTO summary_screenshots (filename, played_at_utc) VALUES ('a.png', '2026-01-15T19:00:00Z')`); err != nil {
		t.Errorf("insert into added column: %v", err)
	}

	// Idempotent: a second run is a no-op, not a "duplicate column" error.
	if err := db.EnsureAdditiveColumns(d); err != nil {
		t.Errorf("second ensure should be a no-op: %v", err)
	}
}
