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

// HardDeleteMatch wipes every row keyed on matchKey across all parent
// tables (children CASCADE), plus annotations, the hidden_matches flag, the
// review row, the user override layer (user_match_data + children), and the
// queue / play-mode aux rows. Used by the Hidden drawer's Delete affordance —
// once a user explicitly asks to forget a match, no trace stays in the DB.
// Clearing user_match_data is essential for manual matches: their data lives
// ONLY there, so leaving it would resurrect the match on the next aggregate.
// Idempotent: unknown keys complete with no error.
func (s *SQLStore) HardDeleteMatch(matchKey string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, t := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(`DELETE FROM `+t+` WHERE match_key = ?`, matchKey); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM hidden_matches WHERE match_key = ?`, matchKey); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM match_annotations WHERE match_key = ?`, matchKey); err != nil {
		return err
	}
	for _, q := range []string{
		`DELETE FROM match_reviews WHERE match_key = ?`,
		`DELETE FROM user_match_data WHERE match_key = ?`, // children CASCADE
		`DELETE FROM match_queue WHERE match_key = ?`,
		`DELETE FROM match_play_mode WHERE match_key = ?`,
	} {
		if _, err := tx.Exec(q, matchKey); err != nil {
			return err
		}
	}
	return tx.Commit()
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
