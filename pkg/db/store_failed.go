package db

import (
	"fmt"

	"recall/pkg/parser"
)

// Failed-file ledger — per-file OCR failure records backing the Unknown
// tab's "Failed to read" triage section and the diagnostic bundle. A row
// exists while the file's most recent parse attempt failed; a later
// successful parse removes it, and Dismiss removes it. MOSTLY not a skip
// list: the parse loop re-attempts a failed file on the next few runs,
// but once attempts reaches the app layer's cap the file is PARKED —
// LoadFailedFilenames(cap) feeds it into the normal run's skip set so
// the pending count stops promising work that will fail again. Re-parse
// All bypasses the cap; Retry (deleting the row) resets it. Parking is a
// verdict on the parser that failed the file: each row carries that
// parser's generation, and only rows stamped with the generation asking
// park, so an upgraded parser gets every parked file one more run.

func (s *SQLStore) RecordFailedFile(file FileRef, kind FailureKind, errMsg string) error {
	if kind != FailureParseFailed && kind != FailureOCRUnavailable {
		return fmt.Errorf("record failed file: unknown failure kind %q", kind)
	}
	// excluded.attempts is the one this failure counts: 1 for a parse that
	// ran and failed, 0 for an OCR outage.
	_, err := s.db.Exec(
		`INSERT INTO failed_files (screenshots_dir_id, filename, kind, error, attempts, parser_generation)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(screenshots_dir_id, filename) DO UPDATE SET
		   kind               = excluded.kind,
		   error              = excluded.error,
		   attempts           = attempts + excluded.attempts,
		   last_failed_at     = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
		   parser_generation  = excluded.parser_generation`,
		dirIDOrSentinel(file.DirID), file.Filename, kind, errMsg, attemptsCounted(kind), parser.Generation,
	)
	return err
}

// attemptsCounted is how many attempts one failure of this kind costs the file.
func attemptsCounted(kind FailureKind) int {
	if kind == FailureParseFailed {
		return 1
	}
	return 0
}

// LoadFailedFilenames returns one folder's filenames with attempts >=
// minAttempts recorded under parser generation `generation` — the
// parked-set loader for the parse skip set's hot path.
// Dir-scoped for the same reason the parsed skip set is: filename is a
// basename, and a failure recorded while a different folder was watched
// must not park a same-named capture in this one.
func (s *SQLStore) LoadFailedFilenames(dirID int64, minAttempts, generation int) (map[string]bool, error) {
	rows, err := s.db.Query(
		`SELECT filename FROM failed_files
		 WHERE screenshots_dir_id = ? AND attempts >= ? AND parser_generation = ?`,
		dirID, minAttempts, generation,
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

func (s *SQLStore) RemoveFailedFile(file FileRef) error {
	_, err := s.db.Exec(`DELETE FROM failed_files WHERE screenshots_dir_id = ? AND filename = ?`, dirIDOrSentinel(file.DirID), file.Filename)
	return err
}

func (s *SQLStore) RemoveFailedFilesNamed(filename string) error {
	_, err := s.db.Exec(`DELETE FROM failed_files WHERE filename = ?`, filename)
	return err
}

// ListFailedFiles returns every failure row, most recently failed first.
func (s *SQLStore) ListFailedFiles() ([]FailedFileRow, error) {
	rows, err := s.db.Query(
		`SELECT filename, screenshots_dir_id, kind, error, attempts, first_failed_at, last_failed_at,
		        COALESCE(parser_generation, 0)
		 FROM failed_files ORDER BY last_failed_at DESC, filename ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := make([]FailedFileRow, 0)
	for rows.Next() {
		var r FailedFileRow
		if err := rows.Scan(&r.Filename, &r.ScreenshotsDirID, &r.Kind, &r.Error, &r.Attempts, &r.FirstFailedAt, &r.LastFailedAt, &r.ParserGeneration); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
