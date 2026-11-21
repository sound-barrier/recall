package db

import "strings"

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

// recognizedFilenamesSQL selects every (folder, filename) in any
// recognized-skip registry, for a row-value NOT IN filter.
func recognizedFilenamesSQL() string {
	selects := make([]string, len(recognizedRegistryTables))
	for i, t := range recognizedRegistryTables {
		selects[i] = "SELECT screenshots_dir_id, filename FROM " + t
	}
	return strings.Join(selects, " UNION ")
}

// DeleteUnknownScreenshot retires the Unknown state of a file the parser now
// recognizes as a non-match screen: its unknown_screenshots row, its own
// pending ambiguity candidates, and the candidates of any key that row was
// the last to back. Typed rows are never touched — they are data, and a
// recognition that misfired must not cost them. Idempotent.
func (s *SQLStore) DeleteUnknownScreenshot(filename string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	keys := map[string]bool{}
	if err := collectMatchKeys(tx, "unknown_screenshots", filename, keys); err != nil {
		return err
	}
	// The retired rows' evidence, found through the rows themselves so the
	// delete reaches exactly the files whose Unknown row goes.
	if _, err := tx.Exec(
		`DELETE FROM screenshot_images WHERE (screenshots_dir_id, filename) IN
		 (SELECT screenshots_dir_id, filename FROM unknown_screenshots WHERE filename = ?)`, filename,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM unknown_screenshots WHERE filename = ?`, filename); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM ambiguous_candidates WHERE filename = ?`, filename); err != nil {
		return err
	}
	if err := dropOrphanedCandidates(tx, keys); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *SQLStore) UpsertAllHeroesScreenshot(file FileRef) error {
	return s.upsertRecognized("all_heroes_screenshots", file)
}

func (s *SQLStore) LoadAllHeroesFilenames(dirID int64) (map[string]bool, error) {
	return s.loadRecognized("all_heroes_screenshots", dirID)
}

func (s *SQLStore) UpsertHistoryScreenshot(file FileRef) error {
	return s.upsertRecognized("history_screenshots", file)
}

func (s *SQLStore) LoadHistoryFilenames(dirID int64) (map[string]bool, error) {
	return s.loadRecognized("history_screenshots", dirID)
}

func (s *SQLStore) upsertRecognized(table string, file FileRef) error {
	// #nosec G202 -- table is one of recognizedRegistryTables, never user input.
	_, err := s.db.Exec(
		`INSERT INTO `+table+` (screenshots_dir_id, filename) VALUES (?, ?)
		 ON CONFLICT(screenshots_dir_id, filename) DO UPDATE SET recognized_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		dirIDOrSentinel(file.DirID), file.Filename,
	)
	return err
}

// loadRecognized reads one folder's names from one registry.
func (s *SQLStore) loadRecognized(table string, dirID int64) (map[string]bool, error) {
	// #nosec G202 -- table is one of recognizedRegistryTables, never user input.
	rows, err := s.db.Query(`SELECT filename FROM `+table+` WHERE screenshots_dir_id = ?`, dirID)
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
