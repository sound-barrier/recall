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
	mustNoErr(t, err)
	defer func() { _ = d.Close() }()

	// An "old" summary_screenshots without played_at_utc.
	_, err = d.Exec(`CREATE TABLE summary_screenshots (
		id INTEGER PRIMARY KEY, filename TEXT, date TEXT, finished_at TEXT)`)
	mustNoErr(t, err)
	_, err = d.Exec(`CREATE TABLE user_match_data (match_key TEXT PRIMARY KEY)`)
	mustNoErr(t, err)
	// Every table the registry names must exist here. ensureAdditiveColumns
	// deliberately does NOT skip a missing table — that would turn a typo'd
	// table name into a permanent silent no-op — so this fixture has to keep
	// pace with additiveColumns.
	_, err = d.Exec(`CREATE TABLE rank_screenshots (
		id INTEGER PRIMARY KEY, filename TEXT, rank TEXT)`)
	mustNoErr(t, err)
	// The remaining pipeline parents, named by the parser_generation entries.
	for _, tbl := range []string{"teams_screenshots", "personal_screenshots", "unknown_screenshots"} {
		_, err = d.Exec(`CREATE TABLE ` + tbl + ` (id INTEGER PRIMARY KEY, filename TEXT)`)
		mustNoErr(t, err)
	}
	// An "old" match_annotations without exclusion_reason.
	_, err = d.Exec(`CREATE TABLE match_annotations (
		match_key TEXT PRIMARY KEY, note TEXT, replay_code TEXT)`)
	mustNoErr(t, err)
	// An "old" coach_players without kind, for the team-kind entry.
	_, err = d.Exec(`CREATE TABLE coach_players (
		id INTEGER PRIMARY KEY, player_id TEXT UNIQUE, handle TEXT NOT NULL)`)
	mustNoErr(t, err)

	if has, err := db.ColumnExists(d, "summary_screenshots", "played_at_utc"); err != nil || has {
		t.Fatalf("precondition: column should be absent (has=%v err=%v)", has, err)
	}

	if err := db.EnsureAdditiveColumns(d); err != nil {
		t.Fatalf("ensureAdditiveColumns: %v", err)
	}
	for _, tbl := range []string{"summary_screenshots", "user_match_data"} {
		assertHasColumn(t, d, tbl, "played_at_utc")
	}
	// An insert referencing the new column now works.
	if _, err := d.Exec(`INSERT INTO summary_screenshots (filename, played_at_utc) VALUES ('a.png', '2026-01-15T19:00:00Z')`); err != nil {
		t.Errorf("insert into added column: %v", err)
	}

	// The registry is walked whole, not just its first entry: a second table's
	// column has to arrive too, or a later addition could silently do nothing.
	assertHasColumn(t, d, "rank_screenshots", "rank_percentile")

	// Idempotent: a second run is a no-op, not a "duplicate column" error.
	if err := db.EnsureAdditiveColumns(d); err != nil {
		t.Errorf("second ensure should be a no-op: %v", err)
	}
}

// assertHasColumn fails unless table.column exists.
func assertHasColumn(t *testing.T, d *sql.DB, table, column string) {
	t.Helper()
	has, err := db.ColumnExists(d, table, column)
	if err != nil {
		t.Errorf("%s.%s: %v", table, column, err)
		return
	}
	if !has {
		t.Errorf("%s.%s missing after ensureAdditiveColumns", table, column)
	}
}
