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
			filename, match_key, screenshots_dir_id,
			rank, level, rank_progress, change_percent, result
		) VALUES (?,?,?, ?,?,?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			rank           = excluded.rank,
			level          = excluded.level,
			rank_progress  = excluded.rank_progress,
			change_percent = excluded.change_percent,
			result         = excluded.result
		RETURNING id`,
		r.Filename, r.MatchKey, dirIDOrSentinel(r.ScreenshotsDirID),
		nullableString(r.Rank), r.Level, r.RankProgress, r.ChangePercent,
		nullableString(r.Result),
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

func (s *SQLStore) loadRanks() ([]RankRow, error) {
	rows, err := s.db.Query(`SELECT
		id, filename, match_key, parsed_at, screenshots_dir_id,
		rank, level, rank_progress, change_percent, result
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
		var rank, result sql.NullString
		if err := rows.Scan(
			&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID,
			&rank, &r.Level, &r.RankProgress, &r.ChangePercent, &result,
		); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		r.Rank = rank.String
		r.Result = result.String
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}

	modRows, err := s.db.Query(`SELECT rank_screenshot_id, modifier FROM rank_modifiers`)
	if err != nil {
		return nil, err
	}
	defer modRows.Close()
	for modRows.Next() {
		var id int64
		var m string
		if err := modRows.Scan(&id, &m); err != nil {
			return nil, err
		}
		if parent, ok := byID[id]; ok {
			parent.Modifiers = append(parent.Modifiers, m)
		}
	}
	if err := modRows.Err(); err != nil {
		return nil, err
	}

	srRows, err := s.db.Query(`SELECT rank_screenshot_id, hero, sr, change FROM rank_sr`)
	if err != nil {
		return nil, err
	}
	defer srRows.Close()
	for srRows.Next() {
		var id int64
		var sr HeroSR
		if err := srRows.Scan(&id, &sr.Hero, &sr.SR, &sr.Change); err != nil {
			return nil, err
		}
		if parent, ok := byID[id]; ok {
			parent.SR = append(parent.SR, sr)
		}
	}
	return out, srRows.Err()
}
