package db

import (
	"database/sql"
	"fmt"
)

// Hidden matches — user-curated soft delete. Presence in the
// hidden_matches table IS the hidden state; no boolean column
// stored anywhere. Hide/Unhide are idempotent — hiding an
// already-hidden key refreshes the timestamp; unhiding a non-hidden
// key is a no-op.

func (s *SQLStore) HideMatch(matchKey string) error {
	_, err := s.db.Exec(
		`INSERT INTO hidden_matches (match_key) VALUES (?)
		 ON CONFLICT(match_key) DO UPDATE SET hidden_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
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
// review row, the user override layer (user_match_data + children), the
// queue / play-mode aux rows, the received coach layer (match_coach_notes +
// tag children, and the return-sheet decisions that pointed at those notes),
// and the ambiguity surface. Used by the Hidden drawer's Delete affordance —
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
	if err := forgetAmbiguitySurface(tx, matchKey); err != nil {
		return err
	}
	if err := forgetIngestedFiles(tx, matchKey); err != nil {
		return err
	}
	for _, t := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(`DELETE FROM `+t+` WHERE match_key = ?`, matchKey); err != nil {
			return err
		}
	}
	for _, q := range []string{
		`DELETE FROM hidden_matches WHERE match_key = ?`,
		`DELETE FROM acknowledged_reference_gaps WHERE match_key = ?`,
		`DELETE FROM match_annotations WHERE match_key = ?`,
		`DELETE FROM match_moments WHERE match_key = ?`,
		`DELETE FROM match_reviews WHERE match_key = ?`,
		`DELETE FROM user_match_data WHERE match_key = ?`, // children CASCADE
		`DELETE FROM match_queue WHERE match_key = ?`,
		`DELETE FROM match_play_mode WHERE match_key = ?`,
		`DELETE FROM pinned_matches WHERE match_key = ?`,
		// Decisions first — they are found through the notes about to go.
		`DELETE FROM coach_return_decisions WHERE note_id IN
		   (SELECT note_id FROM match_coach_notes WHERE match_key = ?)`,
		`DELETE FROM match_coach_notes WHERE match_key = ?`, // tag children CASCADE
		// The match leaves every self review it was a member of; the note the
		// player wrote about it there cascades off the membership row. The
		// review itself stays — it is a fact about the sitting, not the match.
		`DELETE FROM self_review_matches WHERE match_key = ?`,
	} {
		if _, err := tx.Exec(q, matchKey); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// forgetIngestedFiles drops the dedup-registry rows for the match's own
// screenshots, and — by the self-FK's cascade — for any byte-identical copy
// registered against one of them. A duplicate is skipped before OCR on every
// run including ReParseAll, so a copy left standing after its canonical left
// the corpus is a screenshot the app will never look at again.
//
// Reads the parent rows for filenames, so it must run BEFORE the parent wipe,
// like forgetAmbiguitySurface below.
func forgetIngestedFiles(tx *sql.Tx, matchKey string) error {
	for _, t := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(
			`DELETE FROM ingested_files WHERE filename IN
			 (SELECT filename FROM `+t+` WHERE match_key = ?)`, matchKey,
		); err != nil {
			return err
		}
	}
	return nil
}

// forgetAmbiguitySurface makes the ambiguity surface forget the match: rows
// where it was a resolution candidate (resolving a pending screenshot onto a
// deleted key would resurrect its identity), and — when matchKey IS the
// ambiguous sentinel — the candidate set of its source screenshots, keyed by
// filename. The filename lookup reads the parent rows, so both deletes must
// run before HardDeleteMatch's parent wipe.
func forgetAmbiguitySurface(tx *sql.Tx, matchKey string) error {
	if _, err := tx.Exec(`DELETE FROM ambiguous_candidates WHERE match_key = ?`, matchKey); err != nil {
		return err
	}
	for _, t := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(
			`DELETE FROM ambiguous_candidates WHERE filename IN
			 (SELECT filename FROM `+t+` WHERE match_key = ?)`, matchKey,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *SQLStore) LoadHiddenKeys() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT match_key FROM hidden_matches`)
	if err != nil {
		return nil, fmt.Errorf("load hidden keys: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, fmt.Errorf("load hidden keys: %w", err)
		}
		out[k] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load hidden keys: %w", err)
	}
	return out, nil
}

// Pinned matches — the hidden_matches pattern applied to pins.
// Idempotent both directions.

func (s *SQLStore) PinMatch(matchKey string) error {
	_, err := s.db.Exec(
		`INSERT INTO pinned_matches (match_key) VALUES (?)
		 ON CONFLICT(match_key) DO UPDATE SET pinned_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		matchKey,
	)
	return err
}

func (s *SQLStore) UnpinMatch(matchKey string) error {
	_, err := s.db.Exec(`DELETE FROM pinned_matches WHERE match_key = ?`, matchKey)
	return err
}

func (s *SQLStore) LoadPinnedKeys() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT match_key FROM pinned_matches`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
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
