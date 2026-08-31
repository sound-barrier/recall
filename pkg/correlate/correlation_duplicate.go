package correlate

import (
	"sort"
	"time"

	"recall/pkg/db"
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
// rather than by the EAD bridge / timestamp window. Stamped onto the
// candidate and stored with it — see correlation_recapture.go for why a
// third producer made deriving it from distance untenable.
const ReasonDuplicateStats = "duplicate_stats"

// The end-of-parse sweep's merge policy, applied by
// DuplicateScan.CandidatesFor.
//
// Two producers, deliberately not folded into one. The stat-line
// fingerprint compares six independent numbers off the TEAMS scoreboard
// and is what catches a re-capture whose SUMMARY never OCR'd cleanly; the
// re-capture sweep compares the match's own identity and is what catches
// one that has no TEAMS shot at all. Neither subsumes the other, and a
// match can be found by both.
//
// On a key proposed by both, the stat-line reason stands: they agree on
// the outcome, so only the label differs, and the first producer's is the
// one the Unknown tab's copy was written for. (Their distances can differ
// by seconds — one is measured between TEAMS filenames, the other between
// SUMMARY filenames — which moves nothing but the "N h apart" text.)

// sortCandidates puts the closest capture first, with match_key breaking
// ties — the order the Unknown tab's picker renders.
func sortCandidates(cands []db.AmbiguousCandidate) {
	sort.Slice(cands, func(i, j int) bool {
		if cands[i].DistanceSeconds != cands[j].DistanceSeconds {
			return cands[i].DistanceSeconds < cands[j].DistanceSeconds
		}
		return cands[i].MatchKey < cands[j].MatchKey
	})
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
