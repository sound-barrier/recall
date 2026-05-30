package db

import (
	"database/sql"
	"errors"
	"strings"
)

// ErrAmbiguousNotFound is returned by ResolveAmbiguous when no
// ambiguous_screenshots row exists for the given filename. Callers
// map this to HTTP 404.
var ErrAmbiguousNotFound = errors.New("ambiguous screenshot not found")

// ApplyAmbiguity wipes any existing ambiguous_screenshots row for
// filename and re-inserts iff cands is non-empty. Idempotent: a
// re-parse that no longer triggers ambiguity (cands == nil) clears
// the previous row; a re-parse that surfaces a different candidate
// set replaces the rows in place.
func (s *SQLStore) ApplyAmbiguity(filename string, cands []AmbiguousCandidate) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`DELETE FROM ambiguous_screenshots WHERE filename = ?`, filename); err != nil {
		return err
	}
	if len(cands) > 0 {
		if _, err := tx.Exec(
			`INSERT INTO ambiguous_screenshots (filename, reason) VALUES (?, 'ead-bridge')`,
			filename,
		); err != nil {
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
	}
	return tx.Commit()
}

// LoadAmbiguousCandidatesFor returns the candidate list for a single
// screenshot — used by the resolution handler to validate the user's
// pick. Returns ErrAmbiguousNotFound when no row exists for filename.
func (s *SQLStore) LoadAmbiguousCandidatesFor(filename string) ([]AmbiguousCandidate, error) {
	var detected sql.NullString
	if err := s.db.QueryRow(
		`SELECT detected_at FROM ambiguous_screenshots WHERE filename = ?`,
		filename,
	).Scan(&detected); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrAmbiguousNotFound
		}
		return nil, err
	}
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
// row carrying ambiguousMatchKey (the original screenshot AND any
// sibling rows that adopted the sentinel via the timestamp-window
// pass) and drops the ambiguous_screenshots row for the original
// screenshot. ambiguousMatchKey must start with "ambiguous:" —
// callers are expected to validate this before delegating.
// Returns ErrAmbiguousNotFound if there is no ambiguous row to resolve.
func (s *SQLStore) ResolveAmbiguous(ambiguousMatchKey, newMatchKey string) error {
	filename := strings.TrimPrefix(ambiguousMatchKey, "ambiguous:")
	if filename == ambiguousMatchKey {
		return errors.New("ResolveAmbiguous: ambiguousMatchKey must start with 'ambiguous:'")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.Exec(`DELETE FROM ambiguous_screenshots WHERE filename = ?`, filename)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrAmbiguousNotFound
	}
	for _, table := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(
			`UPDATE `+table+` SET match_key = ? WHERE match_key = ?`,
			newMatchKey, ambiguousMatchKey,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
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
