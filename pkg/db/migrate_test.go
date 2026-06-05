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
	if v != 4 {
		t.Errorf("schema_version = %d, want 4", v)
	}
	// Baseline + 0002 + 0003 + 0004 created every expected table.
	for _, tbl := range []string{
		"summary_screenshots", "scoreboard_screenshots", "personal_screenshots",
		"rank_screenshots", "unknown_screenshots", "match_annotations",
		"match_annotation_members", "match_annotation_tags", "hidden_matches",
		"ambiguous_candidates", "screenshots_dirs", "match_reviews",
		"match_queue", "match_play_mode",
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
	if v != 4 {
		t.Errorf("schema_version after re-apply = %d, want 4", v)
	}
}

// TestMigrationsRoundTrip — for every shipped migration, after
// applying 1..N, running revertOne(N) leaves the DB at version
// N-1 AND the structure matches what's produced by applying 1..N-1
// fresh. Re-applying N puts the DB back into the same structure
// as applying 1..N fresh. A bad `.down.sql` fails CI here instead
// of failing first in production rollback.
func TestMigrationsRoundTrip(t *testing.T) {
	migs, err := loadMigrations()
	if err != nil {
		t.Fatalf("loadMigrations: %v", err)
	}
	if len(migs) == 0 {
		t.Skip("no migrations to round-trip")
	}

	// Run the round-trip against EACH migration past the baseline.
	// Reverting 0001 (the baseline) would leave the DB empty — not
	// a meaningful round-trip, and would require the baseline's
	// .down to be a full schema-drop which is over-scoped for this
	// gate.
	for i, m := range migs {
		if i == 0 {
			continue
		}
		t.Run(m.name, func(t *testing.T) {
			// Snapshot: apply 1..N-1 fresh on a separate DB.
			pristine := openMem(t)
			if err := ensureSchemaVersionTable(pristine); err != nil {
				t.Fatalf("pristine schema_version: %v", err)
			}
			for _, prior := range migs[:i] {
				if err := applyOne(pristine, prior); err != nil {
					t.Fatalf("apply pristine %s: %v", prior.name, err)
				}
			}
			priorTables := captureSchema(t, pristine)

			// Live DB: apply 1..N, then revert N back to N-1.
			live := openMem(t)
			if err := ensureSchemaVersionTable(live); err != nil {
				t.Fatalf("live schema_version: %v", err)
			}
			for _, all := range migs[:i+1] {
				if err := applyOne(live, all); err != nil {
					t.Fatalf("apply live %s: %v", all.name, err)
				}
			}
			if err := revertOne(live, m); err != nil {
				t.Fatalf("revertOne %s: %v", m.name, err)
			}

			// schema_version must match what pristine has.
			v, err := schemaVersion(live)
			if err != nil {
				t.Fatalf("schemaVersion: %v", err)
			}
			if want := migs[i-1].version; v != want {
				t.Errorf("after revert, schema_version = %d, want %d", v, want)
			}

			// Table layouts (name + cols) must match pristine. We
			// compare the SQL of each table since `sqlite_master` is
			// the canonical artefact this migration framework writes.
			liveTables := captureSchema(t, live)
			if !schemasEqual(priorTables, liveTables) {
				t.Errorf("after revert, schema differs from pristine 1..%d:\npristine: %v\nlive:     %v",
					migs[i-1].version, priorTables, liveTables)
			}

			// Re-applying N puts the DB back into the same shape
			// as applying 1..N fresh.
			if err := applyOne(live, m); err != nil {
				t.Fatalf("re-apply %s: %v", m.name, err)
			}
			fullFresh := openMem(t)
			if err := ensureSchemaVersionTable(fullFresh); err != nil {
				t.Fatalf("full-fresh schema_version: %v", err)
			}
			for _, all := range migs[:i+1] {
				if err := applyOne(fullFresh, all); err != nil {
					t.Fatalf("apply full-fresh %s: %v", all.name, err)
				}
			}
			if !schemasEqual(captureSchema(t, fullFresh), captureSchema(t, live)) {
				t.Errorf("after re-apply %s, schema doesn't match a fresh 1..%d apply", m.name, m.version)
			}
		})
	}
}

// captureSchema returns a map of table-name → CREATE-statement
// taken from `sqlite_master`. It's the canonical structural
// fingerprint the round-trip test compares.
func captureSchema(t *testing.T, d *sql.DB) map[string]string {
	t.Helper()
	out := map[string]string{}
	rows, err := d.Query(`SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_version'`)
	if err != nil {
		t.Fatalf("sqlite_master query: %v", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var name, ddl string
		if err := rows.Scan(&name, &ddl); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out[name] = ddl
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows.Err: %v", err)
	}
	return out
}

func schemasEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
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
	if v != 4 {
		t.Errorf("schema_version = %d, want 4 (legacy DB adopts current version)", v)
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
