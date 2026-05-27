package db

// Hidden matches — user-curated soft delete. Presence in the
// hidden_matches table IS the hidden state; no boolean column
// stored anywhere. Hide/Unhide are idempotent — hiding an
// already-hidden key refreshes the timestamp; unhiding a non-hidden
// key is a no-op.

func (s *SQLStore) HideMatch(matchKey string) error {
	_, err := s.db.Exec(
		`INSERT INTO hidden_matches (match_key) VALUES (?)
		 ON CONFLICT(match_key) DO UPDATE SET hidden_at = CURRENT_TIMESTAMP`,
		matchKey,
	)
	return err
}

func (s *SQLStore) UnhideMatch(matchKey string) error {
	_, err := s.db.Exec(`DELETE FROM hidden_matches WHERE match_key = ?`, matchKey)
	return err
}

func (s *SQLStore) LoadHiddenKeys() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT match_key FROM hidden_matches`)
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
