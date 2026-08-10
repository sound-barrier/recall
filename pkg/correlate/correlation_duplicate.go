package correlate

import (
	"sort"
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// DuplicateMatchWindow is how far back the end-of-parse duplicate sweep
// compares a freshly-created match's TEAMS stat line against existing
// matches. Beyond the EAD bridge's 30-minute cap an identical E/A/D
// triple alone is treated as coincidence, but the FULL six-field line
// (damage alone carries ~5 digits of entropy) staying identical is
// overwhelmingly a re-capture of the same match — up to a week covers
// "found the screenshots again on another device" without dragging in
// ancient history.
const DuplicateMatchWindow = 7 * 24 * time.Hour

// ReasonDuplicateStats marks an ambiguous candidate that was proposed by
// the duplicate sweep (identical TEAMS stat line, hours-to-days apart)
// rather than by the EAD bridge / timestamp window.
const ReasonDuplicateStats = "duplicate_stats"

// CandidateReason derives why a stored ambiguous candidate was proposed
// from its distance alone: the EAD bridge caps at eadBridgeAmbiguousWindow
// and the timestamp window at MergeWindow, so any candidate farther out
// can only have come from the duplicate sweep. Derived, not stored — the
// ambiguous_candidates table needs no reason column.
func CandidateReason(distanceSeconds int) string {
	if time.Duration(distanceSeconds)*time.Second > eadBridgeAmbiguousWindow {
		return ReasonDuplicateStats
	}
	return ""
}

// statLine is the six-field TEAMS fingerprint the duplicate sweep
// compares. Comparable so two lines match with ==.
type statLine struct {
	eliminations, assists, deaths int
	damage, healing, mitigation   int
}

func statLineOf(r db.TeamsRow) statLine {
	return statLine{
		eliminations: r.Eliminations, assists: r.Assists, deaths: r.Deaths,
		damage: r.Damage, healing: r.Healing, mitigation: r.Mitigation,
	}
}

// meaningful gates out entropy-starved lines: an all-zero E/A/D row is
// OCR garbage (the same gate MatchByEAD applies), and a zero-damage row
// leaves only small numbers that CAN collide across matches. Healing and
// mitigation may legitimately be zero (non-support / non-tank rows) —
// zero just has to equal zero.
func (l statLine) meaningful() bool {
	if l.eliminations == 0 && l.assists == 0 && l.deaths == 0 {
		return false
	}
	return l.damage > 0
}

// stampedLine pairs a meaningful TEAMS stat line with its filename
// capture timestamp for the duplicate sweep's distance checks.
type stampedLine struct {
	line statLine
	ts   time.Time
}

// FindDuplicateMatches returns existing tracked matches whose TEAMS stat
// line exactly equals one of newKey's TEAMS rows, between the EAD
// bridge's outer cap and DuplicateMatchWindow away, with no conflicting
// SUMMARY signature. Candidates are deduped by match_key (closest
// capture wins) and sorted by distance ascending. Pure function over the
// snapshot; the pkg/app sweep decides what to do with the result.
func FindDuplicateMatches(newKey string, snap db.Screenshots) []db.AmbiguousCandidate {
	newRows := collectStampedLines(newKey, snap)
	if len(newRows) == 0 {
		return nil
	}
	best := scanDuplicateDistances(newKey, newRows, snap)
	if len(best) == 0 {
		return nil
	}
	return rankDuplicateCandidates(best)
}

// collectStampedLines gathers key's meaningful, filename-timestamped
// TEAMS stat lines — the fingerprints the sweep compares against.
func collectStampedLines(key string, snap db.Screenshots) []stampedLine {
	var out []stampedLine
	for _, r := range snap.Teams {
		if r.MatchKey != key {
			continue
		}
		l := statLineOf(r)
		if !l.meaningful() {
			continue
		}
		if ts, ok := ParseFilenameTimestamp(r.Filename); ok {
			out = append(out, stampedLine{line: l, ts: ts})
		}
	}
	return out
}

// duplicateScanRow gates one existing TEAMS row into the duplicate scan:
// it must belong to another, tracked match, carry a meaningful stat
// line, and have a parseable filename timestamp.
func duplicateScanRow(r db.TeamsRow, newKey string) (stampedLine, bool) {
	if r.MatchKey == newKey {
		return stampedLine{}, false
	}
	if mk, err := match.ParseKey(r.MatchKey); err != nil || !mk.IsTracked() {
		return stampedLine{}, false
	}
	l := statLineOf(r)
	if !l.meaningful() {
		return stampedLine{}, false
	}
	ts, ok := ParseFilenameTimestamp(r.Filename)
	if !ok {
		return stampedLine{}, false
	}
	return stampedLine{line: l, ts: ts}, true
}

// closestStampedDistance returns the smallest gap between row and any
// new-match line with an identical stat fingerprint, restricted to the
// sweep's (eadBridgeAmbiguousWindow, DuplicateMatchWindow] band.
func closestStampedDistance(row stampedLine, newRows []stampedLine) (time.Duration, bool) {
	var best time.Duration
	found := false
	for _, nr := range newRows {
		if nr.line != row.line {
			continue
		}
		d := nr.ts.Sub(row.ts)
		if d < 0 {
			d = -d
		}
		if d <= eadBridgeAmbiguousWindow || d > DuplicateMatchWindow {
			continue
		}
		if !found || d < best {
			best = d
			found = true
		}
	}
	return best, found
}

// scanDuplicateDistances walks the existing TEAMS rows and records, per
// tracked match_key, the closest in-band distance to any of newKey's
// stat lines — skipping matches whose SUMMARY signature conflicts.
func scanDuplicateDistances(newKey string, newRows []stampedLine, snap db.Screenshots) map[string]time.Duration {
	newSig := summarySignature(newKey, snap)
	heroSets := matchHeroSets(snap)
	sigCache := map[string]*parser.MatchResult{}
	best := map[string]time.Duration{}
	for _, r := range snap.Teams {
		row, ok := duplicateScanRow(r, newKey)
		if !ok {
			continue
		}
		d, ok := closestStampedDistance(row, newRows)
		if !ok {
			continue
		}
		sig, cached := sigCache[r.MatchKey]
		if !cached {
			sig = summarySignature(r.MatchKey, snap)
			sigCache[r.MatchKey] = sig
		}
		if RowsConflict(newSig, sig, heroSets[r.MatchKey]) {
			continue
		}
		if prev, seen := best[r.MatchKey]; !seen || d < prev {
			best[r.MatchKey] = d
		}
	}
	return best
}

// rankDuplicateCandidates folds the per-key distances into the wire
// shape, sorted by distance ascending with match_key breaking ties.
func rankDuplicateCandidates(best map[string]time.Duration) []db.AmbiguousCandidate {
	cands := make([]db.AmbiguousCandidate, 0, len(best))
	for k, d := range best {
		cands = append(cands, db.AmbiguousCandidate{
			MatchKey:        k,
			DistanceSeconds: int(d / time.Second),
		})
	}
	sort.Slice(cands, func(i, j int) bool {
		if cands[i].DistanceSeconds != cands[j].DistanceSeconds {
			return cands[i].DistanceSeconds < cands[j].DistanceSeconds
		}
		return cands[i].MatchKey < cands[j].MatchKey
	})
	return cands
}

// summarySignature folds a match's SUMMARY-borne identity fields
// (map / date / finished_at / hero, first non-empty wins) into one
// comparison view for the RowsConflict guard. E/A/D stay zero on
// purpose: the perf-card totals drift from the TEAMS values on
// low-quality captures, and the stat lines are already equal by
// construction — feeding perf totals in would only manufacture false
// conflicts.
func summarySignature(key string, snap db.Screenshots) *parser.MatchResult {
	sig := &parser.MatchResult{}
	for _, s := range snap.Summaries {
		if s.MatchKey != key {
			continue
		}
		if sig.Map == "" {
			sig.Map = s.Map
		}
		if sig.Date == "" {
			sig.Date = s.Date
		}
		if sig.FinishedAt == "" {
			sig.FinishedAt = s.FinishedAt
		}
		if sig.Hero == "" {
			sig.Hero = s.Hero
		}
	}
	return sig
}
