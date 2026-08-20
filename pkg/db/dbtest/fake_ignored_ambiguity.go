package dbtest

import (
	"cmp"
	"maps"
	"slices"
	"sort"
	"strings"
	"time"

	"recall/pkg/db"
)

// sortedCandidates copies a candidate list into ascending-distance order,
// mirroring the `ORDER BY distance_seconds ASC` every SQLStore read surface
// applies — the order the review card ranks candidates in. Stable, so ties
// keep insertion order the way SQLite's rowid tiebreak does.
func sortedCandidates(cands []db.AmbiguousCandidate) []db.AmbiguousCandidate {
	out := append([]db.AmbiguousCandidate(nil), cands...)
	slices.SortStableFunc(out, func(a, b db.AmbiguousCandidate) int {
		return cmp.Compare(a.DistanceSeconds, b.DistanceSeconds)
	})
	return out
}

func (f *Fake) UpsertIngestedFile(filename, contentHash, duplicateOf string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.IngestedFiles == nil {
		f.IngestedFiles = map[string]db.IngestedFile{}
	}
	f.IngestedFiles[filename] = db.IngestedFile{ContentHash: contentHash, DuplicateOf: duplicateOf}
	return nil
}

func (f *Fake) LoadIngestedFiles() (map[string]db.IngestedFile, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.IngestedFile, len(f.IngestedFiles))
	maps.Copy(out, f.IngestedFiles)
	return out, nil
}

func (f *Fake) AddIgnoredScreenshot(filename string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Ignored == nil {
		f.Ignored = map[string]bool{}
	}
	if f.IgnoredAt == nil {
		f.IgnoredAt = map[string]string{}
	}
	f.Ignored[filename] = true
	f.IgnoredAt[filename] = time.Now().UTC().Format(time.RFC3339)
	return nil
}

func (f *Fake) RemoveIgnoredScreenshot(filename string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Ignored, filename)
	delete(f.IgnoredAt, filename)
	return nil
}

func (f *Fake) LoadIgnoredFilenames() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]bool, len(f.Ignored))
	maps.Copy(out, f.Ignored)
	return out, nil
}

// ListIgnoredScreenshots returns rows for every filename in Ignored,
// sorted by IgnoredAt DESC then filename ASC — same ordering the
// SQLStore implementation uses. Missing IgnoredAt entries fall back
// to the empty string (still ordered lexically).
func (f *Fake) ListIgnoredScreenshots() ([]db.IgnoredRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]db.IgnoredRow, 0, len(f.Ignored))
	for fn := range f.Ignored {
		out = append(out, db.IgnoredRow{Filename: fn, IgnoredAt: f.IgnoredAt[fn]})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IgnoredAt != out[j].IgnoredAt {
			return out[i].IgnoredAt > out[j].IgnoredAt
		}
		return out[i].Filename < out[j].Filename
	})
	return out, nil
}

func (f *Fake) ClearIgnoredScreenshots() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Ignored = nil
	f.IgnoredAt = nil
	return nil
}

func (f *Fake) ApplyAmbiguity(filename string, cands []db.AmbiguousCandidate) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Ambiguous == nil {
		f.Ambiguous = map[string][]db.AmbiguousCandidate{}
	}
	if len(cands) == 0 {
		delete(f.Ambiguous, filename)
		return nil
	}
	f.Ambiguous[filename] = append([]db.AmbiguousCandidate(nil), cands...)
	return nil
}

func (f *Fake) LoadAmbiguousCandidatesFor(filename string) ([]db.AmbiguousCandidate, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return sortedCandidates(f.Ambiguous[filename]), nil
}

func (f *Fake) DemoteMatchToAmbiguous(matchKey, ambiguousMatchKey, filename string, cands []db.AmbiguousCandidate) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rewritten := rekeyRows(f.Summaries, matchKey, ambiguousMatchKey) +
		rekeyRows(f.Teams, matchKey, ambiguousMatchKey) +
		rekeyRows(f.Personals, matchKey, ambiguousMatchKey) +
		rekeyRows(f.Ranks, matchKey, ambiguousMatchKey) +
		rekeyRows(f.Unknowns, matchKey, ambiguousMatchKey)
	if rewritten == 0 {
		return false, nil
	}
	if f.Ambiguous == nil {
		f.Ambiguous = map[string][]db.AmbiguousCandidate{}
	}
	f.Ambiguous[filename] = append([]db.AmbiguousCandidate(nil), cands...)
	return true, nil
}

func (f *Fake) ResolveAmbiguous(filename, ambiguousMatchKey, newMatchKey string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !strings.HasPrefix(ambiguousMatchKey, "ambiguous-") {
		return false, nil
	}
	if _, ok := f.Ambiguous[filename]; !ok {
		return false, nil
	}
	delete(f.Ambiguous, filename)
	f.renameMatchKey(ambiguousMatchKey, newMatchKey)
	return true, nil
}

// renameMatchKey mirrors SQLStore.renameMatchKey: match_key is the match's
// identity and it is mutable, so a rename has to reach EVERY collection that
// names a match — not just the five parents. A fake that moved only the
// parents would let a test pass while production stranded the user's pins,
// notes and overrides on a dead key (and grew a phantom manual match out of
// the orphaned override row).
func (f *Fake) renameMatchKey(from, to string) {
	rekeyRows(f.Summaries, from, to)
	rekeyRows(f.Teams, from, to)
	rekeyRows(f.Personals, from, to)
	rekeyRows(f.Ranks, from, to)
	rekeyRows(f.Unknowns, from, to)

	rekeyBool(f.Hidden, from, to)
	rekeyBool(f.Pinned, from, to)
	rekeyMap(f.Reviews, from, to)
	rekeyMap(f.Queues, from, to)
	rekeyMap(f.PlayModes, from, to)
	rekeyMap(f.UserMatchData, from, to)
	rekeyMap(f.MatchMoments, from, to)
	if a, ok := f.Annotations[from]; ok {
		a.MatchKey = to
		f.Annotations[to] = a
		delete(f.Annotations, from)
	}
	for i := range f.MatchCoachNotes {
		if f.MatchCoachNotes[i].MatchKey == from {
			f.MatchCoachNotes[i].MatchKey = to
		}
	}
	f.renameInSelfReviews(from, to)
	f.renameInCandidates(from, to)
}

// A sitting names its members by key and files its notes under the same, so
// both move.
func (f *Fake) renameInSelfReviews(from, to string) {
	for id, r := range f.SelfReviews {
		for i, k := range r.MatchKeys {
			if k == from {
				r.MatchKeys[i] = to
			}
		}
		if n, ok := r.Notes[from]; ok {
			n.MatchKey = to
			r.Notes[to] = n
			delete(r.Notes, from)
		}
		f.SelfReviews[id] = r
	}
}

// A candidate naming the old key would offer the user an attachment that
// resurrects a match that no longer exists under that name.
func (f *Fake) renameInCandidates(from, to string) {
	for filename, cands := range f.Ambiguous {
		for i := range cands {
			if cands[i].MatchKey == from {
				cands[i].MatchKey = to
			}
		}
		f.Ambiguous[filename] = cands
	}
}

func rekeyBool(m map[string]bool, from, to string) {
	if v, ok := m[from]; ok {
		m[to] = v
		delete(m, from)
	}
}

func rekeyMap[V any](m map[string]V, from, to string) {
	if v, ok := m[from]; ok {
		m[to] = v
		delete(m, from)
	}
}
