package db

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

	type pending struct {
		id  int64
		val string
	}
	// collectPending opens the SELECT inside its own scope so the
	// single `defer rows.Close()` covers every return (sqlclosecheck).
	// Returns the list of (id, canonical) pairs that resolved this
	// pass; the caller batches the UPDATE statements outside this scope.
	collectPending := func(query string, fn func(string) string) ([]pending, error) {
		rows, qerr := tx.Query(query)
		if qerr != nil {
			return nil, qerr
		}
		defer func() { _ = rows.Close() }()
		var out []pending
		for rows.Next() {
			var id int64
			var raw string
			if err := rows.Scan(&id, &raw); err != nil {
				return nil, err
			}
			if canonical := fn(raw); canonical != "" {
				out = append(out, pending{id: id, val: canonical})
			}
		}
		return out, rows.Err()
	}

	// Hard-coded SELECT/UPDATE SQL per table keeps the table name
	// out of any concatenated query string — gosec G202 then has
	// nothing to flag. The three parent tables that carry hero_raw
	// (summary / teams / personal) each get their own pair;
	// the two that carry map_raw (summary / teams) get the map
	// pair. Personal doesn't have a map column.
	type tableQueries struct {
		selectHero string
		updateHero string
		selectMap  string
		updateMap  string
	}
	queries := []tableQueries{
		{
			selectHero: `SELECT id, hero_raw FROM summary_screenshots WHERE hero = '' AND hero_raw != ''`,
			updateHero: `UPDATE summary_screenshots SET hero = ? WHERE id = ?`,
			selectMap:  `SELECT id, map_raw FROM summary_screenshots WHERE map = '' AND map_raw != ''`,
			updateMap:  `UPDATE summary_screenshots SET map = ? WHERE id = ?`,
		},
		{
			selectHero: `SELECT id, hero_raw FROM teams_screenshots WHERE hero = '' AND hero_raw != ''`,
			updateHero: `UPDATE teams_screenshots SET hero = ? WHERE id = ?`,
			selectMap:  `SELECT id, map_raw FROM teams_screenshots WHERE map = '' AND map_raw != ''`,
			updateMap:  `UPDATE teams_screenshots SET map = ? WHERE id = ?`,
		},
		{
			selectHero: `SELECT id, hero_raw FROM personal_screenshots WHERE hero = '' AND hero_raw != ''`,
			updateHero: `UPDATE personal_screenshots SET hero = ? WHERE id = ?`,
			// personal_screenshots has no map column.
		},
	}

	promoted := 0
	for _, q := range queries {
		if q.selectHero != "" {
			todo, err := collectPending(q.selectHero, heroFn)
			if err != nil {
				return 0, err
			}
			for _, p := range todo {
				if _, err := tx.Exec(q.updateHero, p.val, p.id); err != nil {
					return 0, err
				}
				promoted++
			}
		}
		if q.selectMap != "" {
			todo, err := collectPending(q.selectMap, mapFn)
			if err != nil {
				return 0, err
			}
			for _, p := range todo {
				if _, err := tx.Exec(q.updateMap, p.val, p.id); err != nil {
					return 0, err
				}
				promoted++
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return promoted, nil
}
