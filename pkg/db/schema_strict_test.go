package db_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"recall/pkg/db"
)

// Every application table is declared STRICT so SQLite enforces the
// declared column datatype on write instead of silently coercing via
// affinity — a typed value that can't losslessly convert raises
// SQLITE_CONSTRAINT_DATATYPE rather than persisting garbage. The
// assertion reads PRAGMA table_list's `strict` flag for every table in
// the main schema (skipping SQLite's own bookkeeping tables) so a new
// CREATE TABLE that forgets the STRICT keyword fails this test.
func TestSchema_EveryTableIsStrict(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recall.db")
	store, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	probe, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("probe open: %v", err)
	}
	t.Cleanup(func() { _ = probe.Close() })

	rows, err := probe.Query(
		`SELECT name, "strict" FROM pragma_table_list
		 WHERE schema = 'main' AND type = 'table' AND name NOT LIKE 'sqlite_%'
		 ORDER BY name`,
	)
	if err != nil {
		t.Fatalf("query table_list: %v", err)
	}
	defer func() { _ = rows.Close() }()

	seen := 0
	for rows.Next() {
		var name string
		var strict int
		if err := rows.Scan(&name, &strict); err != nil {
			t.Fatalf("scan: %v", err)
		}
		seen++
		if strict != 1 {
			t.Errorf("table %q is not STRICT (strict=%d)", name, strict)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows: %v", err)
	}

	// Guard against a vacuous pass if the query silently matches nothing.
	if seen < 20 {
		t.Fatalf("only %d application tables inspected; expected the full schema (>=20)", seen)
	}
}
