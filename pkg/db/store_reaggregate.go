package db

import "database/sql"

// reaggPending is one (row id, canonical value) pair resolved by a
// re-aggregation pass, batched into UPDATE statements by promoteColumn.
type reaggPending struct {
	id  int64
	val string
}

// collectReaggPending runs `query` (id, raw) and returns the rows whose raw
// value the matcher resolves to a non-empty canonical. The SELECT lives in its
// own function so the single `defer rows.Close()` covers every return path
// (sqlclosecheck).
func collectReaggPending(tx *sql.Tx, query string, fn func(string) string) ([]reaggPending, error) {
	rows, err := tx.Query(query)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []reaggPending
	for rows.Next() {
		var id int64
		var raw string
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		if canonical := fn(raw); canonical != "" {
			out = append(out, reaggPending{id: id, val: canonical})
		}
	}
	return out, rows.Err()
}

// promoteColumn resolves one (select, update) pair via the matcher and writes
// the canonical values back, returning how many rows it promoted. A blank
// selectSQL (a table without that column, e.g. personal has no map) is a no-op.
func promoteColumn(tx *sql.Tx, selectSQL, updateSQL string, fn func(string) string) (int, error) {
	if selectSQL == "" {
		return 0, nil
	}
	todo, err := collectReaggPending(tx, selectSQL, fn)
	if err != nil {
		return 0, err
	}
	for _, p := range todo {
		if _, err := tx.Exec(updateSQL, p.val, p.id); err != nil {
			return 0, err
		}
	}
	return len(todo), nil
}

// ReAggregateUnknowns walks the per-screenshot rows where the
// canonical hero/map is empty but a raw OCR string is preserved, and
// runs the caller-supplied matchers (the parser's extractHeroes /
// bestKnownMapInText, bound to the current YAML rosters) against the
// raw values. Rows that now resolve to canonical get written back in
// place; rows that still don't resolve are left untouched so a
// later YAML release can pick them up.
//
// One transaction across all three parent tables (summary, score
// board, personal). Counts hero promotions + map promotions
// separately and returns the sum — each promotion is one UPDATE.
//
// The matchers are passed as opaque functions to keep this layer
// agnostic of pkg/parser; callers wrap heroes / maps appropriately:
//
//	heroFn := func(raw string) string {
//		hs := parser.ExtractHeroesForReaggregate(raw)
//		if len(hs) > 0 { return hs[0] }
//		return ""
//	}
//	mapFn := parser.BestKnownMapInTextForReaggregate
//
// (Exposed entry points in the parser package — see
// pkg/parser/heroes.go and pkg/parser/maps.go.)
func (s *SQLStore) ReAggregateUnknowns(heroFn func(rawHero string) string, mapFn func(rawMap string) string) (int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }() // no-op after Commit

	// Hard-coded SELECT/UPDATE SQL per table keeps the table name
	// out of any concatenated query string — gosec G202 then has
	// nothing to flag. The two parent tables that carry hero_raw
	// (summary / personal) each get their own pair; only summary
	// carries map_raw (and thus the map pair). Personal has no map
	// column, and the in-game teams scoreboard is combat-stats-only —
	// it carries neither hero nor map.
	type tableQueries struct {
		selectHero string
		updateHero string
		selectMap  string
		updateMap  string
	}
	// "Unresolved" is `hero = ''`: empty parser scalars are stored as the
	// literal '' (the columns are NOT NULL DEFAULT '' and the write path no
	// longer NULL-coalesces empties), so a plain equality match suffices.
	queries := []tableQueries{
		{
			selectHero: `SELECT id, hero_raw FROM summary_screenshots WHERE hero = '' AND hero_raw != ''`,
			updateHero: `UPDATE summary_screenshots SET hero = ? WHERE id = ?`,
			selectMap:  `SELECT id, map_raw FROM summary_screenshots WHERE map = '' AND map_raw != ''`,
			updateMap:  `UPDATE summary_screenshots SET map = ? WHERE id = ?`,
		},
		{
			selectHero: `SELECT id, hero_raw FROM personal_screenshots WHERE hero = '' AND hero_raw != ''`,
			updateHero: `UPDATE personal_screenshots SET hero = ? WHERE id = ?`,
			// personal_screenshots has no map column.
		},
	}

	promoted := 0
	for _, q := range queries {
		heroN, err := promoteColumn(tx, q.selectHero, q.updateHero, heroFn)
		if err != nil {
			return 0, err
		}
		mapN, err := promoteColumn(tx, q.selectMap, q.updateMap, mapFn)
		if err != nil {
			return 0, err
		}
		promoted += heroN + mapN
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return promoted, nil
}
