package correlate

import (
	"time"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// ReasonSameInstant marks a candidate proposed by the re-capture sweep:
// two matches whose SUMMARY rows report the same played-at instant, map,
// result and final score.
const ReasonSameInstant = "same_instant"

// The re-capture sweep — the duplicate detector for players who screenshot
// the SUMMARY screen and nothing else.
//
// FindDuplicateMatches fingerprints the TEAMS scoreboard, which is where
// E/A/D and damage/healing/mitigation live. A match captured twice with no
// TEAMS shot on either side therefore has nothing to compare, and the two
// copies sit in the list forever, obviously the same game to a human and
// invisible to the sweep.
//
// This one matches on the match's OWN identity instead of on its stats.
// played_at_utc is derived from the scoreboard's date + finished_at, so it
// says when the MATCH ended, not when the screenshot was taken: two captures
// of one game carry the same instant, and two different games cannot, because
// one player cannot finish two matches in the same minute. Map, result and
// final score ride along as corroboration — all four must agree.
//
// Two deliberate differences from its sibling:
//
//   - No capture-distance window. The stat-line sweep caps at seven days
//     because stat lines can coincide by chance, and its confidence decays
//     with distance. An instant cannot coincide, so a folder re-imported a
//     month later is still the same match and is still flagged.
//   - It may fire INSIDE the EAD bridge's 30-minute window, which is what
//     retired the old derive-the-reason-from-distance trick: the two
//     producers no longer occupy complementary bands, so the reason is
//     stored on the candidate row.

// summaryIdentity is the four-field fingerprint two captures of one match
// agree on. Comparable so two identities match with ==.
type summaryIdentity struct {
	instant    string
	mapName    string
	result     string
	finalScore string
}

// identityOf reads a SUMMARY row's identity, reporting false when the row
// cannot establish one. The instant, the map and the result are all
// required: without them "identical" would mean "equally empty", and two
// data-poor rows would flag each other. Final score is compared but not
// required — a missing score costs a real duplicate its flag, which is a
// miss, while a fabricated one would cost a real match its identity.
func identityOf(r db.SummaryRow) (summaryIdentity, bool) {
	if r.PlayedAtUTC == nil || *r.PlayedAtUTC == "" || r.Map == "" || r.Result == "" {
		return summaryIdentity{}, false
	}
	return summaryIdentity{
		instant:    *r.PlayedAtUTC,
		mapName:    r.Map,
		result:     r.Result,
		finalScore: r.FinalScore,
	}, true
}

// stampedIdentity pairs one row's identity with its filename capture
// timestamp — the same gate every other producer in this package applies,
// and the only honest source for the distance the candidate reports.
type stampedIdentity struct {
	identity summaryIdentity
	ts       time.Time
}

// FindRecapturedMatches returns existing tracked matches whose SUMMARY
// identity exactly equals one of newKey's, with no conflicting signature.
// Candidates are deduped by match_key (closest capture wins) and sorted by
// distance ascending. Pure function over the snapshot; the pkg/app sweep
// decides what to do with the result.
func FindRecapturedMatches(newKey string, snap db.Screenshots) []db.AmbiguousCandidate {
	newRows := collectStampedIdentities(newKey, snap)
	if len(newRows) == 0 {
		return nil
	}
	best := scanRecaptureDistances(newKey, newRows, snap)
	if len(best) == 0 {
		return nil
	}
	return rankRecaptureCandidates(best)
}

// collectStampedIdentities gathers key's identifiable, filename-timestamped
// SUMMARY rows — the fingerprints the sweep compares against.
func collectStampedIdentities(key string, snap db.Screenshots) []stampedIdentity {
	var out []stampedIdentity
	for _, r := range snap.Summaries {
		if r.MatchKey != key {
			continue
		}
		id, ok := identityOf(r)
		if !ok {
			continue
		}
		if ts, ok := ParseFilenameTimestamp(r.Filename); ok {
			out = append(out, stampedIdentity{identity: id, ts: ts})
		}
	}
	return out
}

// recaptureScanRow gates one existing SUMMARY row into the scan: it must
// belong to another, tracked match, establish an identity, and have a
// parseable filename timestamp.
func recaptureScanRow(r db.SummaryRow, newKey string) (stampedIdentity, bool) {
	if r.MatchKey == newKey {
		return stampedIdentity{}, false
	}
	if mk, err := match.ParseKey(r.MatchKey); err != nil || !mk.IsTracked() {
		return stampedIdentity{}, false
	}
	id, ok := identityOf(r)
	if !ok {
		return stampedIdentity{}, false
	}
	ts, ok := ParseFilenameTimestamp(r.Filename)
	if !ok {
		return stampedIdentity{}, false
	}
	return stampedIdentity{identity: id, ts: ts}, true
}

// closestIdentityDistance returns the smallest capture gap between row and
// any new-match row carrying an identical identity.
func closestIdentityDistance(row stampedIdentity, newRows []stampedIdentity) (time.Duration, bool) {
	var best time.Duration
	found := false
	for _, nr := range newRows {
		if nr.identity != row.identity {
			continue
		}
		d := nr.ts.Sub(row.ts)
		if d < 0 {
			d = -d
		}
		if !found || d < best {
			best = d
			found = true
		}
	}
	return best, found
}

// scanRecaptureDistances walks the existing SUMMARY rows and records, per
// tracked match_key, the closest capture distance to any of newKey's
// identities — skipping matches whose signature conflicts.
func scanRecaptureDistances(newKey string, newRows []stampedIdentity, snap db.Screenshots) map[string]time.Duration {
	newSig := summarySignature(newKey, snap)
	heroSets := matchHeroSets(snap)
	sigCache := map[string]*parser.MatchResult{}
	best := map[string]time.Duration{}
	for _, r := range snap.Summaries {
		row, ok := recaptureScanRow(r, newKey)
		if !ok {
			continue
		}
		d, ok := closestIdentityDistance(row, newRows)
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

// rankRecaptureCandidates folds the per-key distances into the wire shape,
// sorted by distance ascending with match_key breaking ties.
func rankRecaptureCandidates(best map[string]time.Duration) []db.AmbiguousCandidate {
	cands := make([]db.AmbiguousCandidate, 0, len(best))
	for k, d := range best {
		cands = append(cands, db.AmbiguousCandidate{
			MatchKey:        k,
			DistanceSeconds: int(d / time.Second),
			Reason:          ReasonSameInstant,
		})
	}
	sortCandidates(cands)
	return cands
}
