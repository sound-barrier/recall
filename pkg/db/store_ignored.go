package db

// Ignored screenshots — per-file suppress list backing the Unknown
// tab's "Delete forever" affordance. Presence in ignored_screenshots
// IS the ignored state; no boolean column anywhere. Add/Remove are
// idempotent — ignoring an already-ignored filename refreshes the
// timestamp; un-ignoring a non-ignored one is a no-op.

func (s *SQLStore) AddIgnoredScreenshot(filename string) error {
	_, err := s.db.Exec(
		`INSERT INTO ignored_screenshots (filename) VALUES (?)
		 ON CONFLICT(filename) DO UPDATE SET ignored_at = CURRENT_TIMESTAMP`,
		filename,
	)
	return err
}

func (s *SQLStore) RemoveIgnoredScreenshot(filename string) error {
	_, err := s.db.Exec(`DELETE FROM ignored_screenshots WHERE filename = ?`, filename)
	return err
}

func (s *SQLStore) LoadIgnoredFilenames() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT filename FROM ignored_screenshots`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]bool{}
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			return nil, err
		}
		out[f] = true
	}
	return out, rows.Err()
}

// ListIgnoredScreenshots returns every ignored row with its timestamp
// sorted by ignored_at DESC (most recently ignored first). Backs the
// Settings "Manage ignored files" panel; the parse-loop hot path stays
// on LoadIgnoredFilenames, which is cheaper.
func (s *SQLStore) ListIgnoredScreenshots() ([]IgnoredRow, error) {
	rows, err := s.db.Query(
		`SELECT filename, ignored_at FROM ignored_screenshots ORDER BY ignored_at DESC, filename ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := make([]IgnoredRow, 0)
	for rows.Next() {
		var r IgnoredRow
		if err := rows.Scan(&r.Filename, &r.IgnoredAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ClearIgnoredScreenshots truncates the suppress list. Used by
// App.ClearIgnoredScreenshots so the Settings panel's bulk "Re-enable
// all" action runs as one SQL statement (vs N per-file removals).
func (s *SQLStore) ClearIgnoredScreenshots() error {
	_, err := s.db.Exec(`DELETE FROM ignored_screenshots`)
	return err
}
