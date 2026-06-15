package db

// User match-data override layer — the single store backing both inline edits
// of a parsed match and hand-entered (manual) matches. Mirrors the
// match_annotations store: UPSERT the parent + wholesale delete-then-reinsert
// of every child row in one transaction; Delete cascades via the match_key FK;
// LoadAll fans out one query per table and grafts children back by key. The
// aggregator (pkg/aggregate.AttachUserData) overlays this onto the OCR Data at
// read time, so a match_key here with no screenshot row anywhere IS a manual
// match.

func (s *SQLStore) UpsertUserMatchData(d UserMatchData) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Pointer scalars pass straight through: a nil *string / *int converts to
	// SQL NULL ("not overridden"), a non-nil to the value (so 0 / "" round-trip
	// as real edits).
	if _, err := tx.Exec(
		`INSERT INTO user_match_data (
		   match_key, map, hero, eliminations, assists, deaths, damage, healing,
		   mitigation, result, final_score, date, finished_at, game_length,
		   rank, level, rank_progress, change_percent)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
		 ON CONFLICT(match_key) DO UPDATE SET
		   map=excluded.map, hero=excluded.hero, eliminations=excluded.eliminations,
		   assists=excluded.assists, deaths=excluded.deaths, damage=excluded.damage,
		   healing=excluded.healing, mitigation=excluded.mitigation,
		   result=excluded.result, final_score=excluded.final_score,
		   date=excluded.date, finished_at=excluded.finished_at,
		   game_length=excluded.game_length, rank=excluded.rank, level=excluded.level,
		   rank_progress=excluded.rank_progress, change_percent=excluded.change_percent,
		   updated_at=CURRENT_TIMESTAMP`,
		d.MatchKey, d.Map, d.Hero, d.Eliminations, d.Assists, d.Deaths, d.Damage,
		d.Healing, d.Mitigation, d.Result, d.FinalScore, d.Date, d.FinishedAt,
		d.GameLength, d.Rank, d.Level, d.RankProgress, d.ChangePercent,
	); err != nil {
		return err
	}

	for _, q := range []string{
		`DELETE FROM user_match_heroes WHERE match_key = ?`,
		`DELETE FROM user_match_hero_stats WHERE match_key = ?`,
		`DELETE FROM user_match_sr WHERE match_key = ?`,
		`DELETE FROM user_match_rank_modifiers WHERE match_key = ?`,
	} {
		if _, err := tx.Exec(q, d.MatchKey); err != nil {
			return err
		}
	}
	for _, h := range d.Heroes {
		if h.Hero == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO user_match_heroes (match_key, hero, percent_played, play_time, position)
			 VALUES (?,?,?,?,?)`,
			d.MatchKey, h.Hero, h.PercentPlayed, h.PlayTime, h.Position,
		); err != nil {
			return err
		}
	}
	for _, st := range d.HeroStats {
		if st.Hero == "" || st.StatKey == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO user_match_hero_stats (match_key, hero, stat_key, stat_value)
			 VALUES (?,?,?,?)`,
			d.MatchKey, st.Hero, st.StatKey, st.Value,
		); err != nil {
			return err
		}
	}
	for _, sr := range d.SR {
		if sr.Hero == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO user_match_sr (match_key, hero, sr, change) VALUES (?,?,?,?)`,
			d.MatchKey, sr.Hero, sr.SR, sr.Change,
		); err != nil {
			return err
		}
	}
	for _, m := range d.Modifiers {
		if m == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO user_match_rank_modifiers (match_key, modifier) VALUES (?,?)`,
			d.MatchKey, m,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) DeleteUserMatchData(matchKey string) error {
	// Children CASCADE on the match_key FK.
	_, err := s.db.Exec(`DELETE FROM user_match_data WHERE match_key = ?`, matchKey)
	return err
}

func (s *SQLStore) MatchKeyExists(matchKey string) (bool, error) {
	tables := make([]string, 0, len(parentTables)+1)
	tables = append(tables, parentTables...)
	tables = append(tables, "user_match_data")
	for _, t := range tables {
		var exists bool
		// #nosec G202 -- table name comes from a hard-coded slice, not user input.
		if err := s.db.QueryRow(
			`SELECT EXISTS(SELECT 1 FROM `+t+` WHERE match_key = ?)`, matchKey,
		).Scan(&exists); err != nil {
			return false, err
		}
		if exists {
			return true, nil
		}
	}
	return false, nil
}

func (s *SQLStore) LoadAllUserMatchData() (map[string]UserMatchData, error) {
	out := make(map[string]UserMatchData)
	rows, err := s.db.Query(
		`SELECT match_key, map, hero, eliminations, assists, deaths, damage,
		        healing, mitigation, result, final_score, date, finished_at,
		        game_length, rank, level, rank_progress, change_percent, updated_at
		 FROM user_match_data`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var d UserMatchData
		if err := rows.Scan(
			&d.MatchKey, &d.Map, &d.Hero, &d.Eliminations, &d.Assists, &d.Deaths,
			&d.Damage, &d.Healing, &d.Mitigation, &d.Result, &d.FinalScore, &d.Date,
			&d.FinishedAt, &d.GameLength, &d.Rank, &d.Level, &d.RankProgress,
			&d.ChangePercent, &d.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out[d.MatchKey] = d
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, attach := range []func(map[string]UserMatchData) error{
		s.loadUserMatchHeroes, s.loadUserMatchHeroStats,
		s.loadUserMatchSR, s.loadUserMatchModifiers,
	} {
		if err := attach(out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *SQLStore) loadUserMatchHeroes(out map[string]UserMatchData) error {
	rows, err := s.db.Query(
		`SELECT match_key, hero, percent_played, play_time, position
		 FROM user_match_heroes ORDER BY match_key, position, hero`,
	)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var key string
		var h UserMatchHero
		if err := rows.Scan(&key, &h.Hero, &h.PercentPlayed, &h.PlayTime, &h.Position); err != nil {
			return err
		}
		if d, ok := out[key]; ok {
			d.Heroes = append(d.Heroes, h)
			out[key] = d
		}
	}
	return rows.Err()
}

func (s *SQLStore) loadUserMatchHeroStats(out map[string]UserMatchData) error {
	rows, err := s.db.Query(
		`SELECT match_key, hero, stat_key, stat_value
		 FROM user_match_hero_stats ORDER BY match_key, hero, stat_key`,
	)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var key string
		var st UserMatchHeroStat
		if err := rows.Scan(&key, &st.Hero, &st.StatKey, &st.Value); err != nil {
			return err
		}
		if d, ok := out[key]; ok {
			d.HeroStats = append(d.HeroStats, st)
			out[key] = d
		}
	}
	return rows.Err()
}

func (s *SQLStore) loadUserMatchSR(out map[string]UserMatchData) error {
	rows, err := s.db.Query(
		`SELECT match_key, hero, sr, change FROM user_match_sr ORDER BY match_key, hero`,
	)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var key string
		var sr HeroSR
		if err := rows.Scan(&key, &sr.Hero, &sr.SR, &sr.Change); err != nil {
			return err
		}
		if d, ok := out[key]; ok {
			d.SR = append(d.SR, sr)
			out[key] = d
		}
	}
	return rows.Err()
}

func (s *SQLStore) loadUserMatchModifiers(out map[string]UserMatchData) error {
	rows, err := s.db.Query(
		`SELECT match_key, modifier FROM user_match_rank_modifiers ORDER BY match_key, modifier`,
	)
	if err != nil {
		return err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var key, mod string
		if err := rows.Scan(&key, &mod); err != nil {
			return err
		}
		if d, ok := out[key]; ok {
			d.Modifiers = append(d.Modifiers, mod)
			out[key] = d
		}
	}
	return rows.Err()
}
