package db

import "database/sql"

// UpsertScoreboard writes a SCOREBOARD parent row + its
// scoreboard_hero_stats children in one transaction.
func (s *SQLStore) UpsertScoreboard(r ScoreboardRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO scoreboard_screenshots (
			filename, match_key, screenshots_dir_id,
			map, mode, hero,
			eliminations, assists, deaths, damage, healing, mitigation
		) VALUES (?,?,?, ?,?,?, ?,?,?,?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			map          = excluded.map,
			mode         = excluded.mode,
			hero         = excluded.hero,
			eliminations = excluded.eliminations,
			assists      = excluded.assists,
			deaths       = excluded.deaths,
			damage       = excluded.damage,
			healing      = excluded.healing,
			mitigation   = excluded.mitigation
		RETURNING id`,
		r.Filename, r.MatchKey, nullableInt64(r.ScreenshotsDirID),
		nullableString(r.Map), nullableString(r.Mode), nullableString(r.Hero),
		r.Eliminations, r.Assists, r.Deaths, r.Damage, r.Healing, r.Mitigation,
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM scoreboard_hero_stats WHERE scoreboard_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, st := range r.HeroStats {
		if _, err := tx.Exec(
			`INSERT INTO scoreboard_hero_stats (scoreboard_screenshot_id, hero, stat_key, stat_value)
			VALUES (?,?,?,?)`,
			id, st.Hero, st.StatKey, st.StatValue,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) loadScoreboards() ([]ScoreboardRow, error) {
	rows, err := s.db.Query(`SELECT
		id, filename, match_key, parsed_at, screenshots_dir_id,
		map, mode, hero,
		eliminations, assists, deaths, damage, healing, mitigation
		FROM scoreboard_screenshots ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*ScoreboardRow{}
	out := make([]ScoreboardRow, 0)
	for rows.Next() {
		var r ScoreboardRow
		var dirID sql.NullInt64
		var mapC, mode, hero sql.NullString
		if err := rows.Scan(
			&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID,
			&mapC, &mode, &hero,
			&r.Eliminations, &r.Assists, &r.Deaths,
			&r.Damage, &r.Healing, &r.Mitigation,
		); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		r.Map = mapC.String
		r.Mode = mode.String
		r.Hero = hero.String
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}

	hsRows, err := s.db.Query(
		`SELECT scoreboard_screenshot_id, hero, stat_key, stat_value
		FROM scoreboard_hero_stats`,
	)
	if err != nil {
		return nil, err
	}
	defer hsRows.Close()
	for hsRows.Next() {
		var id int64
		var h HeroStat
		if err := hsRows.Scan(&id, &h.Hero, &h.StatKey, &h.StatValue); err != nil {
			return nil, err
		}
		if parent, ok := byID[id]; ok {
			parent.HeroStats = append(parent.HeroStats, h)
		}
	}
	return out, hsRows.Err()
}
