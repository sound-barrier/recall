package db

import "recall/pkg/parser"

// Ignored screenshots — per-file suppress list backing the Unknown
// tab's Dismiss affordance. Presence in ignored_screenshots
// IS the ignored state; no boolean column anywhere. Add/Remove are
// idempotent — ignoring an already-ignored filename refreshes the
// timestamp; un-ignoring a non-ignored one is a no-op.

func (s *SQLStore) AddIgnoredScreenshot(filename string) error {
	_, err := s.db.Exec(
		`INSERT INTO ignored_screenshots (filename) VALUES (?)
		 ON CONFLICT(filename) DO UPDATE SET ignored_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
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

// Reference-gap acknowledgements — the hidden_matches pattern applied to
// the Unknown tab's gap warnings: presence IS the acknowledged state,
// both writes idempotent (re-acknowledging refreshes the timestamp).

func (s *SQLStore) AcknowledgeReferenceGap(matchKey string) error {
	_, err := s.db.Exec(
		`INSERT INTO acknowledged_reference_gaps (match_key) VALUES (?)
		 ON CONFLICT(match_key) DO UPDATE SET acknowledged_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		matchKey,
	)
	return err
}

func (s *SQLStore) UnacknowledgeReferenceGap(matchKey string) error {
	_, err := s.db.Exec(`DELETE FROM acknowledged_reference_gaps WHERE match_key = ?`, matchKey)
	return err
}

func (s *SQLStore) LoadAcknowledgedReferenceGaps() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT match_key FROM acknowledged_reference_gaps`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		out[k] = true
	}
	return out, rows.Err()
}

// ConfirmedReadings is one match's confirmed fields, each with the reading it
// was confirmed at.
type ConfirmedReadings map[parser.FieldPath]string

// Field-reading confirmations — the sibling of the gap acks above for the
// Unknown tab's flagged readings, except that a confirmation carries the
// value the user looked at, so the read path can tell a confirmation that
// still holds from one a later parse made stale. Confirming again replaces
// the value and refreshes the timestamp.

func (s *SQLStore) ConfirmFieldReading(matchKey string, field parser.FieldPath, value string) error {
	_, err := s.db.Exec(
		`INSERT INTO confirmed_field_readings (match_key, field, confirmed_value) VALUES (?, ?, ?)
		 ON CONFLICT(match_key, field) DO UPDATE SET
		   confirmed_value = excluded.confirmed_value,
		   confirmed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		matchKey, string(field), value,
	)
	return err
}

func (s *SQLStore) UnconfirmFieldReading(matchKey string, field parser.FieldPath) error {
	_, err := s.db.Exec(`DELETE FROM confirmed_field_readings WHERE match_key = ? AND field = ?`, matchKey, string(field))
	return err
}

func (s *SQLStore) LoadFieldConfirmations() (map[string]ConfirmedReadings, error) {
	rows, err := s.db.Query(`SELECT match_key, field, confirmed_value FROM confirmed_field_readings`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]ConfirmedReadings{}
	for rows.Next() {
		var key, field, value string
		if err := rows.Scan(&key, &field, &value); err != nil {
			return nil, err
		}
		if out[key] == nil {
			out[key] = ConfirmedReadings{}
		}
		out[key][parser.FieldPath(field)] = value
	}
	return out, rows.Err()
}
