package db

import "database/sql"

// SentinelScreenshotsDirID is the id of the always-present row at the
// top of `screenshots_dirs` that stands in for "no dir set at parse
// time." Seeded by `schema.sql` so it exists before any parent-row
// insert; the FK on every parent table is `NOT NULL DEFAULT 1`,
// referencing this id. `EnsureScreenshotsDir("")` returns it.
const SentinelScreenshotsDirID = int64(1)

// EnsureScreenshotsDir is the upsert+lookup for screenshots_dirs.
// Empty path returns the sentinel id so the parent-row FK is always
// non-null. For non-empty paths: INSERT OR IGNORE (creates if
// missing, no-ops if present), then SELECT to return the id either
// way.
func (s *SQLStore) EnsureScreenshotsDir(path string) (int64, error) {
	if path == "" {
		return SentinelScreenshotsDirID, nil
	}
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO screenshots_dirs (path) VALUES (?)`, path); err != nil {
		return 0, err
	}
	var id int64
	if err := s.db.QueryRow(`SELECT id FROM screenshots_dirs WHERE path = ?`, path).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// LookupScreenshotsDir resolves a screenshots_dirs row by id and
// returns its on-disk path. Used by ScreenshotHandler to turn the
// `<dir-id>` segment of `/_screenshot/<dir-id>/<filename>` URLs into
// the actual directory to serve from. Returns ("", nil) for the
// sentinel id and for unknown ids — the handler then falls back to
// `a.settings.ScreenshotsDir`. Errors only surface for real DB-level
// failures, not the "no such id" case.
func (s *SQLStore) LookupScreenshotsDir(id int64) (string, error) {
	if id == SentinelScreenshotsDirID {
		return "", nil
	}
	var path string
	err := s.db.QueryRow(`SELECT path FROM screenshots_dirs WHERE id = ?`, id).Scan(&path)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	// The sentinel row stores an empty path on disk; defensively
	// treat any read of "" the same as the sentinel branch above.
	if path == "" {
		return "", nil
	}
	return path, nil
}

// PruneScreenshotsDirs deletes screenshots_dirs rows that no screenshot row
// references, except the sentinel (id 1, "no dir set"). The FK is ON DELETE
// RESTRICT, so a directory row can never be removed while screenshots reference
// it — but nothing reclaims a row once its screenshots are deleted (a cleared
// match, a changed watch folder), leaving dead rows that accumulate forever.
// This is the GC path: it touches only unreferenced rows, so it can't violate
// RESTRICT. Returns the number pruned; idempotent. Runs on every store open.
func (s *SQLStore) PruneScreenshotsDirs() (int64, error) {
	res, err := s.db.Exec(`
		DELETE FROM screenshots_dirs
		WHERE id != ?
		  AND id NOT IN (
		    SELECT screenshots_dir_id FROM summary_screenshots
		    UNION SELECT screenshots_dir_id FROM teams_screenshots
		    UNION SELECT screenshots_dir_id FROM personal_screenshots
		    UNION SELECT screenshots_dir_id FROM rank_screenshots
		    UNION SELECT screenshots_dir_id FROM unknown_screenshots
		  )`, SentinelScreenshotsDirID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s *SQLStore) loadScreenshotsDirs() (map[int64]string, error) {
	out := map[int64]string{}
	rows, err := s.db.Query(`SELECT id, path FROM screenshots_dirs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var path string
		if err := rows.Scan(&id, &path); err != nil {
			return nil, err
		}
		out[id] = path
	}
	return out, rows.Err()
}
