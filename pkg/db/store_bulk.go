package db

import "database/sql"

// Bulk read/write paths — LoadAll fans out across the five parent
// tables; LoadAllFilenames is the union read used by the parse loop
// to skip already-parsed files; Clear wipes every parent (children
// cascade) plus the screenshots_dirs lookup.

// LoadAll bulk-reads every row across all parent tables with their
// children attached. The aggregator does the per-match grouping.
func (s *SQLStore) LoadAll() (Screenshots, error) {
	var out Screenshots
	var err error
	if out.ScreenshotsDirs, err = s.loadScreenshotsDirs(); err != nil {
		return out, err
	}
	if out.Summaries, err = s.loadSummaries(); err != nil {
		return out, err
	}
	if out.Teams, err = s.loadTeams(); err != nil {
		return out, err
	}
	if out.Personals, err = s.loadPersonals(); err != nil {
		return out, err
	}
	if out.Ranks, err = s.loadRanks(); err != nil {
		return out, err
	}
	if out.Unknowns, err = s.loadUnknowns(); err != nil {
		return out, err
	}
	if out.AmbiguousCandidates, err = s.loadAllAmbiguousCandidates(); err != nil {
		return out, err
	}
	return out, nil
}

// LoadAllFilenames returns the union of every filename across every
// parent table. Used to skip already-parsed files in the next OCR run.
func (s *SQLStore) LoadAllFilenames() (map[string]bool, error) {
	out := map[string]bool{}
	for _, t := range parentTables {
		if err := s.collectFilenames(t, out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// LookupMatchKeysForFilename returns every distinct match_key that
// has a row referencing `filename` across the five parent tables.
// Used by App.IgnoreScreenshot to wipe the actual match the user
// clicked on — which may be keyed `match-<ts>` (a tracked match
// whose parser failed to extract a map name, surfacing it on the
// Unknown tab), not just the unmatched- / ambiguous- shapes the
// earlier wipe handled. Idempotent / safe on absent filenames
// (returns an empty slice, no error).
func (s *SQLStore) LookupMatchKeysForFilename(filename string) ([]string, error) {
	seen := map[string]bool{}
	for _, t := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		rows, err := s.db.Query(`SELECT DISTINCT match_key FROM `+t+` WHERE filename = ?`, filename)
		if err != nil {
			return nil, err
		}
		if err := scanMatchKeys(rows, seen); err != nil {
			return nil, err
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	return out, nil
}

func scanMatchKeys(rows *sql.Rows, out map[string]bool) error {
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return err
		}
		out[k] = true
	}
	return rows.Err()
}

func (s *SQLStore) collectFilenames(table string, out map[string]bool) error {
	// #nosec G202 -- table name comes from a hard-coded slice, not user input.
	rows, err := s.db.Query(`SELECT filename FROM ` + table)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var f string
		if err := rows.Scan(&f); err != nil {
			return err
		}
		out[f] = true
	}
	return rows.Err()
}

// Clear deletes every row in every table — parent screenshot tables
// (children cascade), the screenshots_dirs lookup, the per-match
// auxiliary tables (match_reviews, match_annotations with its
// children cascading, hidden_matches, ambiguous_candidates, match_
// queue, match_play_mode), AND the ignored_screenshots suppress
// list. Used by App.ClearDatabase, bundle import, and CSV import —
// all of which expect a "wipe everything" semantic. Callers that
// want the suppress list to survive (App.ClearDatabase's keep-
// ignored opt-out path) snapshot the list, call Clear, then re-
// insert via AddIgnoredScreenshot.
func (s *SQLStore) Clear() error {
	for _, t := range parentTables {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := s.db.Exec(`DELETE FROM ` + t); err != nil {
			return err
		}
	}
	for _, t := range []string{
		"screenshots_dirs",
		"match_reviews",
		"match_queue",
		"match_play_mode",
		"match_annotations", // match_annotation_members + _tags cascade
		"hidden_matches",
		"ambiguous_candidates",
		"ignored_screenshots",
		"all_heroes_screenshots",
		"user_match_data", // user_match_* children cascade on the match_key FK
	} {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := s.db.Exec(`DELETE FROM ` + t); err != nil {
			return err
		}
	}
	// Re-seed the default screenshots-dir sentinel (id=1) that schema.sql
	// creates. Every parent table defaults screenshots_dir_id to 1, so wiping
	// the row above would FK-fail the very next insert — e.g. a forced
	// re-seed (`make seed-dev FORCE=1`) onto a profile that already exists, or
	// any insert that relies on the default rather than EnsureScreenshotsDir.
	// It's a config sentinel ("use the active screenshots folder"), not data.
	if _, err := s.db.Exec(`INSERT OR IGNORE INTO screenshots_dirs (id, path) VALUES (1, '')`); err != nil {
		return err
	}
	return nil
}
