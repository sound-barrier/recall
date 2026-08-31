package db

// Failed-file ledger — per-file OCR failure records backing the Unknown
// tab's "Failed to read" triage section and the diagnostic bundle. A row
// exists while the file's most recent parse attempt failed; a later
// successful parse removes it, and Dismiss removes it. MOSTLY not a skip
// list: the parse loop re-attempts a failed file on the next few runs,
// but once attempts reaches the app layer's cap the file is PARKED —
// LoadFailedFilenames(cap) feeds it into the normal run's skip set so
// the pending count stops promising work that will fail again. Re-parse
// All bypasses the cap; Retry (deleting the row) resets it.

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

// LoadFailedFilenames returns one folder's filenames with attempts >=
// minAttempts — the parked-set loader for the parse skip set's hot path.
// Dir-scoped for the same reason the parsed skip set is: filename is a
// basename, and a failure recorded while a different folder was watched
// must not park a same-named capture in this one.
func (s *SQLStore) LoadFailedFilenames(dirID int64, minAttempts int) (map[string]bool, error) {
	rows, err := s.db.Query(
		`SELECT filename FROM failed_files WHERE screenshots_dir_id = ? AND attempts >= ?`,
		dirID, minAttempts,
	)
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
