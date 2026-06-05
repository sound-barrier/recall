package db

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
	if out.Scoreboards, err = s.loadScoreboards(); err != nil {
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
	} {
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := s.db.Exec(`DELETE FROM ` + t); err != nil {
			return err
		}
	}
	return nil
}
