package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"

	"OWMetrics/backend/db"
	"OWMetrics/backend/parser"
)

type MatchRecord struct {
	ID          int64              `json:"id"`
	MatchKey    string             `json:"match_key"`
	SourceFiles []string           `json:"source_files"`
	Data        parser.MatchResult `json:"data"`
}

type App struct {
	ctx            context.Context
	screenshotsDir string
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	dbDir := filepath.Join("data", "db")
	if err := os.MkdirAll(dbDir, 0700); err != nil {
		log.Fatal("could not create db dir:", err)
	}
	if err := db.Init(filepath.Join(dbDir, "owmetrics.db")); err != nil {
		log.Fatal("could not init db:", err)
	}
	a.screenshotsDir = "screenshots"
}

// ParseScreenshots OCRs every image in screenshots/, then merges results that
// share the same (eliminations, assists, deaths) signature into one DB row.
// The merge is what unifies the post-match SUMMARY screenshot (which has
// map/result/scores/heroes_played/performance but no damage/healing/mit)
// with the corresponding TEAMS scoreboard (which has the inverse) — both views
// of the same match share their E/A/D, so we key on that.
func (a *App) ParseScreenshots() error {
	results, err := parser.ParseScreenshotsDir(a.screenshotsDir)
	if err != nil {
		return err
	}
	for _, row := range mergeByEAD(results) {
		if err := upsertMergedRow(row); err != nil {
			return err
		}
	}
	return nil
}

// GetMatchResults returns all stored, merged match rows.
func (a *App) GetMatchResults() ([]MatchRecord, error) {
	rows, err := db.DB.Query(`SELECT
		id, match_key, source_files,
		map, type, mode, role, hero,
		eliminations, assists, deaths, damage, healing, mitigation,
		result, final_score, date, finished_at, game_length,
		heroes_played, performance
		FROM match_results ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []MatchRecord
	for rows.Next() {
		rec, err := scanMatchRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	return records, rows.Err()
}

// mergedRow is one DB row's worth of merged data: a stable key derived from
// E/A/D, the list of source files that fed it, and the merged stats.
type mergedRow struct {
	Key     string
	Sources []string
	Data    parser.MatchResult
}

// mergeByEAD groups parser results by (E,A,D) and merges each group into one
// row. A result with zero stats (a likely parse failure) is kept as its own
// row so we don't collapse every bad parse into one entry.
func mergeByEAD(parsed map[string]*parser.MatchResult) []mergedRow {
	files := make([]string, 0, len(parsed))
	for f := range parsed {
		files = append(files, f)
	}
	sort.Strings(files)

	type sig struct{ e, a, d, loner int }
	groups := map[sig][]string{}
	var order []sig
	loner := 0
	for _, f := range files {
		r := parsed[f]
		var s sig
		if r.Eliminations == 0 && r.Assists == 0 && r.Deaths == 0 {
			loner++
			s = sig{loner: loner}
		} else {
			s = sig{e: r.Eliminations, a: r.Assists, d: r.Deaths}
		}
		if _, exists := groups[s]; !exists {
			order = append(order, s)
		}
		groups[s] = append(groups[s], f)
	}

	out := make([]mergedRow, 0, len(order))
	for _, s := range order {
		members := groups[s]
		var merged parser.MatchResult
		for _, f := range members {
			mergeMatchResult(&merged, parsed[f])
		}
		var key string
		if s.loner == 0 {
			key = fmt.Sprintf("%d:%d:%d", s.e, s.a, s.d)
		} else {
			// Loners are keyed by filename so re-parses replace the same row
			// rather than accumulating a new row each time.
			key = "unmatched:" + members[0]
		}
		out = append(out, mergedRow{Key: key, Sources: members, Data: merged})
	}
	return out
}

// mergeMatchResult fills empty fields on dst from src — i.e. each field takes
// the first non-zero / non-empty value seen across the merge group. This
// works because the two screenshot types populate disjoint subsets: the
// SUMMARY has map/result/etc., the TEAMS scoreboard has damage/healing/mit.
func mergeMatchResult(dst, src *parser.MatchResult) {
	if dst.Map == "" {
		dst.Map = src.Map
	}
	if dst.Type == "" {
		dst.Type = src.Type
	}
	if dst.Mode == "" {
		dst.Mode = src.Mode
	}
	if dst.Role == "" {
		dst.Role = src.Role
	}
	if dst.Hero == "" {
		dst.Hero = src.Hero
	}
	if dst.Eliminations == 0 {
		dst.Eliminations = src.Eliminations
	}
	if dst.Assists == 0 {
		dst.Assists = src.Assists
	}
	if dst.Deaths == 0 {
		dst.Deaths = src.Deaths
	}
	if dst.Damage == 0 {
		dst.Damage = src.Damage
	}
	if dst.Healing == 0 {
		dst.Healing = src.Healing
	}
	if dst.Mitigation == 0 {
		dst.Mitigation = src.Mitigation
	}
	if dst.Result == "" {
		dst.Result = src.Result
	}
	if dst.FinalScore == "" {
		dst.FinalScore = src.FinalScore
	}
	if dst.Date == "" {
		dst.Date = src.Date
	}
	if dst.FinishedAt == "" {
		dst.FinishedAt = src.FinishedAt
	}
	if dst.GameLength == "" {
		dst.GameLength = src.GameLength
	}
	if len(dst.HeroesPlayed) == 0 {
		dst.HeroesPlayed = src.HeroesPlayed
	}
	if dst.Performance == nil {
		dst.Performance = src.Performance
	}
}

func upsertMergedRow(row mergedRow) error {
	sourcesJSON, err := json.Marshal(row.Sources)
	if err != nil {
		return err
	}
	var heroesJSON, perfJSON sql.NullString
	if len(row.Data.HeroesPlayed) > 0 {
		b, err := json.Marshal(row.Data.HeroesPlayed)
		if err != nil {
			return err
		}
		heroesJSON = sql.NullString{String: string(b), Valid: true}
	}
	if row.Data.Performance != nil {
		b, err := json.Marshal(row.Data.Performance)
		if err != nil {
			return err
		}
		perfJSON = sql.NullString{String: string(b), Valid: true}
	}

	_, err = db.DB.Exec(`INSERT INTO match_results (
		match_key, source_files,
		map, type, mode, role, hero,
		eliminations, assists, deaths, damage, healing, mitigation,
		result, final_score, date, finished_at, game_length,
		heroes_played, performance
	) VALUES (?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?)
	ON CONFLICT(match_key) DO UPDATE SET
		source_files  = excluded.source_files,
		map           = excluded.map,
		type          = excluded.type,
		mode          = excluded.mode,
		role          = excluded.role,
		hero          = excluded.hero,
		eliminations  = excluded.eliminations,
		assists       = excluded.assists,
		deaths        = excluded.deaths,
		damage        = excluded.damage,
		healing       = excluded.healing,
		mitigation    = excluded.mitigation,
		result        = excluded.result,
		final_score   = excluded.final_score,
		date          = excluded.date,
		finished_at   = excluded.finished_at,
		game_length   = excluded.game_length,
		heroes_played = excluded.heroes_played,
		performance   = excluded.performance,
		parsed_at     = CURRENT_TIMESTAMP`,
		row.Key, string(sourcesJSON),
		nullableString(row.Data.Map), nullableString(row.Data.Type),
		nullableString(row.Data.Mode), nullableString(row.Data.Role),
		nullableString(row.Data.Hero),
		row.Data.Eliminations, row.Data.Assists, row.Data.Deaths,
		row.Data.Damage, row.Data.Healing, row.Data.Mitigation,
		nullableString(row.Data.Result), nullableString(row.Data.FinalScore),
		nullableString(row.Data.Date), nullableString(row.Data.FinishedAt),
		nullableString(row.Data.GameLength),
		heroesJSON, perfJSON,
	)
	return err
}

func scanMatchRecord(rows *sql.Rows) (MatchRecord, error) {
	var rec MatchRecord
	var sourcesJSON string
	var mapCol, typeCol, mode, role, hero sql.NullString
	var result, finalScore, date, finishedAt, gameLength sql.NullString
	var heroesJSON, perfJSON sql.NullString
	err := rows.Scan(
		&rec.ID, &rec.MatchKey, &sourcesJSON,
		&mapCol, &typeCol, &mode, &role, &hero,
		&rec.Data.Eliminations, &rec.Data.Assists, &rec.Data.Deaths,
		&rec.Data.Damage, &rec.Data.Healing, &rec.Data.Mitigation,
		&result, &finalScore, &date, &finishedAt, &gameLength,
		&heroesJSON, &perfJSON,
	)
	if err != nil {
		return rec, err
	}
	if err := json.Unmarshal([]byte(sourcesJSON), &rec.SourceFiles); err != nil {
		return rec, err
	}
	rec.Data.Map = mapCol.String
	rec.Data.Type = typeCol.String
	rec.Data.Mode = mode.String
	rec.Data.Role = role.String
	rec.Data.Hero = hero.String
	rec.Data.Result = result.String
	rec.Data.FinalScore = finalScore.String
	rec.Data.Date = date.String
	rec.Data.FinishedAt = finishedAt.String
	rec.Data.GameLength = gameLength.String
	if heroesJSON.Valid && heroesJSON.String != "" {
		_ = json.Unmarshal([]byte(heroesJSON.String), &rec.Data.HeroesPlayed)
	}
	if perfJSON.Valid && perfJSON.String != "" {
		_ = json.Unmarshal([]byte(perfJSON.String), &rec.Data.Performance)
	}
	return rec, nil
}

func nullableString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
