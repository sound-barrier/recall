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

// Pre-1.0 the framework ships with zero migration files. Confirm
// the framework is a strict no-op in that state: no `schema_version`
// table, no side effects, no errors. Once the first migration file
// lands this test gets a sibling that asserts the new behaviour.
func TestApplyMigrations_NoMigrationsIsNoOp(t *testing.T) {
	d := openMem(t)
	if err := applyMigrations(d); err != nil {
		t.Fatalf("applyMigrations: %v", err)
	}
	row := d.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_version'`)
	var n int
	if err := row.Scan(&n); err != nil {
		t.Fatalf("probe schema_version: %v", err)
	}
	if n != 0 {
		t.Errorf("schema_version table created with zero migrations; want absent")
	}
}

func TestLoadMigrations_EmptyDirReturnsEmpty(t *testing.T) {
	migs, err := loadMigrations()
	if err != nil {
		t.Fatalf("loadMigrations: %v", err)
	}
	if len(migs) != 0 {
		t.Errorf("got %d migrations, want 0 (none shipped pre-1.0)", len(migs))
	}
}

func TestSplitVersion(t *testing.T) {
	cases := []struct {
		key     string
		wantNum int
		wantOK  bool
	}{
		{"0001_init", 1, true},
		{"0042_add_index", 42, true},
		{"missing_prefix", 0, false},
		{"_no_version", 0, false},
		{"abc_not_numeric", 0, false},
	}
	for _, c := range cases {
		t.Run(c.key, func(t *testing.T) {
			n, _, err := splitVersion(c.key)
			if c.wantOK && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if !c.wantOK && err == nil {
				t.Errorf("expected error, got nil")
			}
			if c.wantOK && n != c.wantNum {
				t.Errorf("got version %d, want %d", n, c.wantNum)
			}
		})
	}
}

// applyOne + revertOne are framework primitives that have no
// shipped migrations to exercise yet. This test feeds them a
// synthetic in-memory migration so a bad apply / revert path fails
// here before the first real migration lands.
func TestApplyOneAndRevertOne_RoundTripsSyntheticMigration(t *testing.T) {
	d := openMem(t)
	if err := ensureSchemaVersionTable(d); err != nil {
		t.Fatalf("ensureSchemaVersionTable: %v", err)
	}
	m := migration{
		version: 9001,
		name:    "synthetic",
		up:      `CREATE TABLE synthetic (id INTEGER PRIMARY KEY)`,
		down:    `DROP TABLE synthetic`,
	}
	if err := applyOne(d, m); err != nil {
		t.Fatalf("applyOne: %v", err)
	}
	v, err := schemaVersion(d)
	if err != nil {
		t.Fatalf("schemaVersion: %v", err)
	}
	if v != 9001 {
		t.Errorf("schema_version = %d, want 9001", v)
	}
	if err := revertOne(d, m); err != nil {
		t.Fatalf("revertOne: %v", err)
	}
	v, _ = schemaVersion(d)
	if v != 0 {
		t.Errorf("schema_version after revert = %d, want 0", v)
	}
	row := d.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='synthetic'`)
	var n int
	if err := row.Scan(&n); err != nil {
		t.Fatalf("probe synthetic: %v", err)
	}
	if n != 0 {
		t.Errorf("synthetic table still exists after revert")
	}
}
