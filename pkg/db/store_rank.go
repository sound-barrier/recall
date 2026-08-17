package db

import (
	"database/sql"

	"recall/pkg/applog"
)

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
			rank, level, rank_progress, change_percent, result, rank_percentile,
			parser_generation
		) VALUES (?,?,?,`+suppliedInstantOrNow+`, ?,?,?,?,?,?,?)
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
			rank_percentile = excluded.rank_percentile,
			parser_generation = excluded.parser_generation
		RETURNING id`,
		r.Filename, r.MatchKey, dirIDOrSentinel(r.ScreenshotsDirID), r.ParsedAt,
		r.Rank, r.Level, r.RankProgress, r.ChangePercent,
		r.Result, r.RankPercentile, r.ParserGeneration,
	).Scan(&id)
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`DELETE FROM rank_modifiers WHERE rank_screenshot_id = ?`, id); err != nil {
		return err
	}
	// A rejected modifier is LOGGED AND SKIPPED rather than returned, and this
	// is the one place in this function that tolerates a child failure.
	//
	// The vocabulary is not fixed at compile time. owdata.go loads
	// modifiers.yaml through the user-override path at RUNTIME, so the parser
	// can emit a modifier this database's CHECK — frozen in its DDL when the
	// table was created — has never heard of, with no version skew involved.
	// SQLite cannot widen a CHECK afterwards: schema.sql is applied with
	// CREATE TABLE IF NOT EXISTS, additiveColumns handles nullable columns
	// only, and migrate.go is inert pre-1.0.
	//
	// Returning the error here rolled the whole transaction back, so ONE
	// unrecognized chip discarded the entire rank row — tier, division,
	// progress, SR, percentile — and pkg/app had already cleared the file from
	// the failed-files ledger by this point, so it surfaced nowhere at all.
	//
	// A modifier is an annotation; a rank row is the measurement. Losing the
	// measurement to protect the annotation is the wrong trade at any
	// severity. The SR loop below deliberately still returns: this is a
	// targeted exception, not permission to ignore write errors.
	for _, m := range r.Modifiers {
		if _, err := tx.Exec(
			`INSERT INTO rank_modifiers (rank_screenshot_id, modifier) VALUES (?,?)`,
			id, m,
		); err != nil {
			applog.Subsystem("db").Warn("rank modifier not stored; keeping the rank row",
				"modifier", m, "filename", r.Filename, "err", err)
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
		var dirID, progress, change, percentile sql.NullInt64
		if err := rows.Scan(
			&r.ID, &r.Filename, &r.MatchKey, &r.ParsedAt, &dirID,
			&r.Rank, &r.Level, &progress, &change, &r.Result,
			&percentile,
		); err != nil {
			return nil, err
		}
		r.ScreenshotsDirID = dirID.Int64
		r.RankProgress = nullableInt(progress)
		r.ChangePercent = nullableInt(change)
		r.RankPercentile = nullableInt(percentile)
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

// nullableInt turns a scanned nullable INTEGER into the pointer its row field
// carries, so NULL survives the round trip as nil rather than collapsing to 0.
// Three rank columns need exactly this (progress, movement, percentile), each
// because 0 is a real reading they must not be confused with.
func nullableInt(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}
