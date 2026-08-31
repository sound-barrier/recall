package app

import (
	"sort"
	"time"

	"recall/pkg/aggregate"
	"recall/pkg/applog"
	"recall/pkg/correlate"
	"recall/pkg/db"
	"recall/pkg/match"
)

// End-of-run duplicate sweep. A re-capture of the same match hours later
// defeats every per-file correlation pass (the EAD bridge caps at 30
// minutes, the timestamp window at 2), so the duplicate set always
// coalesces into one fresh tracked key of its own — which file minted it
// depends on capture order. Only after the run, when the set is
// complete, can its TEAMS stat line be compared against existing
// matches; on an exact six-field match the fresh match is demoted into
// the ambiguous "Needs your review" queue with the original as a
// duplicate candidate. Scoped strictly to keys CREATED this run
// (preRunKeys), so history is never re-judged and ReParseAll — where
// every re-adopted key pre-exists — is a no-op by construction.

// sweepNewMatchDuplicates demotes run-created tracked matches that
// duplicate an existing one — by TEAMS stat line, or by the match's own
// played-at identity when no TEAMS shot exists. Demotion failures are
// logged and skipped — a duplicate flag is a UX nicety, never worth
// failing an otherwise-successful parse.
func (st *parseRunState) sweepNewMatchDuplicates() {
	created := st.runCreatedTrackedKeys()
	if len(created) == 0 {
		return
	}
	// Candidates may only point at matches that outlive the sweep:
	// everything pre-existing, plus earlier-created keys that survived
	// their own turn. Without this filter, the EARLIER of two
	// duplicate sets parsed in one run would flag the later one as its
	// candidate and get demoted first.
	surviving := make(map[string]struct{}, len(st.preRunKeys)+len(created))
	for k := range st.preRunKeys {
		surviving[k] = struct{}{}
	}
	for _, c := range created {
		cands := filterCandidateKeys(correlate.FindDuplicateCandidates(c.key, st.snap), surviving)
		if len(cands) == 0 || !st.demoteDuplicate(c, cands) {
			surviving[c.key] = struct{}{}
		}
	}
}

// createdKey is one tracked match key minted during this run, anchored
// on its earliest source file (the same anchor a fresh sentinel uses).
type createdKey struct {
	key          string
	earliestFile string
	earliestTS   time.Time
}

// runCreatedTrackedKeys collects the tracked keys present in the
// post-run snapshot but absent from preRunKeys, ordered by earliest
// source-file timestamp so the sweep judges older captures first.
func (st *parseRunState) runCreatedTrackedKeys() []createdKey {
	byKey := map[string]*createdKey{}
	forEachParentRowKey(&st.snap, func(filename string, matchKey *string) {
		st.considerCreated(byKey, filename, *matchKey)
	})
	out := make([]createdKey, 0, len(byKey))
	for _, c := range byKey {
		out = append(out, *c)
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].earliestTS.Equal(out[j].earliestTS) {
			return out[i].earliestTS.Before(out[j].earliestTS)
		}
		return out[i].key < out[j].key
	})
	return out
}

// considerCreated records one row's key as run-created when it is tracked,
// absent from preRunKeys, and carries a parseable filename timestamp —
// keeping the earliest source file seen for that key.
func (st *parseRunState) considerCreated(byKey map[string]*createdKey, filename, key string) {
	if _, existed := st.preRunKeys[key]; existed {
		return
	}
	if mk, err := match.ParseKey(key); err != nil || !mk.IsTracked() {
		return
	}
	ts, ok := correlate.ParseFilenameTimestamp(filename)
	if !ok {
		return
	}
	if prev := byKey[key]; prev == nil || ts.Before(prev.earliestTS) {
		byKey[key] = &createdKey{key: key, earliestFile: filename, earliestTS: ts}
	}
}

func filterCandidateKeys(cands []db.AmbiguousCandidate, allowed map[string]struct{}) []db.AmbiguousCandidate {
	out := cands[:0:0]
	for _, c := range cands {
		if _, ok := allowed[c.MatchKey]; ok {
			out = append(out, c)
		}
	}
	return out
}

// demoteDuplicate pulls one run-created match into the ambiguous queue:
// store rows rewrite onto the sentinel atomically, then the run's
// in-memory mirrors follow and the re-aggregated record is emitted so
// the UI moves it to the Unknown tab live. Returns false when nothing
// was demoted (store error or the rows vanished mid-run).
func (st *parseRunState) demoteDuplicate(c createdKey, cands []db.AmbiguousCandidate) bool {
	sentinel := match.NewAmbiguousMatchKey(c.earliestFile).String()
	ok, err := st.app.store.DemoteMatchToAmbiguous(c.key, sentinel, c.earliestFile, cands)
	if err != nil {
		applog.Subsystem("parse").Error("duplicate sweep: demote failed",
			"match_key", c.key, "err", err)
		return false
	}
	if !ok {
		return false
	}
	st.rewriteSnapshotKey(c.key, sentinel)
	st.applyAmbiguityToSnapshot(c.earliestFile, cands)
	if _, updated := st.matchesUpdated[c.key]; updated {
		delete(st.matchesUpdated, c.key)
		st.matchesUpdated[sentinel] = struct{}{}
	}
	if rec, found := aggregate.MatchKey(sentinel, st.snap, st.sidecars); found {
		st.app.emitMatchUpdated(rec)
	}
	return true
}

// rewriteSnapshotKey mirrors DemoteMatchToAmbiguous's UPDATE across the
// carried snapshot so later sweep iterations see the demoted rows under
// their sentinel.
func (st *parseRunState) rewriteSnapshotKey(from, to string) {
	forEachParentRowKey(&st.snap, func(_ string, matchKey *string) {
		if *matchKey == from {
			*matchKey = to
		}
	})
}

// snapshotMatchKeys returns every match_key present in the snapshot,
// across all five parent slices.
func snapshotMatchKeys(snap db.Screenshots) map[string]struct{} {
	keys := map[string]struct{}{}
	forEachParentRowKey(&snap, func(_ string, matchKey *string) {
		keys[*matchKey] = struct{}{}
	})
	return keys
}

// forEachParentRowKey visits every row across the snapshot's five parent
// slices, handing fn the row's filename and a mutable pointer to its match
// key — one traversal shared by the key collectors and the sentinel rewrite.
func forEachParentRowKey(snap *db.Screenshots, fn func(filename string, matchKey *string)) {
	for i := range snap.Summaries {
		fn(snap.Summaries[i].Filename, &snap.Summaries[i].MatchKey)
	}
	for i := range snap.Teams {
		fn(snap.Teams[i].Filename, &snap.Teams[i].MatchKey)
	}
	for i := range snap.Personals {
		fn(snap.Personals[i].Filename, &snap.Personals[i].MatchKey)
	}
	for i := range snap.Ranks {
		fn(snap.Ranks[i].Filename, &snap.Ranks[i].MatchKey)
	}
	for i := range snap.Unknowns {
		fn(snap.Unknowns[i].Filename, &snap.Unknowns[i].MatchKey)
	}
}
