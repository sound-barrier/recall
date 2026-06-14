package db

import "database/sql"

// UpsertSummary writes a SUMMARY parent row + its summary_heroes_played
// children inside a single transaction. ON CONFLICT(filename) updates
// every scalar except parsed_at (preserves the first-insert timestamp
// across re-parses). Children use DELETE-then-INSERT — see the package
// comment on store.go for why.
func (s *SQLStore) UpsertSummary(r SummaryRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO summary_screenshots (
			filename, match_key, screenshots_dir_id,
			map, map_raw, playlist, hero, hero_raw, result, final_score, date, finished_at, game_length,
			perf_elim_total, perf_elim_avg_per_10min,
			perf_assists_total, perf_assists_avg_per_10min,
			perf_deaths_total, perf_deaths_avg_per_10min
		) VALUES (?,?,?, ?,?,?,?,?,?,?,?,?,?, ?,?, ?,?, ?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			map         = excluded.map,
			map_raw     = excluded.map_raw,
			playlist        = excluded.playlist,
			hero        = excluded.hero,
			hero_raw    = excluded.hero_raw,
			result      = excluded.result,
			final_score = excluded.final_score,
			date        = excluded.date,
			finished_at = excluded.finished_at,
			game_length = excluded.game_length,
			perf_elim_total            = excluded.perf_elim_total,
			perf_elim_avg_per_10min    = excluded.perf_elim_avg_per_10min,
			perf_assists_total         = excluded.perf_assists_total,
			perf_assists_avg_per_10min = excluded.perf_assists_avg_per_10min,
			perf_deaths_total          = excluded.perf_deaths_total,
			perf_deaths_avg_per_10min  = excluded.perf_deaths_avg_per_10min
		RETURNING id`,
		r.Filename, r.MatchKey, dirIDOrSentinel(r.ScreenshotsDirID),
		r.Map, r.MapRaw, r.Playlist, r.Hero, r.HeroRaw,
		r.Result, r.FinalScore,
		r.Date, r.FinishedAt, r.GameLength,
		r.PerfElimTotal, r.PerfElimAvgPer10Min,
		r.PerfAssistsTotal, r.PerfAssistsAvgPer10Min,
		r.PerfDeathsTotal, r.PerfDeathsAvgPer10Min,
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM summary_heroes_played WHERE summary_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, h := range r.HeroesPlayed {
		if _, err := tx.Exec(
			`INSERT INTO summary_heroes_played (summary_screenshot_id, hero, percent_played, play_time)
			VALUES (?,?,?,?)`,
			id, h.Hero, h.PercentPlayed, h.PlayTime,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) loadSummaries() ([]SummaryRow, error) {
	rows, err := s.db.Query(`SELECT
		id, filename, match_key, parsed_at, screenshots_dir_id,
		map, map_raw, playlist, hero, hero_raw, result, final_score, date, finished_at, game_length,
		perf_elim_total, perf_elim_avg_per_10min,
		perf_assists_total, perf_assists_avg_per_10min,
		perf_deaths_total, perf_deaths_avg_per_10min
		FROM summary_screenshots ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*SummaryRow{}
	out := make([]SummaryRow, 0)
	for rows.Next() {
		var r SummaryRow
		var dirID sql.NullInt64
		if err := rows.Scan(
			&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID,
			&r.Map, &r.MapRaw, &r.Playlist, &r.Hero, &r.HeroRaw, &r.Result, &r.FinalScore, &r.Date, &r.FinishedAt, &r.GameLength,
			&r.PerfElimTotal, &r.PerfElimAvgPer10Min,
			&r.PerfAssistsTotal, &r.PerfAssistsAvgPer10Min,
			&r.PerfDeathsTotal, &r.PerfDeathsAvgPer10Min,
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

	hpRows, err := s.db.Query(
		`SELECT summary_screenshot_id, hero, percent_played, play_time
		FROM summary_heroes_played`,
	)
	if err != nil {
		return nil, err
	}
	defer hpRows.Close()
	for hpRows.Next() {
		var id int64
		var h SummaryHeroPlayed
		if err := hpRows.Scan(&id, &h.Hero, &h.PercentPlayed, &h.PlayTime); err != nil {
			return nil, err
		}
		if parent, ok := byID[id]; ok {
			parent.HeroesPlayed = append(parent.HeroesPlayed, h)
		}
	}
	return out, hpRows.Err()
}
