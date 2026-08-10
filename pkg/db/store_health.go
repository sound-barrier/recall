package db

import (
	"fmt"
	"os"
	"time"
)

// Health is the point-in-time report behind Settings → Advanced →
// Database health. Integrity carries "ok" or the FIRST problem line
// integrity_check reported — surfacing one real problem beats a
// truncated wall of them; the user's next step (restore a backup)
// is the same either way.
type Health struct {
	Integrity     string `json:"integrity"`
	SizeBytes     int64  `json:"size_bytes"`
	WALBytes      int64  `json:"wal_bytes"`
	FreelistPages int64  `json:"freelist_pages"`
	PageCount     int64  `json:"page_count"`
	CheckedAt     string `json:"checked_at"`
}

// Health runs PRAGMA integrity_check plus the size/freelist pragmas
// and stats the database + WAL files. Read-only; safe concurrently
// with a parse (WAL readers don't block the writer).
func (s *SQLStore) Health() (Health, error) {
	h := Health{CheckedAt: time.Now().UTC().Format(time.RFC3339)}

	if err := s.db.QueryRow("PRAGMA integrity_check").Scan(&h.Integrity); err != nil {
		return h, fmt.Errorf("health: integrity check: %w", err)
	}
	if err := s.db.QueryRow("PRAGMA page_count").Scan(&h.PageCount); err != nil {
		return h, fmt.Errorf("health: page count: %w", err)
	}
	if err := s.db.QueryRow("PRAGMA freelist_count").Scan(&h.FreelistPages); err != nil {
		return h, fmt.Errorf("health: freelist count: %w", err)
	}
	// :memory: stores (tests) have no file to stat; sizes stay 0.
	if s.path != "" && s.path != ":memory:" {
		if info, err := os.Stat(s.path); err == nil {
			h.SizeBytes = info.Size()
		}
		if info, err := os.Stat(s.path + "-wal"); err == nil {
			h.WALBytes = info.Size()
		}
	}
	return h, nil
}

// Optimize runs PRAGMA optimize — SQLite's own analyze-if-useful
// maintenance hook, recommended before long-lived connections close.
// Cheap; no exclusive lock beyond normal write locking.
func (s *SQLStore) Optimize() error {
	if _, err := s.db.Exec("PRAGMA optimize"); err != nil {
		return fmt.Errorf("optimize: %w", err)
	}
	return nil
}

// Vacuum rebuilds the database file, returning freelist pages to the
// filesystem, then truncates the WAL. Takes an exclusive lock for
// the duration — the app layer serializes it against parses.
func (s *SQLStore) Vacuum() error {
	if _, err := s.db.Exec("VACUUM"); err != nil {
		return fmt.Errorf("vacuum: %w", err)
	}
	if _, err := s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return fmt.Errorf("vacuum: wal checkpoint: %w", err)
	}
	return nil
}
