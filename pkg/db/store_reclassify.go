package db

import (
	"database/sql"

	"recall/pkg/parser"
)

// screenshotTypeTables maps the storage-side screenshot type to the table
// its rows live in. The all_heroes registry rides along: a stale row there
// makes future parse runs skip the file's re-OCR entirely, so a
// reclassified screenshot must leave it too.
var screenshotTypeTables = map[parser.ScreenshotType]string{
	parser.TypeSummary:   "summary_screenshots",
	parser.TypeTeams:     "teams_screenshots",
	parser.TypePersonal:  "personal_screenshots",
	parser.TypeRank:      "rank_screenshots",
	parser.TypeUnknown:   "unknown_screenshots",
	parser.TypeAllHeroes: "all_heroes_screenshots",
}

// DeleteScreenshotSiblings removes filename's rows from every screenshot
// table except keepType's (children CASCADE). A re-parse that reclassifies
// a screenshot — a rank screen once stored as a garbage summary row, an
// unknown that a parser fix now reads — must not strand the old-type row
// beside the new one. When the wipe removes a match key's LAST parent row,
// ambiguous candidates referencing that key go too (HardDeleteMatch's
// invariant: resolving a pending screenshot onto a dead key would
// resurrect its identity). Idempotent; a filename absent everywhere is a
// no-op.
func (s *SQLStore) DeleteScreenshotSiblings(filename string, keepType parser.ScreenshotType) error {
	keep := screenshotTypeTables[keepType]
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	oldKeys := map[string]bool{}
	for _, t := range parentTables {
		if t == keep {
			continue
		}
		if err := collectMatchKeys(tx, t, filename, oldKeys); err != nil {
			return err
		}
	}
	if err := deleteSiblingRows(tx, keep, filename); err != nil {
		return err
	}
	if err := dropOrphanedCandidates(tx, oldKeys); err != nil {
		return err
	}
	return tx.Commit()
}

// deleteSiblingRows removes filename's rows from every screenshot table
// (parents + the all_heroes registry) except keep's; children CASCADE.
func deleteSiblingRows(tx *sql.Tx, keep, filename string) error {
	for _, t := range append(append([]string{}, parentTables...), "all_heroes_screenshots") {
		if t == keep {
			continue
		}
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if _, err := tx.Exec(`DELETE FROM `+t+` WHERE filename = ?`, filename); err != nil {
			return err
		}
	}
	return nil
}

// dropOrphanedCandidates deletes the ambiguous candidates of any key the
// sibling wipe left without a single parent row.
func dropOrphanedCandidates(tx *sql.Tx, keys map[string]bool) error {
	for key := range keys {
		orphaned, err := matchKeyHasNoRows(tx, key)
		if err != nil {
			return err
		}
		if !orphaned {
			continue
		}
		if _, err := tx.Exec(`DELETE FROM ambiguous_candidates WHERE match_key = ?`, key); err != nil {
			return err
		}
	}
	return nil
}

// collectMatchKeys adds the match keys of filename's rows in table to out.
func collectMatchKeys(tx *sql.Tx, table, filename string, out map[string]bool) error {
	// #nosec G202 -- table name comes from a hard-coded slice, not user input.
	rows, err := tx.Query(`SELECT match_key FROM `+table+` WHERE filename = ?`, filename)
	if err != nil {
		return err
	}
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

// matchKeyHasNoRows reports whether no parent table holds a row for key.
func matchKeyHasNoRows(tx *sql.Tx, key string) (bool, error) {
	for _, t := range parentTables {
		var n int
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if err := tx.QueryRow(`SELECT COUNT(*) FROM `+t+` WHERE match_key = ?`, key).Scan(&n); err != nil {
			return false, err
		}
		if n > 0 {
			return false, nil
		}
	}
	return true, nil
}
