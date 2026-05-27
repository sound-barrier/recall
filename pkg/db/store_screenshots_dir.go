package db

// EnsureScreenshotsDir is the upsert+lookup for screenshots_dirs.
// Returns (0, nil) on empty path so callers can store NULL for "no
// dir set at parse time". For non-empty paths: INSERT OR IGNORE
// (creates if missing, no-ops if present), then SELECT to return the
// id either way.
func (s *SQLStore) EnsureScreenshotsDir(path string) (int64, error) {
	if path == "" {
		return 0, nil
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
