package db

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func openMem(t *testing.T) *sql.DB {
	t.Helper()
	d, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if _, err := d.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		t.Fatalf("fk pragma: %v", err)
	}
	return d
}

func TestApplyMigrations_FreshDB_AppliesBaselineAndRecordsVersion(t *testing.T) {
	d := openMem(t)
	if err := applyMigrations(d); err != nil {
		t.Fatalf("applyMigrations: %v", err)
	}
	v, err := schemaVersion(d)
	if err != nil {
		t.Fatalf("schemaVersion: %v", err)
	}
	if v != 2 {
		t.Errorf("schema_version = %d, want 2", v)
	}
	// Baseline + 0002 created every expected table.
	for _, tbl := range []string{
		"summary_screenshots", "scoreboard_screenshots", "personal_screenshots",
		"rank_screenshots", "unknown_screenshots", "match_annotations",
		"match_annotation_members", "match_annotation_tags", "hidden_matches",
		"ambiguous_candidates", "screenshots_dirs", "match_reviews",
	} {
		var name string
		row := d.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, tbl)
		if err := row.Scan(&name); err != nil {
			t.Errorf("expected table %q after baseline: %v", tbl, err)
		}
	}
}

func TestApplyMigrations_Idempotent(t *testing.T) {
	d := openMem(t)
	if err := applyMigrations(d); err != nil {
		t.Fatalf("first apply: %v", err)
	}
	if err := applyMigrations(d); err != nil {
		t.Fatalf("second apply: %v", err)
	}
	v, _ := schemaVersion(d)
	if v != 2 {
		t.Errorf("schema_version after re-apply = %d, want 2", v)
	}
}

func TestApplyMigrations_PreExistingTablesNoSchemaVersion_AdoptsCurrentVersion(t *testing.T) {
	// Simulates an existing user's DB: parent tables already created by
	// the legacy idempotent CREATE-TABLE-IF-NOT-EXISTS sweep, but no
	// schema_version row. The framework must adopt the current version
	// without re-running the baseline (which would error on duplicate
	// CHECK constraints if SQLite ever changed CREATE IF NOT EXISTS
	// semantics, and would in any case double-apply data migrations).
	d := openMem(t)
	if _, err := d.Exec(`CREATE TABLE summary_screenshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filename TEXT NOT NULL UNIQUE,
		match_key TEXT NOT NULL
	)`); err != nil {
		t.Fatalf("seed legacy table: %v", err)
	}
	if err := applyMigrations(d); err != nil {
		t.Fatalf("applyMigrations on legacy DB: %v", err)
	}
	v, _ := schemaVersion(d)
	if v != 2 {
		t.Errorf("schema_version = %d, want 2 (legacy DB adopts current version)", v)
	}
}

func TestAllMigrationsHavePairedDown(t *testing.T) {
	ups, downs, err := listMigrationFiles()
	if err != nil {
		t.Fatalf("listMigrationFiles: %v", err)
	}
	if len(ups) == 0 {
		t.Fatal("no up migrations found")
	}
	for _, up := range ups {
		if _, ok := downs[up]; !ok {
			t.Errorf("missing .down.sql pair for %s", up)
		}
	}
}
