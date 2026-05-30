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

// EAD-bridge windows. The EAD-bridge bridges in-game scoreboard ↔
// post-match summary which can be minutes apart, so it accepts a
// longer time gap than the strict mergeWindow. Two thresholds:
//
//   - <eadBridgeAutoWindow: high confidence this is the same match.
//     Auto-adopt iff there's exactly one EAD candidate.
//   - eadBridgeAutoWindow..eadBridgeAmbiguousWindow: could be the same
//     match (delayed capture) OR a different match with coincidentally
//     identical stats. Surface as ambiguous so the user picks.
//   - >eadBridgeAmbiguousWindow: refuse to bridge — at that gap, an
//     identical stat line is overwhelmingly more likely to be a
//     coincidence than the same match.
const (
	eadBridgeAutoWindow      = 5 * time.Minute
	eadBridgeAmbiguousWindow = 30 * time.Minute
)

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
//   - If exactly one existing screenshot has the same non-zero (E, A, D)
//     signature, no conflict on (map, hero), AND it's within
//     eadBridgeAutoWindow of this filename — adopt its key.
//   - Else if EAD candidates exist within eadBridgeAmbiguousWindow
//     (single in 5–30 min zone, OR multiple anywhere in 0–30 min) —
//     mint "ambiguous:<filename>" and return the candidate list. The
//     caller persists the candidates via store.ApplyAmbiguity so the
//     user can pick the correct match via the Unknown tab.
//   - Else if an existing screenshot is within mergeWindow of this
//     filename AND no signature field conflicts — adopt its key.
//   - Else mint a fresh key: `match:<ts>` from the filename, or
//     `unmatched:<filename>` for files without a parseable timestamp.
func resolveMatchKey(filename string, result *parser.MatchResult, snap db.Screenshots) (string, []db.AmbiguousCandidate) {
	cand := candidateFromParse(filename, result)
	if k, cands, ok := matchByEAD(cand, snap); ok {
		if k != "" {
			return k, nil
		}
		return "ambiguous:" + filename, cands
	}
	if k, ok := matchByTimestampWindow(cand, snap); ok {
		return k, nil
	}
	if cand.hasTS {
		return "match:" + cand.ts.UTC().Format("2006-01-02T15:04:05"), nil
	}
	return "unmatched:" + filename, nil
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
// view of its scalar fields, plus the per-match-key hero set so the
// hero-conflict predicate in rowsConflict can recognize multi-hero
// matches (SUMMARY anchored on one hero with SCOREBOARD / PERSONAL
// captured during a mid-game swap to another).
type existing struct {
	key         string
	c           candidate
	matchHeroes map[string]bool
}

// matchHeroSets returns map[matchKey] → set of every hero that appears
// in any row attributed to that match. SUMMARY contributes its primary
// Hero plus every HeroesPlayed entry; SCOREBOARD and PERSONAL each
// contribute their row Hero. The set is what rowsConflict consults
// when deciding whether a hero mismatch between cand and an existing
// row is a real conflict or just a swap captured in one of the two
// rows but missing from the other.
func matchHeroSets(snap db.Screenshots) map[string]map[string]bool {
	out := map[string]map[string]bool{}
	add := func(key, hero string) {
		if key == "" || hero == "" {
			return
		}
		if out[key] == nil {
			out[key] = map[string]bool{}
		}
		out[key][hero] = true
	}
	for _, r := range snap.Summaries {
		add(r.MatchKey, r.Hero)
		for _, h := range r.HeroesPlayed {
			add(r.MatchKey, h.Hero)
		}
	}
	for _, r := range snap.Scoreboards {
		add(r.MatchKey, r.Hero)
	}
	for _, r := range snap.Personals {
		add(r.MatchKey, r.Hero)
	}
	return out
}

func snapshotExisting(snap db.Screenshots) []existing {
	heroSets := matchHeroSets(snap)
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
			matchHeroes: heroSets[r.MatchKey],
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
			matchHeroes: heroSets[r.MatchKey],
		})
	}
	for _, r := range snap.Personals {
		out = append(out, existing{
			key:         r.MatchKey,
			c:           candidate{filename: r.Filename, r: &parser.MatchResult{Hero: r.Hero}},
			matchHeroes: heroSets[r.MatchKey],
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
			matchHeroes: heroSets[r.MatchKey],
		})
	}
	for _, r := range snap.Unknowns {
		out = append(out, existing{
			key:         r.MatchKey,
			c:           candidate{filename: r.Filename, r: &parser.MatchResult{}},
			matchHeroes: heroSets[r.MatchKey],
		})
	}
	for i := range out {
		if ts, ok := parseFilenameTimestamp(out[i].c.filename); ok {
			out[i].c.ts = ts
			out[i].c.hasTS = true
		}
	}
	return out
}

// matchByEAD looks for existing screenshots with the same non-zero
// (E, A, D), no conflicting (map, hero, date), and a parseable
// filename timestamp within eadBridgeAmbiguousWindow. Returns:
//
//	key, nil, true    — exactly one distinct match_key within
//	                    eadBridgeAutoWindow; caller auto-adopts.
//	"",  cands, true  — multiple distinct candidates, OR a single
//	                    candidate in the 5–30 min ambiguous zone;
//	                    caller mints "ambiguous:<filename>".
//	"",  nil, false   — no candidates within eadBridgeAmbiguousWindow.
//
// Candidates are deduped by match_key (the closest-in-time screenshot
// per existing match wins) and sorted by distance ascending.
func matchByEAD(cand candidate, snap db.Screenshots) (string, []db.AmbiguousCandidate, bool) {
	if cand.r.Eliminations == 0 && cand.r.Assists == 0 && cand.r.Deaths == 0 {
		return "", nil, false
	}
	if !cand.hasTS {
		// No filename timestamp = can't enforce the window. Skip the
		// EAD bridge; the timestamp-window and fresh-key passes still
		// apply downstream.
		return "", nil, false
	}
	closestByKey := map[string]time.Duration{}
	for _, e := range snapshotExisting(snap) {
		if e.c.r.Eliminations == 0 && e.c.r.Assists == 0 && e.c.r.Deaths == 0 {
			continue
		}
		if e.c.r.Eliminations != cand.r.Eliminations ||
			e.c.r.Assists != cand.r.Assists ||
			e.c.r.Deaths != cand.r.Deaths {
			continue
		}
		if rowsConflict(cand.r, e.c.r, e.matchHeroes) {
			continue
		}
		if !e.c.hasTS {
			continue
		}
		d := cand.ts.Sub(e.c.ts)
		if d < 0 {
			d = -d
		}
		if d > eadBridgeAmbiguousWindow {
			continue
		}
		if prev, ok := closestByKey[e.key]; !ok || d < prev {
			closestByKey[e.key] = d
		}
	}
	if len(closestByKey) == 0 {
		return "", nil, false
	}
	type kd struct {
		key string
		d   time.Duration
	}
	sorted := make([]kd, 0, len(closestByKey))
	for k, d := range closestByKey {
		sorted = append(sorted, kd{k, d})
	}
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].d != sorted[j].d {
			return sorted[i].d < sorted[j].d
		}
		return sorted[i].key < sorted[j].key
	})
	if len(sorted) == 1 && sorted[0].d < eadBridgeAutoWindow {
		return sorted[0].key, nil, true
	}
	cands := make([]db.AmbiguousCandidate, 0, len(sorted))
	for _, h := range sorted {
		cands = append(cands, db.AmbiguousCandidate{
			MatchKey:  h.key,
			DistanceS: int(h.d / time.Second),
		})
	}
	return "", cands, true
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
		if rowsConflict(cand.r, e.c.r, e.matchHeroes) {
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

// rowsConflict reports whether cand and an existing row disagree on a
// signature field strongly enough to block the bridge. existingMatchHeroes
// is the per-match-key hero set from snapshotExisting; it lets the
// predicate recognize multi-hero matches where SUMMARY anchors on one
// hero and SCOREBOARD / PERSONAL were captured during a mid-game swap
// to another. A hero mismatch is a soft conflict — allowed iff the
// candidate's hero is already in the existing match's hero set, or the
// existing row's hero is in the candidate's HeroesPlayed list.
func rowsConflict(cand, existing *parser.MatchResult, existingMatchHeroes map[string]bool) bool {
	if stringsConflict(cand.Map, existing.Map) ||
		stringsConflict(cand.Date, existing.Date) ||
		stringsConflict(cand.FinishedAt, existing.FinishedAt) {
		return true
	}
	if stringsConflict(cand.Hero, existing.Hero) && !heroesOverlap(cand, existing, existingMatchHeroes) {
		return true
	}
	if intsConflict(cand.Eliminations, existing.Eliminations) ||
		intsConflict(cand.Assists, existing.Assists) ||
		intsConflict(cand.Deaths, existing.Deaths) {
		return true
	}
	return false
}

// heroesOverlap is true when either cand's hero is in the existing
// match's known-hero set, OR existing's hero is in cand's
// HeroesPlayed list. Either direction means the two rows plausibly
// belong to the same multi-hero match.
func heroesOverlap(cand, existing *parser.MatchResult, existingMatchHeroes map[string]bool) bool {
	if existingMatchHeroes[cand.Hero] {
		return true
	}
	for _, hp := range cand.HeroesPlayed {
		if hp.Hero == existing.Hero {
			return true
		}
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
