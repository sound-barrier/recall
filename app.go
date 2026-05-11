package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"time"

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

// ParseScreenshots OCRs every image in screenshots/ and merges results from
// screenshots taken close together (within mergeWindow) into one DB row.
// SUMMARY, TEAMS, and PERSONAL screenshots populate disjoint subsets of
// fields; the user typically takes them within a few seconds by cycling the
// post-match tabs, so the filename timestamp is the most reliable correlation
// signal — PERSONAL has no E/A/D, so a stats-based key wouldn't catch it.
func (a *App) ParseScreenshots() error {
	results, err := parser.ParseScreenshotsDir(a.screenshotsDir)
	if err != nil {
		return err
	}
	for _, row := range mergeByTimestamp(results) {
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
		heroes_played, performance, personal_stats
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

// mergeWindow is how close two screenshot filenames must be in time to count
// as belonging to the same match. 2 minutes is generous enough to absorb a
// slow tab-cycler but tight enough that two separate matches never collide.
const mergeWindow = 2 * time.Minute

var filenameTimestampRe = regexp.MustCompile(`(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})`)

// parseFilenameTimestamp extracts the YYYY.MM.DD - HH.MM.SS portion the OW2
// client embeds in its screenshot filenames. Returns ok=false for filenames
// that don't carry a timestamp (manually renamed files, screenshots from
// other tools) so they get their own row instead of merging with whatever
// timestamped file happens to be nearest.
func parseFilenameTimestamp(f string) (time.Time, bool) {
	m := filenameTimestampRe.FindStringSubmatch(f)
	if m == nil {
		return time.Time{}, false
	}
	s := fmt.Sprintf("%s-%s-%sT%s:%s:%sZ", m[1], m[2], m[3], m[4], m[5], m[6])
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// mergeByTimestamp groups screenshots taken within mergeWindow of each other
// (in filename-timestamp order) and merges each group into one row. Files
// without a parseable timestamp are kept as their own rows so we don't
// silently fold them into an unrelated match.
func mergeByTimestamp(parsed map[string]*parser.MatchResult) []mergedRow {
	type entry struct {
		file string
		ts   time.Time
		res  *parser.MatchResult
	}
	var timed []entry
	var loners []string
	for f, r := range parsed {
		if ts, ok := parseFilenameTimestamp(f); ok {
			timed = append(timed, entry{f, ts, r})
		} else {
			loners = append(loners, f)
		}
	}
	sort.Slice(timed, func(i, j int) bool { return timed[i].ts.Before(timed[j].ts) })

	var groups [][]entry
	for _, e := range timed {
		if n := len(groups); n > 0 {
			last := groups[n-1]
			if e.ts.Sub(last[len(last)-1].ts) <= mergeWindow {
				groups[n-1] = append(last, e)
				continue
			}
		}
		groups = append(groups, []entry{e})
	}

	out := make([]mergedRow, 0, len(groups)+len(loners))
	for _, g := range groups {
		var merged parser.MatchResult
		sources := make([]string, 0, len(g))
		for _, e := range g {
			sources = append(sources, e.file)
			mergeMatchResult(&merged, e.res)
		}
		out = append(out, mergedRow{
			Key:     "match:" + g[0].ts.UTC().Format("2006-01-02T15:04:05"),
			Sources: sources,
			Data:    merged,
		})
	}
	sort.Strings(loners)
	for _, f := range loners {
		out = append(out, mergedRow{
			Key:     "unmatched:" + f,
			Sources: []string{f},
			Data:    *parsed[f],
		})
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
	for k, v := range src.PersonalStats {
		if dst.PersonalStats == nil {
			dst.PersonalStats = map[string]int{}
		}
		if _, exists := dst.PersonalStats[k]; !exists {
			dst.PersonalStats[k] = v
		}
	}
}

func upsertMergedRow(row mergedRow) error {
	sourcesJSON, err := json.Marshal(row.Sources)
	if err != nil {
		return err
	}
	heroesJSON, err := jsonNullable(row.Data.HeroesPlayed, len(row.Data.HeroesPlayed) > 0)
	if err != nil {
		return err
	}
	perfJSON, err := jsonNullable(row.Data.Performance, row.Data.Performance != nil)
	if err != nil {
		return err
	}
	personalJSON, err := jsonNullable(row.Data.PersonalStats, len(row.Data.PersonalStats) > 0)
	if err != nil {
		return err
	}

	_, err = db.DB.Exec(`INSERT INTO match_results (
		match_key, source_files,
		map, type, mode, role, hero,
		eliminations, assists, deaths, damage, healing, mitigation,
		result, final_score, date, finished_at, game_length,
		heroes_played, performance, personal_stats
	) VALUES (?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?,?)
	ON CONFLICT(match_key) DO UPDATE SET
		source_files   = excluded.source_files,
		map            = excluded.map,
		type           = excluded.type,
		mode           = excluded.mode,
		role           = excluded.role,
		hero           = excluded.hero,
		eliminations   = excluded.eliminations,
		assists        = excluded.assists,
		deaths         = excluded.deaths,
		damage         = excluded.damage,
		healing        = excluded.healing,
		mitigation     = excluded.mitigation,
		result         = excluded.result,
		final_score    = excluded.final_score,
		date           = excluded.date,
		finished_at    = excluded.finished_at,
		game_length    = excluded.game_length,
		heroes_played  = excluded.heroes_played,
		performance    = excluded.performance,
		personal_stats = excluded.personal_stats,
		parsed_at      = CURRENT_TIMESTAMP`,
		row.Key, string(sourcesJSON),
		nullableString(row.Data.Map), nullableString(row.Data.Type),
		nullableString(row.Data.Mode), nullableString(row.Data.Role),
		nullableString(row.Data.Hero),
		row.Data.Eliminations, row.Data.Assists, row.Data.Deaths,
		row.Data.Damage, row.Data.Healing, row.Data.Mitigation,
		nullableString(row.Data.Result), nullableString(row.Data.FinalScore),
		nullableString(row.Data.Date), nullableString(row.Data.FinishedAt),
		nullableString(row.Data.GameLength),
		heroesJSON, perfJSON, personalJSON,
	)
	return err
}

func jsonNullable(v any, present bool) (sql.NullString, error) {
	if !present {
		return sql.NullString{}, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: string(b), Valid: true}, nil
}

func scanMatchRecord(rows *sql.Rows) (MatchRecord, error) {
	var rec MatchRecord
	var sourcesJSON string
	var mapCol, typeCol, mode, role, hero sql.NullString
	var result, finalScore, date, finishedAt, gameLength sql.NullString
	var heroesJSON, perfJSON, personalJSON sql.NullString
	err := rows.Scan(
		&rec.ID, &rec.MatchKey, &sourcesJSON,
		&mapCol, &typeCol, &mode, &role, &hero,
		&rec.Data.Eliminations, &rec.Data.Assists, &rec.Data.Deaths,
		&rec.Data.Damage, &rec.Data.Healing, &rec.Data.Mitigation,
		&result, &finalScore, &date, &finishedAt, &gameLength,
		&heroesJSON, &perfJSON, &personalJSON,
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
	if personalJSON.Valid && personalJSON.String != "" {
		_ = json.Unmarshal([]byte(personalJSON.String), &rec.Data.PersonalStats)
	}
	return rec, nil
}

func nullableString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
