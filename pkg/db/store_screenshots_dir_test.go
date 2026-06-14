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
