package db

import "database/sql"

// UpsertTeams writes a TEAMS parent row + its
// teams_hero_stats children in one transaction.
func (s *SQLStore) UpsertTeams(r TeamsRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO teams_screenshots (
			filename, match_key, screenshots_dir_id, parsed_at,
			eliminations, assists, deaths, damage, healing, mitigation, queue_type,
			parser_generation
		) VALUES (?,?,?,`+suppliedInstantOrNow+`, ?,?,?,?,?,?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			eliminations = excluded.eliminations,
			assists      = excluded.assists,
			deaths       = excluded.deaths,
			damage       = excluded.damage,
			healing      = excluded.healing,
			mitigation   = excluded.mitigation,
			queue_type   = excluded.queue_type,
			-- In the SET clause: a re-parse re-reads the screenshot, so the row's
			-- vintage becomes the CURRENT generation, not the one it first had.
			parser_generation = excluded.parser_generation
		RETURNING id`,
		r.Filename, r.MatchKey, dirIDOrSentinel(r.ScreenshotsDirID), r.ParsedAt,
		r.Eliminations, r.Assists, r.Deaths, r.Damage, r.Healing, r.Mitigation, r.QueueType,
		r.ParserGeneration,
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM teams_hero_stats WHERE teams_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, st := range r.HeroStats {
		if _, err := tx.Exec(
			`INSERT INTO teams_hero_stats (teams_screenshot_id, hero, stat_key, stat_value)
			VALUES (?,?,?,?)`,
			id, st.Hero, st.StatKey, st.StatValue,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func loadTeams(q querier) ([]TeamsRow, error) {
	rows, err := q.Query(`SELECT
		id, filename, match_key, parsed_at, screenshots_dir_id,
		eliminations, assists, deaths, damage, healing, mitigation, queue_type,
		-- COALESCE: a row written before the column existed reports 0, which is
		-- stale by definition — the same reading NULL carries in StaleParseCount.
		COALESCE(parser_generation, 0)
		FROM teams_screenshots ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*TeamsRow{}
	out := make([]TeamsRow, 0)
	for rows.Next() {
		var r TeamsRow
		var dirID sql.NullInt64
		if err := rows.Scan(
			&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID,
			&r.Eliminations, &r.Assists, &r.Deaths,
			&r.Damage, &r.Healing, &r.Mitigation, &r.QueueType, &r.ParserGeneration,
		); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}

	hsRows, err := q.Query(
		`SELECT teams_screenshot_id, hero, stat_key, stat_value
		FROM teams_hero_stats`,
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
