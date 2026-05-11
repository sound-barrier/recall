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
	"strings"
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
	// Two-pass merge: first by filename timestamp (catches sequential
	// SUMMARY/TEAMS/PERSONAL clicks of one match), then by (E, A, D)
	// signature (catches a mid-match scoreboard screenshot paired with the
	// post-match summary taken minutes or hours later). The two passes are
	// complementary — timestamp grouping doesn't span across long gaps, and
	// E/A/D-based merging doesn't catch PERSONAL screenshots (no stats).
	rows := mergeByTimestamp(results)
	rows = mergeByStatsSignature(rows)
	for _, row := range rows {
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

// fileEntry pairs a screenshot filename with its parsed result and the
// timestamp extracted from its filename. Defined at package level so
// splitByMatchMetadata can take a slice of it.
type fileEntry struct {
	file string
	ts   time.Time
	res  *parser.MatchResult
}

// mergeByTimestamp groups screenshots taken within mergeWindow of each other
// (in filename-timestamp order) and merges each group into one row. Files
// without a parseable timestamp are kept as their own rows so we don't
// silently fold them into an unrelated match.
func mergeByTimestamp(parsed map[string]*parser.MatchResult) []mergedRow {
	var timed []fileEntry
	var loners []string
	for f, r := range parsed {
		if ts, ok := parseFilenameTimestamp(f); ok {
			timed = append(timed, fileEntry{f, ts, r})
		} else {
			loners = append(loners, f)
		}
	}
	sort.Slice(timed, func(i, j int) bool { return timed[i].ts.Before(timed[j].ts) })

	var groups [][]fileEntry
	for _, e := range timed {
		if n := len(groups); n > 0 {
			last := groups[n-1]
			if e.ts.Sub(last[len(last)-1].ts) <= mergeWindow {
				groups[n-1] = append(last, e)
				continue
			}
		}
		groups = append(groups, []fileEntry{e})
	}

	out := make([]mergedRow, 0, len(groups)+len(loners))
	for _, g := range groups {
		// Two distinct matches can fall inside one timestamp window if the
		// user pulls them up back-to-back (e.g. inspecting match history).
		// Split on conflicting (date, finished_at) — those are signed by the
		// SUMMARY screen and are the strongest "this is a different match"
		// signal we have.
		for _, sub := range splitByMatchMetadata(g) {
			var merged parser.MatchResult
			sources := make([]string, 0, len(sub))
			for _, e := range sub {
				sources = append(sources, e.file)
				mergeMatchResult(&merged, e.res)
			}
			out = append(out, mergedRow{
				Key:     "match:" + sub[0].ts.UTC().Format("2006-01-02T15:04:05"),
				Sources: sources,
				Data:    merged,
			})
		}
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

// mergeByStatsSignature folds rows that share the same (E, A, D) signature
// into one, provided their (map, date, finished_at) don't conflict. The
// in-game scoreboard screenshot (mid-match, no SUMMARY metadata) ends up in a
// separate timestamp-window from the corresponding post-match SUMMARY/TEAMS/
// PERSONAL session, but the two are obviously the same match — E/A/D signed
// by both views is the reliable bridge.
func mergeByStatsSignature(rows []mergedRow) []mergedRow {
	// Repeatedly find one mergeable pair and combine it; bail when no pair
	// is mergeable. Transitively merges chains (A↔B, B↔C ⇒ A∪B∪C) without
	// the complexity of a union-find.
	for {
		i, j := findStatsMergePair(rows)
		if i < 0 {
			break
		}
		rows[i] = combineStatsRows(rows[i], rows[j])
		rows = append(rows[:j], rows[j+1:]...)
	}
	return rows
}

func findStatsMergePair(rows []mergedRow) (int, int) {
	for i := range rows {
		for j := i + 1; j < len(rows); j++ {
			if statsRowsMergeable(rows[i], rows[j]) {
				return i, j
			}
		}
	}
	return -1, -1
}

func statsRowsMergeable(a, b mergedRow) bool {
	// Both sides need a non-zero E/A/D signature — a row of all zeros is a
	// parse failure, not a real match, and shouldn't pull other rows in.
	if a.Data.Eliminations == 0 && a.Data.Assists == 0 && a.Data.Deaths == 0 {
		return false
	}
	if b.Data.Eliminations == 0 && b.Data.Assists == 0 && b.Data.Deaths == 0 {
		return false
	}
	if a.Data.Eliminations != b.Data.Eliminations ||
		a.Data.Assists != b.Data.Assists ||
		a.Data.Deaths != b.Data.Deaths {
		return false
	}
	// Sanity check: any field both sides have must agree. Damage/healing/
	// mitigation usually only one side has (post-match SUMMARY doesn't carry
	// them, in-game scoreboard does), but if both do they should match.
	if stringsConflict(a.Data.Map, b.Data.Map) ||
		stringsConflict(a.Data.Date, b.Data.Date) ||
		stringsConflict(a.Data.FinishedAt, b.Data.FinishedAt) ||
		stringsConflict(a.Data.Hero, b.Data.Hero) ||
		intsConflict(a.Data.Damage, b.Data.Damage) ||
		intsConflict(a.Data.Healing, b.Data.Healing) ||
		intsConflict(a.Data.Mitigation, b.Data.Mitigation) {
		return false
	}
	return true
}

func stringsConflict(a, b string) bool { return a != "" && b != "" && a != b }
func intsConflict(a, b int) bool       { return a != 0 && b != 0 && a != b }

func combineStatsRows(a, b mergedRow) mergedRow {
	mergeMatchResult(&a.Data, &b.Data)
	seen := map[string]struct{}{}
	for _, s := range a.Sources {
		seen[s] = struct{}{}
	}
	for _, s := range b.Sources {
		if _, ok := seen[s]; !ok {
			a.Sources = append(a.Sources, s)
			seen[s] = struct{}{}
		}
	}
	sort.Strings(a.Sources)
	// Match key follows the earliest screenshot — ISO timestamps compare
	// lexicographically as chronological, so the smaller string wins.
	if strings.HasPrefix(a.Key, "match:") && strings.HasPrefix(b.Key, "match:") && b.Key < a.Key {
		a.Key = b.Key
	}
	return a
}

// splitByMatchMetadata partitions a timestamp-window group of screenshots
// into one group per distinct (date, finished_at) signature seen on a SUMMARY
// screen inside the group. Screenshots that don't carry that metadata (TEAMS,
// PERSONAL) are assigned to whichever signature group has the closest-in-time
// member — practically, the SUMMARY screenshot from the same match. This
// catches the case where the user pulls up two matches in a row from match
// history within the 2-min merge window.
func splitByMatchMetadata(group []fileEntry) [][]fileEntry {
	type sig struct{ date, finishedAt string }
	var signatures []sig
	hasSig := func(s sig) bool {
		for _, x := range signatures {
			if x == s {
				return true
			}
		}
		return false
	}
	for _, e := range group {
		s := sig{e.res.Date, e.res.FinishedAt}
		if (s.date != "" || s.finishedAt != "") && !hasSig(s) {
			signatures = append(signatures, s)
		}
	}
	if len(signatures) <= 1 {
		return [][]fileEntry{group}
	}

	buckets := make([][]fileEntry, len(signatures))
	var unsigned []fileEntry
	for _, e := range group {
		s := sig{e.res.Date, e.res.FinishedAt}
		assigned := false
		for i, x := range signatures {
			if x == s {
				buckets[i] = append(buckets[i], e)
				assigned = true
				break
			}
		}
		if !assigned {
			unsigned = append(unsigned, e)
		}
	}
	// Assign each unsigned screenshot to the bucket whose closest member
	// (by filename timestamp) is nearest in time. Falls through to bucket 0
	// only when all buckets are empty of timestamps, which can't happen here
	// because every bucket got at least one signed member above.
	for _, e := range unsigned {
		bestIdx := 0
		bestDelta := time.Duration(1<<62 - 1)
		for i, b := range buckets {
			for _, m := range b {
				d := e.ts.Sub(m.ts)
				if d < 0 {
					d = -d
				}
				if d < bestDelta {
					bestDelta = d
					bestIdx = i
				}
			}
		}
		buckets[bestIdx] = append(buckets[bestIdx], e)
	}
	return buckets
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
	if dst.Performance == nil {
		dst.Performance = src.Performance
	}
	// Merge heroes_played by hero name — a multi-hero match has one PERSONAL
	// screenshot per hero, each contributing the stats for its own hero. We
	// can't take the whole list from "first source" (that'd discard later
	// PERSONAL stats) nor append blindly (that'd duplicate heroes already in
	// the SUMMARY's heroes_played list).
	for _, srcHp := range src.HeroesPlayed {
		var match *parser.HeroPlay
		for i := range dst.HeroesPlayed {
			if dst.HeroesPlayed[i].Hero == srcHp.Hero {
				match = &dst.HeroesPlayed[i]
				break
			}
		}
		if match == nil {
			dst.HeroesPlayed = append(dst.HeroesPlayed, srcHp)
			continue
		}
		if match.PercentPlayed == 0 {
			match.PercentPlayed = srcHp.PercentPlayed
		}
		if match.PlayTime == "" {
			match.PlayTime = srcHp.PlayTime
		}
		for k, v := range srcHp.Stats {
			if match.Stats == nil {
				match.Stats = map[string]int{}
			}
			if _, exists := match.Stats[k]; !exists {
				match.Stats[k] = v
			}
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
