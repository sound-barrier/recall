package db

// screenshotTypeTables maps the storage-side screenshot type to the table
// its rows live in. The all_heroes registry rides along: a stale row there
// makes future parse runs skip the file's re-OCR entirely, so a
// reclassified screenshot must leave it too.
var screenshotTypeTables = map[string]string{
	"summary":    "summary_screenshots",
	"teams":      "teams_screenshots",
	"personal":   "personal_screenshots",
	"rank":       "rank_screenshots",
	"unknown":    "unknown_screenshots",
	"all_heroes": "all_heroes_screenshots",
}

// DeleteScreenshotSiblings removes filename's rows from every screenshot
// table except keepType's (children CASCADE). A re-parse that reclassifies
// a screenshot — a rank screen once stored as a garbage summary row, an
// unknown that a parser fix now reads — must not strand the old-type row
// beside the new one. Idempotent; a filename absent everywhere is a no-op.
func (s *SQLStore) DeleteScreenshotSiblings(filename, keepType string) error {
	keep := screenshotTypeTables[keepType]
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, t := range append(append([]string{}, parentTables...), "all_heroes_screenshots") {
		if t == keep {
			continue
		}
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(`DELETE FROM `+t+` WHERE filename = ?`, filename); err != nil {
			return err
		}
	}
	return tx.Commit()
}
