package db_test

import (
	"testing"

	"recall/pkg/db"
)

func TestSQLStore_LookupScreenshotsDir(t *testing.T) {
	s := openMemory(t)

	// Sentinel id resolves to empty path (the handler then falls back to
	// the configured screenshots dir) — no DB hit, no error.
	if path, err := s.LookupScreenshotsDir(db.SentinelScreenshotsDirID); err != nil || path != "" {
		t.Errorf("sentinel: got (%q, %v), want (\"\", nil)", path, err)
	}

	// Unknown id → empty path, no error (sql.ErrNoRows is swallowed).
	if path, err := s.LookupScreenshotsDir(99999); err != nil || path != "" {
		t.Errorf("unknown id: got (%q, %v), want (\"\", nil)", path, err)
	}

	// A real registered dir resolves to its on-disk path.
	const dir = "/Users/jacob/Documents/Overwatch/Screenshots"
	id, err := s.EnsureScreenshotsDir(dir)
	if err != nil {
		t.Fatalf("EnsureScreenshotsDir: %v", err)
	}
	if path, err := s.LookupScreenshotsDir(id); err != nil || path != dir {
		t.Errorf("registered dir: got (%q, %v), want (%q, nil)", path, err, dir)
	}
}

func TestSQLStore_PruneScreenshotsDirs(t *testing.T) {
	s := openMemory(t)

	idA, err := s.EnsureScreenshotsDir("/watch/folder-a")
	if err != nil {
		t.Fatalf("EnsureScreenshotsDir A: %v", err)
	}
	idB, err := s.EnsureScreenshotsDir("/watch/folder-b")
	if err != nil {
		t.Fatalf("EnsureScreenshotsDir B: %v", err)
	}
	if idA == idB {
		t.Fatal("expected distinct dir ids")
	}

	// A screenshot references dir A; dir B is orphaned (nothing references it).
	if err := s.UpsertRank(db.RankRow{Filename: "r.png", MatchKey: "k1", ScreenshotsDirID: idA}); err != nil {
		t.Fatalf("UpsertRank: %v", err)
	}

	n, err := s.PruneScreenshotsDirs()
	if err != nil {
		t.Fatalf("PruneScreenshotsDirs: %v", err)
	}
	if n != 1 {
		t.Errorf("pruned %d, want 1 (only orphaned dir B)", n)
	}

	// Dir A (referenced) survives; B is gone.
	if path, _ := s.LookupScreenshotsDir(idA); path != "/watch/folder-a" {
		t.Errorf("referenced dir A should survive, got %q", path)
	}
	if path, _ := s.LookupScreenshotsDir(idB); path != "" {
		t.Errorf("orphaned dir B should be pruned, got %q", path)
	}

	// Idempotent — nothing left to prune.
	if n, err := s.PruneScreenshotsDirs(); err != nil || n != 0 {
		t.Errorf("re-prune: got (%d, %v), want (0, nil)", n, err)
	}
}
