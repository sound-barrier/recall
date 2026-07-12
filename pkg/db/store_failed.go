package db

// Failed-file ledger — per-file OCR failure records backing the Unknown
// tab's "Failed to read" triage section and the diagnostic bundle. A row
// exists while the file's most recent parse attempt failed. NOT a skip
// list: the parse loop re-attempts failed files on every run; ignoring
// ("Delete forever") is the user's suppression lever, and a later
// successful parse removes the row.

func (s *SQLStore) RecordFailedFile(filename string, dirID int64, errMsg string) error {
	_, err := s.db.Exec(
		`INSERT INTO failed_files (filename, screenshots_dir_id, error) VALUES (?, ?, ?)
		 ON CONFLICT(filename) DO UPDATE SET
		   error              = excluded.error,
		   screenshots_dir_id = excluded.screenshots_dir_id,
		   attempts           = attempts + 1,
		   last_failed_at     = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		filename, dirID, errMsg,
	)
	return err
}

func (s *SQLStore) RemoveFailedFile(filename string) error {
	_, err := s.db.Exec(`DELETE FROM failed_files WHERE filename = ?`, filename)
	return err
}

// ListFailedFiles returns every failure row, most recently failed first.
func (s *SQLStore) ListFailedFiles() ([]FailedFileRow, error) {
	rows, err := s.db.Query(
		`SELECT filename, screenshots_dir_id, error, attempts, first_failed_at, last_failed_at
		 FROM failed_files ORDER BY last_failed_at DESC, filename ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := make([]FailedFileRow, 0)
	for rows.Next() {
		var r FailedFileRow
		if err := rows.Scan(&r.Filename, &r.ScreenshotsDirID, &r.Error, &r.Attempts, &r.FirstFailedAt, &r.LastFailedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
