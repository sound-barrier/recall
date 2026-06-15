package db

// All-Heroes screenshots — recognized-but-unstored skip list. The PERSONAL
// "All Heroes" aggregate view duplicates the TEAMS combat totals and its card
// icons defeat the OCR, so the parser recognizes it ("all_heroes") yet extracts
// nothing; the write path records only the filename here. Presence IS the
// recognized state — like ignored_screenshots it keeps the file out of the next
// OCR run, but without surfacing on the Unknown tab or polluting match
// aggregation with a garbage row. Idempotent: re-recording refreshes the
// timestamp.

func (s *SQLStore) UpsertAllHeroesScreenshot(filename string) error {
	_, err := s.db.Exec(
		`INSERT INTO all_heroes_screenshots (filename) VALUES (?)
		 ON CONFLICT(filename) DO UPDATE SET recognized_at = CURRENT_TIMESTAMP`,
		filename,
	)
	return err
}

func (s *SQLStore) LoadAllHeroesFilenames() (map[string]bool, error) {
	rows, err := s.db.Query(`SELECT filename FROM all_heroes_screenshots`)
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
