package app

import (
	"sort"
	"time"

	"recall/pkg/db"
)

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
