package db

import "database/sql"

// UpsertRank writes a RANK parent row + its rank_modifiers and rank_sr
// children in one transaction. Both child sets use DELETE-then-INSERT.
func (s *SQLStore) UpsertRank(r RankRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO rank_screenshots (
			filename, match_key, screenshots_dir_id, parsed_at,
			rank, level, rank_progress, change_percent, result, rank_percentile
		) VALUES (?,?,?,`+suppliedInstantOrNow+`, ?,?,?,?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			rank           = excluded.rank,
			level          = excluded.level,
			rank_progress  = excluded.rank_progress,
			change_percent = excluded.change_percent,
			result         = excluded.result,
			-- In the SET clause on purpose: a re-parse whose caption is no
			-- longer readable must write NULL back, not leave a stale
			-- percentile attached to a row that no longer supports it.
			rank_percentile = excluded.rank_percentile
		RETURNING id`,
		r.Filename, r.MatchKey, dirIDOrSentinel(r.ScreenshotsDirID), r.ParsedAt,
		r.Rank, r.Level, r.RankProgress, r.ChangePercent,
		r.Result, r.RankPercentile,
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM rank_modifiers WHERE rank_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, m := range r.Modifiers {
		if _, err := tx.Exec(
			`INSERT INTO rank_modifiers (rank_screenshot_id, modifier) VALUES (?,?)`,
			id, m,
		); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(`DELETE FROM rank_sr WHERE rank_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, sr := range r.SR {
		if _, err := tx.Exec(
			`INSERT INTO rank_sr (rank_screenshot_id, hero, sr, change) VALUES (?,?,?,?)`,
			id, sr.Hero, sr.SR, sr.Change,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func loadRanks(q querier) ([]RankRow, error) {
	rows, err := q.Query(`SELECT
		id, filename, match_key, parsed_at, screenshots_dir_id,
		rank, level, rank_progress, change_percent, result, rank_percentile
		FROM rank_screenshots ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*RankRow{}
	out := make([]RankRow, 0)
	for rows.Next() {
		var r RankRow
		var dirID sql.NullInt64
		var percentile sql.NullInt64
		if err := rows.Scan(
			&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID,
			&r.Rank, &r.Level, &r.RankProgress, &r.ChangePercent, &r.Result,
			&percentile,
		); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		if percentile.Valid {
			pct := int(percentile.Int64)
			r.RankPercentile = &pct
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}

	if err := attachRankModifiers(q, byID); err != nil {
		return nil, err
	}
	if err := attachRankSR(q, byID); err != nil {
		return nil, err
	}
	return out, nil
}

// attachRankModifiers folds rank_modifiers child rows onto their parents
// (one bulk SELECT; own function so one defer covers every return —
// the sqlclosecheck pattern).
func attachRankModifiers(q querier, byID map[int64]*RankRow) error {
	rows, err := q.Query(`SELECT rank_screenshot_id, modifier FROM rank_modifiers`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var m string
		if err := rows.Scan(&id, &m); err != nil {
			return err
		}
		if parent, ok := byID[id]; ok {
			parent.Modifiers = append(parent.Modifiers, m)
		}
	}
	return rows.Err()
}

// attachRankSR folds rank_sr child rows onto their parents.
func attachRankSR(q querier, byID map[int64]*RankRow) error {
	rows, err := q.Query(`SELECT rank_screenshot_id, hero, sr, change FROM rank_sr`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var sr HeroSR
		if err := rows.Scan(&id, &sr.Hero, &sr.SR, &sr.Change); err != nil {
			return err
		}
		if parent, ok := byID[id]; ok {
			parent.SR = append(parent.SR, sr)
		}
	}
	return rows.Err()
}
