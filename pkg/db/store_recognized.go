package db

// Recognized-but-unstored skip registries. Some screens the parser recognizes
// carry nothing worth storing as match data; the write path records only the
// filename, and presence IS the recognized state — like ignored_screenshots it
// keeps the file out of the next OCR run, but without surfacing on the Unknown
// tab or polluting match aggregation with a garbage row. Normal runs skip a
// registered file; Re-parse All reconsiders it, because the recognition is
// automatic rather than a user decision. Idempotent: re-recording refreshes
// the timestamp.
//
//   - all_heroes_screenshots — the PERSONAL "All Heroes" aggregate view, whose
//     combat totals duplicate the TEAMS screen and whose card icons defeat the
//     OCR.
//   - history_screenshots — the career profile's HISTORY → GAME REPORTS list,
//     which is not a match screen at all.

// recognizedRegistryTables is every recognized-skip registry. A file's rows
// are cleared from these alongside the parent tables whenever it is
// reclassified or dismissed, or a stale entry would keep skipping its re-OCR.
var recognizedRegistryTables = []string{"all_heroes_screenshots", "history_screenshots"}

func (s *SQLStore) UpsertAllHeroesScreenshot(filename string) error {
	return s.upsertRecognized("all_heroes_screenshots", filename)
}

func (s *SQLStore) LoadAllHeroesFilenames() (map[string]bool, error) {
	return s.loadRecognized("all_heroes_screenshots")
}

func (s *SQLStore) UpsertHistoryScreenshot(filename string) error {
	return s.upsertRecognized("history_screenshots", filename)
}

func (s *SQLStore) LoadHistoryFilenames() (map[string]bool, error) {
	return s.loadRecognized("history_screenshots")
}

func (s *SQLStore) upsertRecognized(table, filename string) error {
	// #nosec G202 -- table is one of recognizedRegistryTables, never user input.
	_, err := s.db.Exec(
		`INSERT INTO `+table+` (filename) VALUES (?)
		 ON CONFLICT(filename) DO UPDATE SET recognized_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		filename,
	)
	return err
}

func (s *SQLStore) loadRecognized(table string) (map[string]bool, error) {
	// #nosec G202 -- table is one of recognizedRegistryTables, never user input.
	rows, err := s.db.Query(`SELECT filename FROM ` + table)
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
