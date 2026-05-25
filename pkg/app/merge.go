package app

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// mergedRow is one DB row's worth of merged data: a stable key derived from
// E/A/D, the list of source files that fed it, and the merged stats.
// Types carries per-source-file screenshot type (parallel to Sources) so
// each filename can be labeled in the UI. ParsedAt is a parallel map of
// filename → ISO8601 first-insert timestamp; merge functions preserve
// existing entries so re-parsing never bumps a file's recorded stamp.
type mergedRow struct {
	Key      string
	Sources  []string
	Types    map[string]string
	ParsedAt map[string]string
	Data     parser.MatchResult
}

// mergeWindow is how close two screenshot filenames must be in time to count
// as belonging to the same match. 2 minutes is generous enough to absorb a
// slow tab-cycler but tight enough that two separate matches never collide.
const mergeWindow = 2 * time.Minute

var filenameTimestampRe = regexp.MustCompile(`(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})`)

// parseFilenameTimestamp extracts the YYYY.MM.DD - HH.MM.SS portion the OW
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
//
// stamps is a parallel map of filename → ISO8601 first-parsed timestamp,
// populated by ParseScreenshots when it stamps the OCR'd files with
// time.Now() before merging. Each built mergedRow carries a ParsedAt
// map derived from stamps for its source files. Nil stamps map is
// allowed for callers (test fixtures) that don't care about timestamps;
// the resulting ParsedAt maps are also nil.
func mergeByTimestamp(parsed map[string]*parser.MatchResult, stamps map[string]string) []mergedRow {
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

	// stampsFor returns a per-file ParsedAt map for the given source
	// files, or nil if stamps wasn't provided (test-fixture path).
	stampsFor := func(files []string) map[string]string {
		if stamps == nil {
			return nil
		}
		m := make(map[string]string, len(files))
		for _, f := range files {
			if v, ok := stamps[f]; ok {
				m[f] = v
			}
		}
		return m
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
			types := make(map[string]string, len(sub))
			for _, e := range sub {
				sources = append(sources, e.file)
				types[e.file] = screenshotType(e.res)
				mergeMatchResult(&merged, e.res)
			}
			out = append(out, mergedRow{
				Key:      "match:" + sub[0].ts.UTC().Format("2006-01-02T15:04:05"),
				Sources:  sources,
				Types:    types,
				ParsedAt: stampsFor(sources),
				Data:     merged,
			})
		}
	}
	sort.Strings(loners)
	for _, f := range loners {
		out = append(out, mergedRow{
			Key:      "unmatched:" + f,
			Sources:  []string{f},
			Types:    map[string]string{f: screenshotType(parsed[f])},
			ParsedAt: stampsFor([]string{f}),
			Data:     *parsed[f],
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
	a.Sources = unionSortedStrings(a.Sources, b.Sources)
	a.Types = mergeTypeMaps(a.Types, b.Types)
	a.ParsedAt = mergeTypeMaps(a.ParsedAt, b.ParsedAt)
	// Match key follows the earliest screenshot — ISO timestamps compare
	// lexicographically as chronological, so the smaller string wins.
	if strings.HasPrefix(a.Key, "match:") && strings.HasPrefix(b.Key, "match:") && b.Key < a.Key {
		a.Key = b.Key
	}
	return a
}

// mergeTypeMaps returns a single map containing every (filename → type) pair
// from a and b. Entries with a real type (non-empty) win over empty ones;
// b only adds keys absent from a so existing classifications survive.
func mergeTypeMaps(a, b map[string]string) map[string]string {
	if len(a) == 0 && len(b) == 0 {
		return nil
	}
	out := make(map[string]string, len(a)+len(b))
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		if existing, ok := out[k]; !ok || existing == "" {
			out[k] = v
		}
	}
	return out
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

// firstNonEmpty returns a when a is not its zero value; b otherwise.
// Mirror of the "first non-empty wins" rule mergeMatchResult applies
// across the disjoint field sets that SUMMARY / TEAMS / PERSONAL /
// RANK parses each populate. Works for any comparable type — string,
// int, pointer; the slice cases below stay inline because []T isn't
// comparable in Go.
func firstNonEmpty[T comparable](a, b T) T {
	var zero T
	if a != zero {
		return a
	}
	return b
}

// mergeMatchResult fills empty fields on dst from src — i.e. each field takes
// the first non-zero / non-empty value seen across the merge group. This
// works because the two screenshot types populate disjoint subsets: the
// SUMMARY has map/result/etc., the TEAMS scoreboard has damage/healing/mit.
func mergeMatchResult(dst, src *parser.MatchResult) {
	dst.Map = firstNonEmpty(dst.Map, src.Map)
	dst.Type = firstNonEmpty(dst.Type, src.Type)
	dst.Mode = firstNonEmpty(dst.Mode, src.Mode)
	dst.Role = firstNonEmpty(dst.Role, src.Role)
	dst.Hero = firstNonEmpty(dst.Hero, src.Hero)
	dst.Eliminations = firstNonEmpty(dst.Eliminations, src.Eliminations)
	dst.Assists = firstNonEmpty(dst.Assists, src.Assists)
	dst.Deaths = firstNonEmpty(dst.Deaths, src.Deaths)
	dst.Damage = firstNonEmpty(dst.Damage, src.Damage)
	dst.Healing = firstNonEmpty(dst.Healing, src.Healing)
	dst.Mitigation = firstNonEmpty(dst.Mitigation, src.Mitigation)
	dst.Result = firstNonEmpty(dst.Result, src.Result)
	dst.FinalScore = firstNonEmpty(dst.FinalScore, src.FinalScore)
	dst.Date = firstNonEmpty(dst.Date, src.Date)
	dst.FinishedAt = firstNonEmpty(dst.FinishedAt, src.FinishedAt)
	dst.GameLength = firstNonEmpty(dst.GameLength, src.GameLength)
	dst.Performance = firstNonEmpty(dst.Performance, src.Performance)
	// Rank-screen fields (filled only by parseRank).
	dst.Rank = firstNonEmpty(dst.Rank, src.Rank)
	dst.Level = firstNonEmpty(dst.Level, src.Level)
	if len(dst.Modifiers) == 0 {
		dst.Modifiers = src.Modifiers // []string — not comparable, can't use firstNonEmpty
	}
	dst.RankProgress = firstNonEmpty(dst.RankProgress, src.RankProgress)
	dst.ChangePercent = firstNonEmpty(dst.ChangePercent, src.ChangePercent)
	// SR is per-hero; merge by hero name like HeroesPlayed.
	for _, srcSR := range src.SR {
		exists := false
		for i := range dst.SR {
			if dst.SR[i].Hero == srcSR.Hero {
				exists = true
				if dst.SR[i].SR == 0 {
					dst.SR[i].SR = srcSR.SR
				}
				if dst.SR[i].Change == 0 {
					dst.SR[i].Change = srcSR.Change
				}
				break
			}
		}
		if !exists {
			dst.SR = append(dst.SR, srcSR)
		}
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

// upsertMergedRow writes one merged row through the Store. JSON columns are
// pre-encoded here; pkg/db treats them as opaque strings so it doesn't have
// to know about parser types.
func (a *App) upsertMergedRow(row mergedRow) error {
	heroesJSON, err := marshalIfPresent(row.Data.HeroesPlayed, len(row.Data.HeroesPlayed) > 0)
	if err != nil {
		return err
	}
	perfJSON, err := marshalIfPresent(row.Data.Performance, row.Data.Performance != nil)
	if err != nil {
		return err
	}
	modifiersJSON, err := marshalIfPresent(row.Data.Modifiers, len(row.Data.Modifiers) > 0)
	if err != nil {
		return err
	}
	srJSON, err := marshalIfPresent(row.Data.SR, len(row.Data.SR) > 0)
	if err != nil {
		return err
	}

	return a.store.Upsert(db.MatchRow{
		MatchKey:         row.Key,
		SourceFiles:      row.Sources,
		SourceTypes:      row.Types,
		SourceParsedAt:   row.ParsedAt,
		Map:              row.Data.Map,
		Type:             row.Data.Type,
		Mode:             row.Data.Mode,
		Role:             row.Data.Role,
		Hero:             row.Data.Hero,
		Eliminations:     row.Data.Eliminations,
		Assists:          row.Data.Assists,
		Deaths:           row.Data.Deaths,
		Damage:           row.Data.Damage,
		Healing:          row.Data.Healing,
		Mitigation:       row.Data.Mitigation,
		Result:           row.Data.Result,
		FinalScore:       row.Data.FinalScore,
		Date:             row.Data.Date,
		FinishedAt:       row.Data.FinishedAt,
		GameLength:       row.Data.GameLength,
		HeroesPlayedJSON: heroesJSON,
		PerformanceJSON:  perfJSON,
		ModifiersJSON:    modifiersJSON,
		SRJSON:           srJSON,
		Rank:             row.Data.Rank,
		Level:            row.Data.Level,
		RankProgress:     row.Data.RankProgress,
		ChangePercent:    row.Data.ChangePercent,
	})
}

// marshalIfPresent returns the JSON encoding of v when present is true, or
// "" otherwise — matching the "empty string == SQL NULL" convention the
// store uses for opaque JSON columns.
func marshalIfPresent(v any, present bool) (string, error) {
	if !present {
		return "", nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
