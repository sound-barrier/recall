package dbtest

import (
	"maps"
	"sort"
	"strings"
	"time"

	"recall/pkg/db"
)

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
	cands := f.Ambiguous[filename]
	return append([]db.AmbiguousCandidate(nil), cands...), nil
}

func (f *Fake) ResolveAmbiguous(ambiguousMatchKey, newMatchKey string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !strings.HasPrefix(ambiguousMatchKey, "ambiguous-") {
		return false, nil
	}
	filename := strings.TrimPrefix(ambiguousMatchKey, "ambiguous-")
	if _, ok := f.Ambiguous[filename]; !ok {
		return false, nil
	}
	delete(f.Ambiguous, filename)
	for i, r := range f.Summaries {
		if r.MatchKey == ambiguousMatchKey {
			f.Summaries[i].MatchKey = newMatchKey
		}
	}
	for i, r := range f.Teams {
		if r.MatchKey == ambiguousMatchKey {
			f.Teams[i].MatchKey = newMatchKey
		}
	}
	for i, r := range f.Personals {
		if r.MatchKey == ambiguousMatchKey {
			f.Personals[i].MatchKey = newMatchKey
		}
	}
	for i, r := range f.Ranks {
		if r.MatchKey == ambiguousMatchKey {
			f.Ranks[i].MatchKey = newMatchKey
		}
	}
	for i, r := range f.Unknowns {
		if r.MatchKey == ambiguousMatchKey {
			f.Unknowns[i].MatchKey = newMatchKey
		}
	}
	return true, nil
}
