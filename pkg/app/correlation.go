package app

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// mergeWindow is how close two screenshot filenames must be in time to count
// as belonging to the same match. 2 minutes is generous enough to absorb a
// slow tab-cycler but tight enough that two separate matches never collide.
const mergeWindow = 2 * time.Minute

// EAD-bridge windows. The EAD-bridge bridges in-game teams ↔
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

// parseFilenameTimestamp walks the per-tool format list and returns
// the embedded timestamp for the first match. Source-of-truth for
// the format list is pkg/parser/screenshot_sources.yaml — add a new
// capture tool by appending an entry to the YAML; this loop reads
// it without further Go-side edits.
//
// Returns ok=false for filenames that match no canonical OW capture
// tool — those land with an `unmatched-<filename>` sentinel via the
// resolver.
func parseFilenameTimestamp(f string) (time.Time, bool) {
	for _, src := range parser.Sources() {
		if !strings.HasPrefix(f, src.Prefix) {
			continue
		}
		m := src.Regex.FindStringSubmatch(f)
		if m == nil {
			continue
		}
		year, ok := atoiCapture(m[1])
		if !ok {
			return time.Time{}, false
		}
		year += src.YearOffset
		month, ok1 := atoiCapture(m[2])
		day, ok2 := atoiCapture(m[3])
		hour, ok3 := atoiCapture(m[4])
		min, ok4 := atoiCapture(m[5])
		sec, ok5 := atoiCapture(m[6])
		if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 {
			return time.Time{}, false
		}
		// time.Date normalises out-of-range values silently (month
		// 13 becomes January next year, day 32 rolls over). We want
		// strict rejection: build a canonical RFC3339 string and let
		// time.Parse refuse the invalid date.
		s := fmt.Sprintf("%04d-%02d-%02dT%02d:%02d:%02dZ", year, month, day, hour, min, sec)
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			return time.Time{}, false
		}
		return t, true
	}
	return time.Time{}, false
}

// atoiCapture is a minimal regex-capture-to-int helper kept inline so
// the per-file cost of parseFilenameTimestamp stays in the same
// allocation budget as the old single-regex implementation. Negative
// values are impossible (the regex captures `\d{N}` only).
func atoiCapture(b string) (int, bool) {
	n, err := strconv.Atoi(b)
	if err != nil {
		return 0, false
	}
	return n, true
}

// firstNonEmpty returns a when a is not its zero value; b otherwise.
// Used by mergeMatchResult for the "first non-empty wins" rule across
// the disjoint field sets SUMMARY / TEAMS / PERSONAL / RANK each
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
// SUMMARY has map/result/etc., TEAMS has damage/healing/mit, etc.
//
// Now invoked exclusively by the read-time aggregator (pkg/app/aggregate.go).
// The write path no longer merges — each parse writes its own typed row
// and folding happens on read.
func mergeMatchResult(dst, src *parser.MatchResult) {
	dst.Map = firstNonEmpty(dst.Map, src.Map)
	dst.MapRaw = firstNonEmpty(dst.MapRaw, src.MapRaw)
	dst.GameMode = firstNonEmpty(dst.GameMode, src.GameMode)
	dst.Playlist = firstNonEmpty(dst.Playlist, src.Playlist)
	dst.Role = firstNonEmpty(dst.Role, src.Role)
	dst.Hero = firstNonEmpty(dst.Hero, src.Hero)
	dst.HeroRaw = firstNonEmpty(dst.HeroRaw, src.HeroRaw)
	dst.Eliminations = firstNonEmpty(dst.Eliminations, src.Eliminations)
	dst.Assists = firstNonEmpty(dst.Assists, src.Assists)
	dst.Deaths = firstNonEmpty(dst.Deaths, src.Deaths)
	dst.Damage = firstNonEmpty(dst.Damage, src.Damage)
	dst.Healing = firstNonEmpty(dst.Healing, src.Healing)
	dst.Mitigation = firstNonEmpty(dst.Mitigation, src.Mitigation)
	dst.QueueType = firstNonEmpty(dst.QueueType, src.QueueType)
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
//     filename AND no signature field conflicts — adopt its key,
//     unless multiple distinct match_keys tie within
//     tieToleranceWindow of the closest, in which case mint
//     "ambiguous-<filename>" + the tied candidates.
//   - Else mint a fresh key: `match-<ts>` from the filename, or
//     `unmatched-<filename>` for files without a parseable timestamp.
//
// Pre-1.0 break: separator is `-`, not `:`. Match keys are now
// URL-safe alphanumerics + `-` (modulo any chars carried over from
// the embedded filename in unmatched/ambiguous), so callers can drop
// the encodeURIComponent dance for the match-<ts> form. The
// timestamp portion uses `-` for both date and time separators
// (`YYYY-MM-DDTHH-MM-SS`) so the whole key stays parseable by humans
// + URL parsers.
func resolveMatchKey(filename string, result *parser.MatchResult, snap db.Screenshots) (string, []db.AmbiguousCandidate) {
	cand := candidateFromParse(filename, result)
	if k, cands, ok := matchByEAD(cand, snap); ok {
		if k != "" {
			return k, nil
		}
		return NewAmbiguousMatchKey(filename).String(), cands
	}
	if k, cands, ok := matchByTimestampWindow(cand, snap); ok {
		if k != "" {
			return k, nil
		}
		return NewAmbiguousMatchKey(filename).String(), cands
	}
	if cand.hasTS {
		return NewTrackedMatchKey(cand.ts.UTC().Format("2006-01-02T15-04-05")).String(), nil
	}
	return NewUnmatchedMatchKey(filename).String(), nil
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
// matches (SUMMARY anchored on one hero with TEAMS / PERSONAL
// captured during a mid-game swap to another).
type existing struct {
	key         string
	c           candidate
	matchHeroes map[string]bool
}

// matchHeroSets returns map[matchKey] → set of every hero that appears
// in any row attributed to that match. SUMMARY contributes its primary
// Hero plus every HeroesPlayed entry; TEAMS and PERSONAL each
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
	// Teams rows carry no hero — the in-game scoreboard is a combat-stats
	// source only — so they contribute nothing to the per-match hero set.
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
					Map: r.Map, Playlist: r.Playlist, Hero: r.Hero,
					Date: r.Date, FinishedAt: r.FinishedAt,
					// Perf totals are the SUMMARY's authoritative
					// E/A/D — expose them so matchByEAD can bridge a
					// just-arrived TEAMS to an existing SUMMARY
					// (closing the cascade after a SUMMARY adopts an
					// in-game TEAMS key via finished_at
					// corroboration).
					Eliminations: r.PerfElimTotal,
					Assists:      r.PerfAssistsTotal,
					Deaths:       r.PerfDeathsTotal,
				},
			},
			matchHeroes: heroSets[r.MatchKey],
		})
	}
	for _, r := range snap.Teams {
		out = append(out, existing{
			key: r.MatchKey,
			c: candidate{
				filename: r.Filename,
				r: &parser.MatchResult{
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
//	                    eadBridgeAutoWindow, OR exactly one
//	                    corroborated match_key at any distance in the
//	                    window; caller auto-adopts.
//	"",  cands, true  — multiple distinct candidates with no single
//	                    corroborated winner, OR a single uncorroborated
//	                    candidate in the 5–30 min ambiguous zone;
//	                    caller mints "ambiguous:<filename>".
//	"",  nil, false   — no candidates within eadBridgeAmbiguousWindow.
//
// "Corroborated" means the candidate's SUMMARY.finished_at HH:MM
// matches the existing key's filename HH:MM (see corroborated() for
// the exact rule). Corroboration overrides the time-threshold rule,
// so a SUMMARY whose finished_at HH:MM matches an in-game
// TEAMS filename HH:MM auto-adopts even when 20 minutes apart.
//
// Candidates are deduped by match_key (the closest-in-time screenshot
// per existing match wins) and sorted by distance ascending.
// eadKeyInfo accumulates the closest distance + corroboration flag for one
// existing match_key during the EAD-bridge scan.
type eadKeyInfo struct {
	d            time.Duration
	corroborated bool
}

// eadKeyDist is one existing match_key with its closest distance to the
// candidate, used to sort + resolve the EAD bridge.
type eadKeyDist struct {
	key          string
	d            time.Duration
	corroborated bool
}

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
	byKey := eadCandidateKeys(cand, snap)
	if len(byKey) == 0 {
		return "", nil, false
	}
	return resolveEADCandidates(sortEADKeys(byKey))
}

// eadCandidateKeys scans the existing screenshots for rows that share the
// candidate's exact E/A/D inside the ambiguous window (and don't conflict),
// keyed by match_key with the closest distance + any corroboration kept.
func eadCandidateKeys(cand candidate, snap db.Screenshots) map[string]eadKeyInfo {
	byKey := map[string]eadKeyInfo{}
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
		isCorrob := corroborated(cand, e)
		if prev, ok := byKey[e.key]; ok {
			if d < prev.d {
				prev.d = d
			}
			prev.corroborated = prev.corroborated || isCorrob
			byKey[e.key] = prev
		} else {
			byKey[e.key] = eadKeyInfo{d: d, corroborated: isCorrob}
		}
	}
	return byKey
}

// sortEADKeys flattens the by-key map into a slice ordered by ascending
// distance (match_key breaks ties) for deterministic resolution.
func sortEADKeys(byKey map[string]eadKeyInfo) []eadKeyDist {
	sorted := make([]eadKeyDist, 0, len(byKey))
	for k, info := range byKey {
		sorted = append(sorted, eadKeyDist{k, info.d, info.corroborated})
	}
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].d != sorted[j].d {
			return sorted[i].d < sorted[j].d
		}
		return sorted[i].key < sorted[j].key
	})
	return sorted
}

// resolveEADCandidates applies the bridge's adoption rules to the sorted
// candidates: a lone corroborated key wins outright; a single key inside
// the auto-window is adopted; otherwise everything surfaces as ambiguous.
func resolveEADCandidates(sorted []eadKeyDist) (string, []db.AmbiguousCandidate, bool) {
	// Corroboration overrides the time-threshold rule. If exactly one
	// existing match_key has a strong same-match signal beyond EAD,
	// adopt it regardless of distance — that's a stronger guarantee
	// than the 5-minute auto-window alone.
	var corrobKey string
	corrobCount := 0
	for _, h := range sorted {
		if h.corroborated {
			corrobCount++
			corrobKey = h.key
		}
	}
	if corrobCount == 1 {
		return corrobKey, nil, true
	}
	if len(sorted) == 1 && sorted[0].d < eadBridgeAutoWindow {
		return sorted[0].key, nil, true
	}
	cands := make([]db.AmbiguousCandidate, 0, len(sorted))
	for _, h := range sorted {
		cands = append(cands, db.AmbiguousCandidate{
			MatchKey:        h.key,
			DistanceSeconds: int(h.d / time.Second),
		})
	}
	return "", cands, true
}

// corroborated reports whether the existing key carries a strong
// same-match signal beyond EAD agreement. EAD alone can collide
// between unrelated matches; finished_at HH:MM equality is unlikely
// to align by coincidence.
//
// SUMMARY.finished_at HH:MM equals the existing screenshot's filename
// HH:MM. The SUMMARY's finished_at is the match's actual end-of-match
// clock time; an existing row taken in that same minute is almost
// certainly the same match. (A map+hero+date triple agreement rule
// was considered but is unreachable: snapshotExisting only exposes
// Date on SUMMARY rows, and an existing SUMMARY row never carries
// EAD into matchByEAD's snapshot view — so any candidate that needs
// Date agreement against an existing EAD-bearing row has no Date to
// compare against. finished_at via the filename timestamp is the
// available signal.)
func corroborated(cand candidate, e existing) bool {
	if cand.r.FinishedAt != "" && e.c.hasTS {
		if cand.r.FinishedAt == e.c.ts.UTC().Format("15:04") {
			return true
		}
	}
	return false
}

// tieToleranceWindow groups timestamp-window candidates from
// different match_keys whose distances are within this slack of
// each other. Two minute-scale screenshots a few seconds apart on
// either side of a tie are functionally equidistant; arbitrarily
// picking the closer one hides a real attribution decision from
// the user. Five seconds catches both strict ties and the
// real-world capture-jitter case while staying well below the
// 30 s default offset between adjacent screenshots in the same
// match.
const tieToleranceWindow = 5 * time.Second

// matchByTimestampWindow looks for an existing screenshot within
// mergeWindow of cand and with no signature conflicts. Returns:
//
//	key, nil, true    — single distinct match_key wins by a clear
//	                    margin (> tieToleranceWindow ahead of any
//	                    other match's closest screenshot); auto-adopt.
//	"",  cands, true  — two or more distinct match_keys tie within
//	                    tieToleranceWindow; caller mints
//	                    "ambiguous:<filename>".
//	"",  nil, false   — no candidates within mergeWindow.
//
// Candidates are deduped by match_key (closest screenshot per key
// wins) and the returned candidate slice is sorted by distance
// ascending.
func matchByTimestampWindow(cand candidate, snap db.Screenshots) (string, []db.AmbiguousCandidate, bool) {
	if !cand.hasTS {
		return "", nil, false
	}
	closestByKey := map[string]time.Duration{}
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
	minD := sorted[0].d
	// Pull every candidate within tieToleranceWindow of the minimum
	// into the tie set. Any further keys lose by a clear margin.
	ties := sorted[:0:0]
	for _, h := range sorted {
		if h.d-minD <= tieToleranceWindow {
			ties = append(ties, h)
			continue
		}
		break
	}
	if len(ties) == 1 {
		return ties[0].key, nil, true
	}
	cands := make([]db.AmbiguousCandidate, 0, len(ties))
	for _, t := range ties {
		cands = append(cands, db.AmbiguousCandidate{
			MatchKey:        t.key,
			DistanceSeconds: int(t.d / time.Second),
		})
	}
	return "", cands, true
}

// rowsConflict reports whether cand and an existing row disagree on a
// signature field strongly enough to block the bridge. existingMatchHeroes
// is the per-match-key hero set from snapshotExisting; it lets the
// predicate recognize multi-hero matches where SUMMARY anchors on one
// hero and TEAMS / PERSONAL were captured during a mid-game swap
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
