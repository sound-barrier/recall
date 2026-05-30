package db

// ApplyAmbiguity replaces the candidate set for filename. Idempotent:
// a re-parse that no longer triggers ambiguity (cands == nil) clears
// every prior candidate row; a re-parse that surfaces a different
// candidate set replaces the rows in place. Presence of any row for
// filename in ambiguous_candidates IS the ambiguity flag.
func (s *SQLStore) ApplyAmbiguity(filename string, cands []AmbiguousCandidate) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM ambiguous_candidates WHERE filename = ?`, filename); err != nil {
		return err
	}
	for _, c := range cands {
		if _, err := tx.Exec(
			`INSERT INTO ambiguous_candidates (filename, match_key, distance_s) VALUES (?,?,?)`,
			filename, c.MatchKey, c.DistanceS,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// LoadAmbiguousCandidatesFor returns the candidate list for a single
// screenshot, sorted by distance ascending. Empty slice means the
// screenshot isn't ambiguous (no row in the table).
func (s *SQLStore) LoadAmbiguousCandidatesFor(filename string) ([]AmbiguousCandidate, error) {
	rows, err := s.db.Query(
		`SELECT match_key, distance_s FROM ambiguous_candidates
		WHERE filename = ? ORDER BY distance_s ASC`,
		filename,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AmbiguousCandidate, 0)
	for rows.Next() {
		var c AmbiguousCandidate
		if err := rows.Scan(&c.MatchKey, &c.DistanceS); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ResolveAmbiguous atomically rewrites the match_key on every parent
// row carrying ambiguousMatchKey (the original screenshot plus any
// sibling rows that adopted the sentinel via the timestamp-window
// pass) and clears every candidate row for the original screenshot.
// Returns (false, nil) when no ambiguous candidates exist for the
// key, letting the caller respond with 404.
func (s *SQLStore) ResolveAmbiguous(ambiguousMatchKey, newMatchKey string) (bool, error) {
	const prefix = "ambiguous:"
	if len(ambiguousMatchKey) <= len(prefix) || ambiguousMatchKey[:len(prefix)] != prefix {
		return false, nil
	}
	filename := ambiguousMatchKey[len(prefix):]
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.Exec(`DELETE FROM ambiguous_candidates WHERE filename = ?`, filename)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	if n == 0 {
		return false, nil
	}
	for _, table := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(
			`UPDATE `+table+` SET match_key = ? WHERE match_key = ?`,
			newMatchKey, ambiguousMatchKey,
		); err != nil {
			return false, err
		}
	}
	return true, tx.Commit()
}

// loadAllAmbiguousCandidates returns every ambiguous_candidates row
// grouped by filename. Used by LoadAll to populate
// Screenshots.AmbiguousCandidates in one bulk read instead of N
// per-file lookups.
func (s *SQLStore) loadAllAmbiguousCandidates() (map[string][]AmbiguousCandidate, error) {
	rows, err := s.db.Query(
		`SELECT filename, match_key, distance_s FROM ambiguous_candidates
		ORDER BY filename, distance_s ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]AmbiguousCandidate{}
	for rows.Next() {
		var filename string
		var c AmbiguousCandidate
		if err := rows.Scan(&filename, &c.MatchKey, &c.DistanceS); err != nil {
			return nil, err
		}
		out[filename] = append(out[filename], c)
	}
	return out, rows.Err()
}
