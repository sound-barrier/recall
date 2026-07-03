package db_test

import (
	"path/filepath"
	"testing"

	"recall/pkg/db"
)

// The DB health surface (Settings → Advanced): integrity_check +
// size/freelist stats, plus the optimize / vacuum maintenance ops.

func newFileStore(t *testing.T) (*db.SQLStore, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "recall.db")
	store, err := db.NewSQLStore(path)
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store, path
}

func TestSQLStore_Health_ReportsIntegrityAndSizes(t *testing.T) {
	store, _ := newFileStore(t)

	h, err := store.Health()
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if h.Integrity != "ok" {
		t.Errorf("Integrity = %q, want ok", h.Integrity)
	}
	if h.SizeBytes <= 0 {
		t.Errorf("SizeBytes = %d, want > 0 (schema applied)", h.SizeBytes)
	}
	if h.PageCount <= 0 {
		t.Errorf("PageCount = %d, want > 0", h.PageCount)
	}
	if h.CheckedAt == "" {
		t.Error("CheckedAt empty — the UI needs a timestamp to render")
	}
}

func TestSQLStore_Optimize_RunsClean(t *testing.T) {
	store, _ := newFileStore(t)
	if err := store.Optimize(); err != nil {
		t.Fatalf("Optimize: %v", err)
	}
}

func TestSQLStore_Vacuum_ReclaimsFreelistPages(t *testing.T) {
	store, _ := newFileStore(t)

	// Write then delete rows so the freelist is non-trivial.
	for i := range 200 {
		if err := store.UpsertSummary(db.SummaryRow{
			Filename: filenameFor(i),
			MatchKey: "match-2026-01-01T00-00-00",
			Map:      "rialto",
			Hero:     "lucio",
			MapRaw:   string(make([]byte, 4096)),
		}); err != nil {
			t.Fatalf("seed row %d: %v", i, err)
		}
	}
	if err := store.Clear(); err != nil {
		t.Fatalf("Clear: %v", err)
	}

	if err := store.Vacuum(); err != nil {
		t.Fatalf("Vacuum: %v", err)
	}
	h, err := store.Health()
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if h.FreelistPages != 0 {
		t.Errorf("FreelistPages = %d after VACUUM, want 0", h.FreelistPages)
	}
}

func filenameFor(i int) string {
	return "seed-" + string(rune('a'+i/26)) + string(rune('a'+i%26)) + ".png"
}
