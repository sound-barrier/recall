package correlate

import (
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// DuplicateScan is the end-of-parse sweep's prepared view of a snapshot:
// every fingerprint both duplicate producers compare, parsed once and
// indexed BY that fingerprint.
//
// The sweep asks the same question of every match created in a run, and
// each answer used to re-read the whole snapshot — re-deriving hero sets,
// re-parsing every match key and every filename timestamp — so a first
// import, where every key is run-created, was quadratic in the corpus.
// Measured on 5 000 SUMMARY-only matches: 18 s of it, after the progress
// bar had already read 100 %, in a loop that reports nothing and cannot be
// canceled. At 10 000 it was well over a minute.
//
// Indexing by fingerprint turns each answer into a map lookup over the
// handful of rows that actually share it, so the sweep costs one pass plus
// a constant per match rather than a pass per match.
type DuplicateScan struct {
	snap     db.Screenshots
	heroSets map[string]map[string]bool
	sigCache map[string]*parser.MatchResult

	// linesByKey / identitiesByKey: what a given match's own screenshots
	// fingerprint to. Not filtered to tracked keys — the match being judged
	// is a fresh sentinel's worth of rows and is allowed to be anything.
	linesByKey      map[string][]stampedLine
	identitiesByKey map[string][]stampedIdentity

	// keysByLine / keysByIdentity: who else carries a fingerprint. Tracked
	// keys only — an untracked one is not a match the user can be sent to.
	keysByLine     map[statLine][]stampedRow
	keysByIdentity map[summaryIdentity][]stampedRow
}

// stampedRow is one tracked match's claim on a fingerprint, with the
// capture instant of the screenshot that carried it.
type stampedRow struct {
	key string
	ts  time.Time
}

// NewDuplicateScan parses and indexes the snapshot once.
func NewDuplicateScan(snap db.Screenshots) *DuplicateScan {
	ix := &DuplicateScan{
		snap:            snap,
		heroSets:        matchHeroSets(snap),
		sigCache:        map[string]*parser.MatchResult{},
		linesByKey:      map[string][]stampedLine{},
		identitiesByKey: map[string][]stampedIdentity{},
		keysByLine:      map[statLine][]stampedRow{},
		keysByIdentity:  map[summaryIdentity][]stampedRow{},
	}
	ix.indexTeams(snap)
	ix.indexSummaries(snap)
	return ix
}

func (ix *DuplicateScan) indexTeams(snap db.Screenshots) {
	for _, r := range snap.Teams {
		line := statLineOf(r)
		if !line.meaningful() {
			continue
		}
		ts, ok := ParseFilenameTimestamp(r.Filename)
		if !ok {
			continue
		}
		ix.linesByKey[r.MatchKey] = append(ix.linesByKey[r.MatchKey], stampedLine{line: line, ts: ts})
		if isTrackedKey(r.MatchKey) {
			ix.keysByLine[line] = append(ix.keysByLine[line], stampedRow{key: r.MatchKey, ts: ts})
		}
	}
}

func (ix *DuplicateScan) indexSummaries(snap db.Screenshots) {
	for _, r := range snap.Summaries {
		id, ok := identityOf(r)
		if !ok {
			continue
		}
		ts, ok := ParseFilenameTimestamp(r.Filename)
		if !ok {
			continue
		}
		ix.identitiesByKey[r.MatchKey] = append(ix.identitiesByKey[r.MatchKey], stampedIdentity{identity: id, ts: ts})
		if isTrackedKey(r.MatchKey) {
			ix.keysByIdentity[id] = append(ix.keysByIdentity[id], stampedRow{key: r.MatchKey, ts: ts})
		}
	}
}

func isTrackedKey(key string) bool {
	mk, err := match.ParseKey(key)
	return err == nil && mk.IsTracked()
}

// signature returns a match's SUMMARY-borne identity signature, computed
// once per key for the life of the scan.
func (ix *DuplicateScan) signature(key string) *parser.MatchResult {
	if sig, ok := ix.sigCache[key]; ok {
		return sig
	}
	sig := summarySignature(key, ix.snap)
	ix.sigCache[key] = sig
	return sig
}

// CandidatesFor returns every match newKey looks like a duplicate of, from
// both producers, merged and ranked. See FindDuplicateCandidates for the
// merge policy.
func (ix *DuplicateScan) CandidatesFor(newKey string) []db.AmbiguousCandidate {
	merged := ix.statLineCandidates(newKey)
	seen := make(map[string]struct{}, len(merged))
	for _, c := range merged {
		seen[c.MatchKey] = struct{}{}
	}
	for _, c := range ix.recaptureCandidates(newKey) {
		if _, dup := seen[c.MatchKey]; !dup {
			merged = append(merged, c)
		}
	}
	sortCandidates(merged)
	return merged
}

// statLineCandidates is the TEAMS stat-line producer: an identical
// six-field line between the EAD bridge's cap and DuplicateMatchWindow.
func (ix *DuplicateScan) statLineCandidates(newKey string) []db.AmbiguousCandidate {
	best := map[string]time.Duration{}
	for _, mine := range ix.linesByKey[newKey] {
		for _, other := range ix.keysByLine[mine.line] {
			d, ok := gapWithin(mine.ts, other.ts, eadBridgeAmbiguousWindow, DuplicateMatchWindow)
			if !ok || !ix.admits(newKey, other.key) {
				continue
			}
			keepClosest(best, other.key, d)
		}
	}
	return rankWithReason(best, ReasonDuplicateStats)
}

// recaptureCandidates is the SUMMARY identity producer: the same match
// played at the same minute, at any capture distance.
func (ix *DuplicateScan) recaptureCandidates(newKey string) []db.AmbiguousCandidate {
	best := map[string]time.Duration{}
	for _, mine := range ix.identitiesByKey[newKey] {
		for _, other := range ix.keysByIdentity[mine.identity] {
			d, ok := gapWithin(mine.ts, other.ts, 0, 0)
			if !ok || !ix.admits(newKey, other.key) {
				continue
			}
			keepClosest(best, other.key, d)
		}
	}
	return rankWithReason(best, ReasonSameInstant)
}

// admits vetoes a candidate that is not newKey itself and whose SUMMARY
// signature conflicts with newKey's.
func (ix *DuplicateScan) admits(newKey, candidateKey string) bool {
	if candidateKey == newKey {
		return false
	}
	return !RowsConflict(ix.signature(newKey), ix.signature(candidateKey), ix.heroSets[candidateKey])
}

// gapWithin returns |a−b|, reporting false when it falls outside the
// exclusive-low / inclusive-high band. A zero high means unbounded — the
// re-capture producer has no window, because its confidence does not decay
// with capture distance the way an identical stat line's does.
func gapWithin(a, b time.Time, low, high time.Duration) (time.Duration, bool) {
	d := a.Sub(b)
	if d < 0 {
		d = -d
	}
	if high == 0 {
		return d, true
	}
	if d <= low || d > high {
		return 0, false
	}
	return d, true
}

func keepClosest(best map[string]time.Duration, key string, d time.Duration) {
	if prev, seen := best[key]; !seen || d < prev {
		best[key] = d
	}
}

// rankWithReason folds the per-key distances into the wire shape, stamped
// with the producer that found them and sorted by distance ascending.
func rankWithReason(best map[string]time.Duration, reason string) []db.AmbiguousCandidate {
	if len(best) == 0 {
		return nil
	}
	cands := make([]db.AmbiguousCandidate, 0, len(best))
	for k, d := range best {
		cands = append(cands, db.AmbiguousCandidate{
			MatchKey:        k,
			DistanceSeconds: int(d / time.Second),
			Reason:          reason,
		})
	}
	sortCandidates(cands)
	return cands
}
