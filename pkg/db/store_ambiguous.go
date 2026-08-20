package db

import (
	"database/sql"
	"fmt"
)

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
			`INSERT INTO ambiguous_candidates (filename, match_key, distance_seconds) VALUES (?,?,?)`,
			filename, c.MatchKey, c.DistanceSeconds,
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
		`SELECT match_key, distance_seconds FROM ambiguous_candidates
		WHERE filename = ? ORDER BY distance_seconds ASC`,
		filename,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AmbiguousCandidate, 0)
	for rows.Next() {
		var c AmbiguousCandidate
		if err := rows.Scan(&c.MatchKey, &c.DistanceSeconds); err != nil {
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
func (s *SQLStore) ResolveAmbiguous(filename, ambiguousMatchKey, newMatchKey string) (bool, error) {
	const prefix = "ambiguous-"
	if len(ambiguousMatchKey) <= len(prefix) || ambiguousMatchKey[:len(prefix)] != prefix {
		return false, nil
	}
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
	if err := renameMatchKey(tx, ambiguousMatchKey, newMatchKey); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

// DemoteMatchToAmbiguous is the exact inverse of ResolveAmbiguous: it
// atomically rewrites every parent row carrying matchKey onto the
// ambiguous sentinel and records the candidate list under filename (the
// sentinel's embedded anchor). The end-of-parse duplicate sweep uses it
// to pull a freshly-created match back into the "Needs your review"
// queue. Returns (false, nil) without recording candidates when no
// parent row carries matchKey — recording them anyway would orphan
// candidate rows no record surfaces.
func (s *SQLStore) DemoteMatchToAmbiguous(matchKey, ambiguousMatchKey, filename string, cands []AmbiguousCandidate) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()
	rewritten := int64(0)
	for _, table := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		res, err := tx.Exec(
			`UPDATE `+table+` SET match_key = ? WHERE match_key = ?`,
			ambiguousMatchKey, matchKey,
		)
		if err != nil {
			return false, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return false, err
		}
		rewritten += n
	}
	if rewritten == 0 {
		return false, nil
	}
	if _, err := tx.Exec(`DELETE FROM ambiguous_candidates WHERE filename = ?`, filename); err != nil {
		return false, err
	}
	for _, c := range cands {
		if _, err := tx.Exec(
			`INSERT INTO ambiguous_candidates (filename, match_key, distance_seconds) VALUES (?,?,?)`,
			filename, c.MatchKey, c.DistanceSeconds,
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
func loadAllAmbiguousCandidates(q querier) (map[string][]AmbiguousCandidate, error) {
	rows, err := q.Query(
		`SELECT filename, match_key, distance_seconds FROM ambiguous_candidates
		ORDER BY filename, distance_seconds ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]AmbiguousCandidate{}
	for rows.Next() {
		var filename string
		var c AmbiguousCandidate
		if err := rows.Scan(&filename, &c.MatchKey, &c.DistanceSeconds); err != nil {
			return nil, err
		}
		out[filename] = append(out[filename], c)
	}
	return out, rows.Err()
}

// renameMatchKey moves a match from one key to another, everywhere.
//
// match_key is the match's identity and it is MUTABLE — resolving an
// ambiguous screenshot renames one — but it is declared a foreign key
// nowhere, because a match is five parent rows rather than one referenceable
// row. So the rename has to be written out, and it has to be complete: a
// table left behind keeps rows on a key nothing will ever look up again, and
// in user_match_data's case the orphan comes back as a phantom manual match
// (an override row with no screenshot row is exactly what
// SynthesizeManualMatches looks for).
//
// The cascading children come along on their parents' ON UPDATE CASCADE.
func renameMatchKey(tx *sql.Tx, from, to string) error {
	for _, table := range matchKeyTables {
		// #nosec G202 -- table names come from a hard-coded registry.
		if _, err := tx.Exec(
			`UPDATE OR REPLACE `+table+` SET match_key = ? WHERE match_key = ?`, to, from,
		); err != nil {
			return fmt.Errorf("rename match key in %s: %w", table, err)
		}
	}
	return nil
}
