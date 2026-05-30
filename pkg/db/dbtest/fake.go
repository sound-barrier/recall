// Package dbtest provides a shared in-memory db.Store implementation
// for tests that wire pkg/app or pkg/cmd against a fake persistence
// layer. The same Fake handles both "seeded fixture" tests (pkg/app's
// store_integration_test.go shape) and "stub returns + call tracking"
// tests (pkg/cmd's server_test.go shape).
//
// Defining the fake in one place keeps it in lockstep with the
// `db.Store` interface — when the interface grows, the compile error
// surfaces here exactly once, not silently in whichever test package
// forgot to update its private fakeStore.
package dbtest

import (
	"errors"
	"strings"
	"sync"

	"recall/pkg/db"
)

// Fake is an in-memory db.Store. Public fields are set directly by
// tests that want to seed fixtures; HideCalls / UnhideCalls /
// ClearCalls / etc. are inspected for "did the App layer call into
// us?" assertions. All access is guarded by `mu`.
//
// Default zero-value behaviour: every method succeeds with empty
// state. For fixture-driven tests, set the slices/maps before passing
// the *Fake to `app.NewWithStore(...)`.
type Fake struct {
	mu sync.Mutex

	Summaries   []db.SummaryRow
	Scoreboards []db.ScoreboardRow
	Personals   []db.PersonalRow
	Ranks       []db.RankRow
	Unknowns    []db.UnknownRow

	DirIDs      map[string]int64
	Annotations map[string]db.Annotation
	Hidden      map[string]bool

	// Ambiguous holds one candidate-list per filename. Tests seed it
	// directly to verify aggregator behavior for ambiguous screenshots
	// without going through the resolver / write path.
	Ambiguous map[string][]db.AmbiguousCandidate

	// Inspectable counters / call lists. Tests assert on these to
	// verify the App layer (or HTTP handlers) actually reached the
	// store.
	UpsertCalls int
	ClearCalls  int
	CloseCalls  int
	HideCalls   []string
	UnhideCalls []string

	// Error injection. When non-nil, Upsert* methods return UpsertErr
	// and LoadAll returns LoadErr (after acquiring the mutex).
	UpsertErr error
	LoadErr   error
}

// New returns an empty Fake. Tests that need fixtures can mutate the
// public fields directly before wiring it into `app.NewWithStore`.
func New() *Fake { return &Fake{} }

var _ db.Store = (*Fake)(nil)

func (f *Fake) LoadAllFilenames() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]bool{}
	for _, r := range f.Summaries {
		out[r.Filename] = true
	}
	for _, r := range f.Scoreboards {
		out[r.Filename] = true
	}
	for _, r := range f.Personals {
		out[r.Filename] = true
	}
	for _, r := range f.Ranks {
		out[r.Filename] = true
	}
	for _, r := range f.Unknowns {
		out[r.Filename] = true
	}
	return out, nil
}

func (f *Fake) LoadAll() (db.Screenshots, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.LoadErr != nil {
		return db.Screenshots{}, f.LoadErr
	}
	dirs := make(map[int64]string, len(f.DirIDs))
	for path, id := range f.DirIDs {
		dirs[id] = path
	}
	ambig := make(map[string][]db.AmbiguousCandidate, len(f.Ambiguous))
	for k, v := range f.Ambiguous {
		ambig[k] = append([]db.AmbiguousCandidate(nil), v...)
	}
	return db.Screenshots{
		Summaries:           append([]db.SummaryRow(nil), f.Summaries...),
		Scoreboards:         append([]db.ScoreboardRow(nil), f.Scoreboards...),
		Personals:           append([]db.PersonalRow(nil), f.Personals...),
		Ranks:               append([]db.RankRow(nil), f.Ranks...),
		Unknowns:            append([]db.UnknownRow(nil), f.Unknowns...),
		ScreenshotsDirs:     dirs,
		AmbiguousCandidates: ambig,
	}, nil
}

func (f *Fake) UpsertSummary(r db.SummaryRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.UpsertCalls++
	if f.UpsertErr != nil {
		return f.UpsertErr
	}
	for i, ex := range f.Summaries {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Summaries[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.Summaries) + 1)
	f.Summaries = append(f.Summaries, r)
	return nil
}

func (f *Fake) UpsertScoreboard(r db.ScoreboardRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.UpsertCalls++
	if f.UpsertErr != nil {
		return f.UpsertErr
	}
	for i, ex := range f.Scoreboards {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Scoreboards[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.Scoreboards) + 1)
	f.Scoreboards = append(f.Scoreboards, r)
	return nil
}

func (f *Fake) UpsertPersonal(r db.PersonalRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.UpsertCalls++
	if f.UpsertErr != nil {
		return f.UpsertErr
	}
	for i, ex := range f.Personals {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Personals[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.Personals) + 1)
	f.Personals = append(f.Personals, r)
	return nil
}

func (f *Fake) UpsertRank(r db.RankRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.UpsertCalls++
	if f.UpsertErr != nil {
		return f.UpsertErr
	}
	for i, ex := range f.Ranks {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Ranks[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.Ranks) + 1)
	f.Ranks = append(f.Ranks, r)
	return nil
}

func (f *Fake) UpsertUnknown(r db.UnknownRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.UpsertCalls++
	if f.UpsertErr != nil {
		return f.UpsertErr
	}
	for i, ex := range f.Unknowns {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Unknowns[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.Unknowns) + 1)
	f.Unknowns = append(f.Unknowns, r)
	return nil
}

func (f *Fake) Clear() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ClearCalls++
	f.Summaries = nil
	f.Scoreboards = nil
	f.Personals = nil
	f.Ranks = nil
	f.Unknowns = nil
	f.DirIDs = nil
	return nil
}

func (f *Fake) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.CloseCalls++
	return nil
}

func (f *Fake) EnsureScreenshotsDir(path string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if path == "" {
		return 0, nil
	}
	if f.DirIDs == nil {
		f.DirIDs = map[string]int64{}
	}
	if id, ok := f.DirIDs[path]; ok {
		return id, nil
	}
	id := int64(len(f.DirIDs) + 1)
	f.DirIDs[path] = id
	return id, nil
}

func (f *Fake) SetAnnotation(a db.Annotation) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Annotations == nil {
		f.Annotations = map[string]db.Annotation{}
	}
	f.Annotations[a.MatchKey] = a
	return nil
}

func (f *Fake) DeleteAnnotation(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Annotations, matchKey)
	return nil
}

func (f *Fake) LoadAnnotations() (map[string]db.Annotation, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.Annotation, len(f.Annotations))
	for k, v := range f.Annotations {
		out[k] = v
	}
	return out, nil
}

func (f *Fake) HideMatch(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.HideCalls = append(f.HideCalls, matchKey)
	if f.Hidden == nil {
		f.Hidden = map[string]bool{}
	}
	f.Hidden[matchKey] = true
	return nil
}

func (f *Fake) UnhideMatch(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.UnhideCalls = append(f.UnhideCalls, matchKey)
	delete(f.Hidden, matchKey)
	return nil
}

func (f *Fake) LoadHiddenKeys() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]bool, len(f.Hidden))
	for k, v := range f.Hidden {
		out[k] = v
	}
	return out, nil
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
	cands, ok := f.Ambiguous[filename]
	if !ok {
		return nil, db.ErrAmbiguousNotFound
	}
	return append([]db.AmbiguousCandidate(nil), cands...), nil
}

func (f *Fake) ResolveAmbiguous(ambiguousMatchKey, newMatchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !strings.HasPrefix(ambiguousMatchKey, "ambiguous:") {
		return errors.New("ambiguousMatchKey must start with 'ambiguous:'")
	}
	filename := strings.TrimPrefix(ambiguousMatchKey, "ambiguous:")
	if _, ok := f.Ambiguous[filename]; !ok {
		return db.ErrAmbiguousNotFound
	}
	delete(f.Ambiguous, filename)
	for i, r := range f.Summaries {
		if r.MatchKey == ambiguousMatchKey {
			f.Summaries[i].MatchKey = newMatchKey
		}
	}
	for i, r := range f.Scoreboards {
		if r.MatchKey == ambiguousMatchKey {
			f.Scoreboards[i].MatchKey = newMatchKey
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
	return nil
}
