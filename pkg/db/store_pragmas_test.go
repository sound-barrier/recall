package db_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"recall/pkg/db"
)

// File-backed stores run in WAL journal mode (ledger section 10): the
// parse loop is write-heavy while the UI reads concurrently, and WAL
// lets readers proceed against the last committed snapshot instead of
// queuing behind the writer's lock (busy_timeout already bounds the
// wait; WAL removes most of it). journal_mode is persistent in the
// database file, so the assertion reads it back through an INDEPENDENT
// connection — proving the mode survives for any later opener, not
// just the configuring one.
func TestNewSQLStore_FileDBRunsInWALMode(t *testing.T) {
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

	var mode string
	if err := probe.QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatalf("read journal_mode: %v", err)
	}
	if mode != "wal" {
		t.Fatalf("journal_mode = %q, want wal", mode)
	}
}
