package db

import "database/sql"

// UpsertPersonal writes a PERSONAL parent row + its personal_hero_stats
// children in one transaction.
func (s *SQLStore) UpsertPersonal(r PersonalRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	err = tx.QueryRow(
		`INSERT INTO personal_screenshots (filename, match_key, screenshots_dir_id, hero, hero_raw)
		VALUES (?,?,?,?,?)
		ON CONFLICT(filename) DO UPDATE SET
			match_key          = excluded.match_key,
			screenshots_dir_id = excluded.screenshots_dir_id,
			hero               = excluded.hero,
			hero_raw           = excluded.hero_raw
		RETURNING id`,
		r.Filename, r.MatchKey, dirIDOrSentinel(r.ScreenshotsDirID), r.Hero, r.HeroRaw,
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM personal_hero_stats WHERE personal_screenshot_id = ?`, id); err != nil {
		return err
	}
	for _, st := range r.HeroStats {
		if _, err := tx.Exec(
			`INSERT INTO personal_hero_stats (personal_screenshot_id, hero, stat_key, stat_value)
			VALUES (?,?,?,?)`,
			id, st.Hero, st.StatKey, st.StatValue,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) loadPersonals() ([]PersonalRow, error) {
	rows, err := s.db.Query(
		`SELECT id, filename, match_key, parsed_at, screenshots_dir_id, hero, hero_raw
		FROM personal_screenshots ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byID := map[int64]*PersonalRow{}
	out := make([]PersonalRow, 0)
	for rows.Next() {
		var r PersonalRow
		var dirID sql.NullInt64
		if err := rows.Scan(&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID, &r.Hero, &r.HeroRaw); err != nil {
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

	hsRows, err := s.db.Query(
		`SELECT personal_screenshot_id, hero, stat_key, stat_value
		FROM personal_hero_stats`,
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
