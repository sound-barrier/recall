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

// sweepNewMatchDuplicates demotes run-created tracked matches whose
// TEAMS stat line duplicates an existing match's. Demotion failures are
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
		cands := filterCandidateKeys(correlate.FindDuplicateMatches(c.key, st.snap), surviving)
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
	consider := func(filename, key string) {
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
	for _, r := range st.snap.Summaries {
		consider(r.Filename, r.MatchKey)
	}
	for _, r := range st.snap.Teams {
		consider(r.Filename, r.MatchKey)
	}
	for _, r := range st.snap.Personals {
		consider(r.Filename, r.MatchKey)
	}
	for _, r := range st.snap.Ranks {
		consider(r.Filename, r.MatchKey)
	}
	for _, r := range st.snap.Unknowns {
		consider(r.Filename, r.MatchKey)
	}
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
	if rec, found := aggregate.MatchKey(sentinel, st.snap, st.annos, st.hidden, st.reviews, st.pinned); found {
		st.app.emitMatchUpdated(rec)
	}
	return true
}

// rewriteSnapshotKey mirrors DemoteMatchToAmbiguous's UPDATE across the
// carried snapshot so later sweep iterations see the demoted rows under
// their sentinel.
func (st *parseRunState) rewriteSnapshotKey(from, to string) {
	for i := range st.snap.Summaries {
		if st.snap.Summaries[i].MatchKey == from {
			st.snap.Summaries[i].MatchKey = to
		}
	}
	for i := range st.snap.Teams {
		if st.snap.Teams[i].MatchKey == from {
			st.snap.Teams[i].MatchKey = to
		}
	}
	for i := range st.snap.Personals {
		if st.snap.Personals[i].MatchKey == from {
			st.snap.Personals[i].MatchKey = to
		}
	}
	for i := range st.snap.Ranks {
		if st.snap.Ranks[i].MatchKey == from {
			st.snap.Ranks[i].MatchKey = to
		}
	}
	for i := range st.snap.Unknowns {
		if st.snap.Unknowns[i].MatchKey == from {
			st.snap.Unknowns[i].MatchKey = to
		}
	}
}

// snapshotMatchKeys returns every match_key present in the snapshot,
// across all five parent slices.
func snapshotMatchKeys(snap db.Screenshots) map[string]struct{} {
	keys := map[string]struct{}{}
	for _, r := range snap.Summaries {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range snap.Teams {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range snap.Personals {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range snap.Ranks {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range snap.Unknowns {
		keys[r.MatchKey] = struct{}{}
	}
	return keys
}
