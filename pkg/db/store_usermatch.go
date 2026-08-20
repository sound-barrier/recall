package db

import (
	"database/sql"
	"fmt"
	"time"

	"recall/pkg/match"
)

// User match-data override layer — the single store backing both inline edits
// of a parsed match and hand-entered (manual) matches. Mirrors the
// match_annotations store: UPSERT the parent + wholesale delete-then-reinsert
// of every child row in one transaction; Delete cascades via the match_key FK;
// LoadAll fans out one query per table and grafts children back by key. The
// aggregator (pkg/aggregate.AttachUserData) overlays this onto the OCR Data at
// read time, so a match_key here with no screenshot row anywhere IS a manual
// match.

// derivePlayedAtUTC fills the canonical instant from the wall clock the same
// write is carrying, so no caller can update the inputs and leave the output
// stale. Every viewer-clock reader PREFERS played_at_utc over the naive
// date/finished_at beside it, so a corrected date with an untouched instant
// shows the old time behind a ✎ marker — and no client could fix it, because
// played_at_utc is not a field of the override input.
//
// A supplied instant is never second-guessed: a manual entry's comes from the
// wire offset, which is information the wall clock cannot reproduce (the
// offset is not stored anywhere). This only fills a blank.
func derivePlayedAtUTC(d UserMatchData) UserMatchData {
	if d.PlayedAtUTC != nil || d.Date == nil || d.FinishedAt == nil {
		return d
	}
	if t, ok := match.LocalWallClockToUTC(*d.Date, *d.FinishedAt, time.Local); ok {
		utc := t.UTC().Format("2006-01-02T15:04:05Z")
		d.PlayedAtUTC = &utc
	}
	return d
}

func (s *SQLStore) UpsertUserMatchData(d UserMatchData) error {
	d = derivePlayedAtUTC(d)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	// Pointer scalars pass straight through: a nil *string / *int converts to
	// SQL NULL ("not overridden"), a non-nil to the value (so 0 / "" round-trip
	// as real edits).
	//
	// updated_at doubles as a manual match's parsed_at at read time, so a
	// restore replays the instant its bundle carried; every live edit supplies
	// none and gets the server clock, on the insert and the conflict alike.
	if _, err := tx.Exec(
		`INSERT INTO user_match_data (
		   match_key, map, hero, eliminations, assists, deaths, damage, healing,
		   mitigation, result, final_score, date, finished_at, game_length, played_at_utc,
		   rank, level, rank_progress, change_percent, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,`+suppliedInstantOrNow+`)
		 ON CONFLICT(match_key) DO UPDATE SET
		   map=excluded.map, hero=excluded.hero, eliminations=excluded.eliminations,
		   assists=excluded.assists, deaths=excluded.deaths, damage=excluded.damage,
		   healing=excluded.healing, mitigation=excluded.mitigation,
		   result=excluded.result, final_score=excluded.final_score,
		   date=excluded.date, finished_at=excluded.finished_at,
		   game_length=excluded.game_length, played_at_utc=excluded.played_at_utc,
		   rank=excluded.rank, level=excluded.level,
		   rank_progress=excluded.rank_progress, change_percent=excluded.change_percent,
		   updated_at=excluded.updated_at`,
		d.MatchKey, d.Map, d.Hero, d.Eliminations, d.Assists, d.Deaths, d.Damage,
		d.Healing, d.Mitigation, d.Result, d.FinalScore, d.Date, d.FinishedAt,
		d.GameLength, d.PlayedAtUTC, d.Rank, d.Level, d.RankProgress, d.ChangePercent,
		d.UpdatedAt,
	); err != nil {
		return err
	}

	if err := deleteUserMatchChildren(tx, d.MatchKey); err != nil {
		return err
	}
	if err := insertUserMatchHeroes(tx, d.MatchKey, d.Heroes); err != nil {
		return err
	}
	if err := insertUserMatchHeroStats(tx, d.MatchKey, d.HeroStats); err != nil {
		return err
	}
	if err := insertUserMatchSR(tx, d.MatchKey, d.SR); err != nil {
		return err
	}
	if err := insertUserMatchModifiers(tx, d.MatchKey, d.Modifiers); err != nil {
		return err
	}
	return tx.Commit()
}

// deleteUserMatchChildren wipes every child row for the match so the inserts
// that follow replace them wholesale — a re-save that drops a hero must remove
// that hero's old row, which a plain UPSERT wouldn't.
func deleteUserMatchChildren(tx *sql.Tx, matchKey string) error {
	for _, q := range []string{
		`DELETE FROM user_match_heroes WHERE match_key = ?`,
		`DELETE FROM user_match_hero_stats WHERE match_key = ?`,
		`DELETE FROM user_match_sr WHERE match_key = ?`,
		`DELETE FROM user_match_rank_modifiers WHERE match_key = ?`,
	} {
		if _, err := tx.Exec(q, matchKey); err != nil {
			return err
		}
	}
	return nil
}

// The three child inserts below use INSERT OR IGNORE, which the modifiers
// insert further down deliberately does not. The difference is safe here and
// the reason is worth writing down, because it reads as an inconsistency:
// these tables carry no CHECK, and their only other constraint is the FK to
// user_match_data — which cannot fire, since UpsertUserMatchData writes the
// parent row first in the SAME transaction. So OR IGNORE can only suppress the
// composite-PK duplicate, which IS the intended dedupe. The modifiers table
// has a vocabulary CHECK that must surface, hence its ON CONFLICT form.
func insertUserMatchHeroes(tx *sql.Tx, matchKey string, heroes []UserMatchHero) error {
	for _, h := range heroes {
		if h.Hero == "" {
			continue
		}
		// Targeted at the hero key, not OR IGNORE: the roster now carries a
		// second UNIQUE on (match_key, position), and swallowing THAT would
		// drop a hero on the floor instead of refusing a roster that puts two
		// of them in one slot.
		if _, err := tx.Exec(
			`INSERT INTO user_match_heroes (match_key, hero, percent_played, play_time, position)
			 VALUES (?,?,?,?,?)
			 ON CONFLICT(match_key, hero) DO NOTHING`,
			matchKey, h.Hero, h.PercentPlayed, h.PlayTime, h.Position,
		); err != nil {
			return err
		}
	}
	return nil
}

func insertUserMatchHeroStats(tx *sql.Tx, matchKey string, stats []UserMatchHeroStat) error {
	for _, st := range stats {
		if st.Hero == "" || st.StatKey == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO user_match_hero_stats (match_key, hero, stat_key, stat_value)
			 VALUES (?,?,?,?)`,
			matchKey, st.Hero, st.StatKey, st.Value,
		); err != nil {
			return err
		}
	}
	return nil
}

func insertUserMatchSR(tx *sql.Tx, matchKey string, srs []HeroSR) error {
	for _, sr := range srs {
		if sr.Hero == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO user_match_sr (match_key, hero, sr, change) VALUES (?,?,?,?)`,
			matchKey, sr.Hero, sr.SR, sr.Change,
		); err != nil {
			return err
		}
	}
	return nil
}

func insertUserMatchModifiers(tx *sql.Tx, matchKey string, mods []string) error {
	for _, m := range mods {
		if m == "" {
			continue
		}
		// ON CONFLICT DO NOTHING rather than INSERT OR IGNORE: both suppress
		// the duplicate-PK case, but OR IGNORE would also swallow the
		// modifier-vocabulary CHECK violation this table must surface.
		if _, err := tx.Exec(
			`INSERT INTO user_match_rank_modifiers (match_key, modifier) VALUES (?,?)
			 ON CONFLICT(match_key, modifier) DO NOTHING`,
			matchKey, m,
		); err != nil {
			return err
		}
	}
	return nil
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
		        game_length, played_at_utc, rank, level, rank_progress, change_percent, updated_at
		 FROM user_match_data`,
	)
	if err != nil {
		return nil, fmt.Errorf("load user match data: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var d UserMatchData
		if err := rows.Scan(
			&d.MatchKey, &d.Map, &d.Hero, &d.Eliminations, &d.Assists, &d.Deaths,
			&d.Damage, &d.Healing, &d.Mitigation, &d.Result, &d.FinalScore, &d.Date,
			&d.FinishedAt, &d.GameLength, &d.PlayedAtUTC, &d.Rank, &d.Level, &d.RankProgress,
			&d.ChangePercent, &d.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("load user match data: %w", err)
		}
		out[d.MatchKey] = d
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load user match data: %w", err)
	}
	for _, attach := range []func(map[string]UserMatchData) error{
		s.loadUserMatchHeroes, s.loadUserMatchHeroStats,
		s.loadUserMatchSR, s.loadUserMatchModifiers,
	} {
		if err := attach(out); err != nil {
			return nil, fmt.Errorf("load user match data: %w", err)
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
