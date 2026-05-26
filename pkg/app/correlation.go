package app

import (
	"fmt"
	"regexp"
	"sort"
	"time"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// mergeWindow is how close two screenshot filenames must be in time to count
// as belonging to the same match. 2 minutes is generous enough to absorb a
// slow tab-cycler but tight enough that two separate matches never collide.
const mergeWindow = 2 * time.Minute

var filenameTimestampRe = regexp.MustCompile(`(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})`)

// parseFilenameTimestamp extracts the YYYY.MM.DD - HH.MM.SS portion the OW
// client embeds in its screenshot filenames. Returns ok=false for filenames
// that don't carry a timestamp.
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

// firstNonEmpty returns a when a is not its zero value; b otherwise.
// Used by mergeMatchResult for the "first non-empty wins" rule across
// the disjoint field sets SUMMARY / SCOREBOARD / PERSONAL / RANK each
// populate.
func firstNonEmpty[T comparable](a, b T) T {
	var zero T
	if a != zero {
		return a
	}
	return b
}

func stringsConflict(a, b string) bool { return a != "" && b != "" && a != b }
func intsConflict(a, b int) bool       { return a != 0 && b != 0 && a != b }

// mergeMatchResult fills empty fields on dst from src — each field takes
// the first non-zero / non-empty value seen across the merge group. This
// works because the four screenshot types populate disjoint subsets:
// SUMMARY has map/result/etc., SCOREBOARD has damage/healing/mit, etc.
//
// Now invoked exclusively by the read-time aggregator (pkg/app/aggregate.go).
// The write path no longer merges — each parse writes its own typed row
// and folding happens on read.
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
	dst.Rank = firstNonEmpty(dst.Rank, src.Rank)
	dst.Level = firstNonEmpty(dst.Level, src.Level)
	if len(dst.Modifiers) == 0 {
		dst.Modifiers = src.Modifiers
	}
	dst.RankProgress = firstNonEmpty(dst.RankProgress, src.RankProgress)
	dst.ChangePercent = firstNonEmpty(dst.ChangePercent, src.ChangePercent)
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

// resolveMatchKey returns the match_key the just-parsed file should
// adopt, based on existing screenshots in the store:
//
//   - If an existing scoreboard row has the same non-zero (E, A, D)
//     signature and doesn't conflict on (map, hero), adopt its key.
//     (Bridges in-game scoreboard ↔ post-match summary, which can be
//     minutes apart.)
//   - Otherwise, if an existing screenshot is within mergeWindow of
//     this filename AND no signature field conflicts, adopt its key.
//     Ties (multiple qualifying rows) break to the closest in time.
//   - Otherwise mint a fresh key — `match:<ts>` from the filename, or
//     `unmatched:<filename>` for files without a parseable timestamp.
func resolveMatchKey(filename string, result *parser.MatchResult, snap db.Screenshots) string {
	cand := candidateFromParse(filename, result)
	if k, ok := matchByEAD(cand, snap); ok {
		return k
	}
	if k, ok := matchByTimestampWindow(cand, snap); ok {
		return k
	}
	if cand.hasTS {
		return "match:" + cand.ts.UTC().Format("2006-01-02T15:04:05")
	}
	return "unmatched:" + filename
}

// candidate is the comparison shape used by the two match passes.
// Carries the same signature fields rowsConflict checks plus the file's
// timestamp for the window predicate.
type candidate struct {
	filename string
	ts       time.Time
	hasTS    bool
	r        *parser.MatchResult
}

func candidateFromParse(filename string, r *parser.MatchResult) candidate {
	c := candidate{filename: filename, r: r}
	if ts, ok := parseFilenameTimestamp(filename); ok {
		c.ts = ts
		c.hasTS = true
	}
	return c
}

// existing pulls every screenshot in the snapshot into one comparison
// slice. Each entry carries its parent type's MatchKey + a candidate
// view of its scalar fields.
type existing struct {
	key string
	c   candidate
}

func snapshotExisting(snap db.Screenshots) []existing {
	var out []existing
	for _, r := range snap.Summaries {
		out = append(out, existing{
			key: r.MatchKey,
			c: candidate{
				filename: r.Filename,
				r: &parser.MatchResult{
					Map: r.Map, Mode: r.Mode, Hero: r.Hero,
					Date: r.Date, FinishedAt: r.FinishedAt,
				},
			},
		})
	}
	for _, r := range snap.Scoreboards {
		out = append(out, existing{
			key: r.MatchKey,
			c: candidate{
				filename: r.Filename,
				r: &parser.MatchResult{
					Map: r.Map, Mode: r.Mode, Hero: r.Hero,
					Eliminations: r.Eliminations,
					Assists:      r.Assists,
					Deaths:       r.Deaths,
					Damage:       r.Damage,
					Healing:      r.Healing,
					Mitigation:   r.Mitigation,
				},
			},
		})
	}
	for _, r := range snap.Personals {
		out = append(out, existing{
			key: r.MatchKey,
			c:   candidate{filename: r.Filename, r: &parser.MatchResult{Hero: r.Hero}},
		})
	}
	for _, r := range snap.Ranks {
		out = append(out, existing{
			key: r.MatchKey,
			c: candidate{
				filename: r.Filename,
				r: &parser.MatchResult{
					Rank: r.Rank, Result: r.Result,
				},
			},
		})
	}
	for _, r := range snap.Unknowns {
		out = append(out, existing{key: r.MatchKey, c: candidate{filename: r.Filename, r: &parser.MatchResult{}}})
	}
	for i := range out {
		if ts, ok := parseFilenameTimestamp(out[i].c.filename); ok {
			out[i].c.ts = ts
			out[i].c.hasTS = true
		}
	}
	return out
}

// matchByEAD looks for an existing screenshot with the same non-zero
// (E, A, D) and no conflicting (map, hero). Returns its match_key on
// hit. Used to bridge in-game scoreboard ↔ post-match summary which
// may be far apart in time but share the canonical stat signature.
func matchByEAD(cand candidate, snap db.Screenshots) (string, bool) {
	if cand.r.Eliminations == 0 && cand.r.Assists == 0 && cand.r.Deaths == 0 {
		return "", false
	}
	for _, e := range snapshotExisting(snap) {
		if e.c.r.Eliminations == 0 && e.c.r.Assists == 0 && e.c.r.Deaths == 0 {
			continue
		}
		if e.c.r.Eliminations != cand.r.Eliminations ||
			e.c.r.Assists != cand.r.Assists ||
			e.c.r.Deaths != cand.r.Deaths {
			continue
		}
		if rowsConflict(cand.r, e.c.r) {
			continue
		}
		return e.key, true
	}
	return "", false
}

// matchByTimestampWindow looks for an existing screenshot within
// mergeWindow of cand and with no signature conflicts. Closest-in-time
// wins; this is the rule that used to live in splitByMatchMetadata
// (PERSONAL sandwiched between two SUMMARY windows goes to the nearer
// one).
func matchByTimestampWindow(cand candidate, snap db.Screenshots) (string, bool) {
	if !cand.hasTS {
		return "", false
	}
	bestKey := ""
	bestDelta := time.Duration(1<<62 - 1)
	for _, e := range snapshotExisting(snap) {
		if !e.c.hasTS {
			continue
		}
		d := cand.ts.Sub(e.c.ts)
		if d < 0 {
			d = -d
		}
		if d > mergeWindow {
			continue
		}
		if rowsConflict(cand.r, e.c.r) {
			continue
		}
		if d < bestDelta {
			bestDelta = d
			bestKey = e.key
		}
	}
	if bestKey == "" {
		return "", false
	}
	return bestKey, true
}

// rowsConflict reports whether the two parsed results disagree on any
// signature field (each side has a non-zero value and they differ).
// Same predicate the pre-refactor merge used.
func rowsConflict(a, b *parser.MatchResult) bool {
	if stringsConflict(a.Map, b.Map) ||
		stringsConflict(a.Date, b.Date) ||
		stringsConflict(a.FinishedAt, b.FinishedAt) ||
		stringsConflict(a.Hero, b.Hero) {
		return true
	}
	if intsConflict(a.Eliminations, b.Eliminations) ||
		intsConflict(a.Assists, b.Assists) ||
		intsConflict(a.Deaths, b.Deaths) {
		return true
	}
	return false
}

// unionSortedStrings returns the set-union of a and b as a sorted slice.
func unionSortedStrings(a, b []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(a)+len(b))
	for _, s := range a {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	for _, s := range b {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}
