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
	"sort"
	"strings"
	"sync"
	"time"

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
	// Reviews maps match_key → ReviewState (reviewer + timestamp).
	// Absence of an entry means "not reviewed."
	Reviews map[string]db.ReviewState

	// Queues maps match_key → QueueState (queue_type + timestamp).
	// Absence of an entry means "queue not set."
	Queues map[string]db.QueueState

	// PlayModes maps match_key → PlayModeState (play_mode +
	// timestamp). Absence means "no user override" — the aggregator
	// falls back to data.mode + rank-row presence.
	PlayModes map[string]db.PlayModeState

	// Ignored is the suppress-list keyed by filename. Presence means
	// the parse pipeline should skip that file. Absence is the normal
	// "fair game" state. Tests seed this map directly or assert on it
	// after calling AddIgnoredScreenshot.
	Ignored map[string]bool

	// IgnoredAt maps filename → the timestamp at which it was ignored.
	// Parallel to Ignored so ListIgnoredScreenshots can return rows in
	// time order. AddIgnoredScreenshot stamps time.Now().UTC() formatted
	// the same way SQLite's CURRENT_TIMESTAMP renders ("2026-06-05T...");
	// tests that need a deterministic timestamp seed this map directly
	// before reading.
	IgnoredAt map[string]string

	// Ambiguous holds one candidate-list per filename. Tests seed it
	// directly to verify aggregator behavior for ambiguous screenshots
	// without going through the resolver / write path.
	Ambiguous map[string][]db.AmbiguousCandidate

	// Inspectable counters / call lists. Tests assert on these to
	// verify the App layer (or HTTP handlers) actually reached the
	// store.
	UpsertCalls     int
	ClearCalls      int
	CloseCalls      int
	HideCalls       []string
	UnhideCalls     []string
	HardDeleteCalls []string

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

func (f *Fake) LookupMatchKeysForFilename(filename string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	seen := map[string]bool{}
	for _, r := range f.Summaries {
		if r.Filename == filename {
			seen[r.MatchKey] = true
		}
	}
	for _, r := range f.Scoreboards {
		if r.Filename == filename {
			seen[r.MatchKey] = true
		}
	}
	for _, r := range f.Personals {
		if r.Filename == filename {
			seen[r.MatchKey] = true
		}
	}
	for _, r := range f.Ranks {
		if r.Filename == filename {
			seen[r.MatchKey] = true
		}
	}
	for _, r := range f.Unknowns {
		if r.Filename == filename {
			seen[r.MatchKey] = true
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
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
	f.Annotations = nil
	f.Hidden = nil
	f.Reviews = nil
	f.Queues = nil
	f.PlayModes = nil
	f.Ambiguous = nil
	f.Ignored = nil
	f.IgnoredAt = nil
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

// LookupScreenshotsDir mirrors SQLStore: 0 → empty, unknown id →
// empty, otherwise the seeded path. The reverse-lookup walk is fine
// in-memory; tests seed at most a handful of dirs.
func (f *Fake) LookupScreenshotsDir(id int64) (string, error) {
	if id == 0 {
		return "", nil
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for path, dirID := range f.DirIDs {
		if dirID == id {
			return path, nil
		}
	}
	return "", nil
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

func (f *Fake) HardDeleteMatch(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.HardDeleteCalls = append(f.HardDeleteCalls, matchKey)
	sums := f.Summaries[:0]
	for _, r := range f.Summaries {
		if r.MatchKey != matchKey {
			sums = append(sums, r)
		}
	}
	f.Summaries = sums
	sbs := f.Scoreboards[:0]
	for _, r := range f.Scoreboards {
		if r.MatchKey != matchKey {
			sbs = append(sbs, r)
		}
	}
	f.Scoreboards = sbs
	pers := f.Personals[:0]
	for _, r := range f.Personals {
		if r.MatchKey != matchKey {
			pers = append(pers, r)
		}
	}
	f.Personals = pers
	rnks := f.Ranks[:0]
	for _, r := range f.Ranks {
		if r.MatchKey != matchKey {
			rnks = append(rnks, r)
		}
	}
	f.Ranks = rnks
	unks := f.Unknowns[:0]
	for _, r := range f.Unknowns {
		if r.MatchKey != matchKey {
			unks = append(unks, r)
		}
	}
	f.Unknowns = unks
	delete(f.Hidden, matchKey)
	delete(f.Annotations, matchKey)
	delete(f.Reviews, matchKey)
	return nil
}

func (f *Fake) SetReview(matchKey, reviewedBy string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Reviews == nil {
		f.Reviews = map[string]db.ReviewState{}
	}
	// Preserve a previously-seeded ReviewedAt if the test set one;
	// otherwise stamp "now" so dossier coverage that fans out across
	// the Fake observes a non-empty timestamp.
	prev := f.Reviews[matchKey]
	if prev.ReviewedAt == "" {
		prev.ReviewedAt = time.Now().UTC().Format(time.RFC3339)
	}
	prev.ReviewedBy = reviewedBy
	f.Reviews[matchKey] = prev
	return nil
}

func (f *Fake) ClearReview(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Reviews, matchKey)
	return nil
}

func (f *Fake) LoadReviews() (map[string]db.ReviewState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.ReviewState, len(f.Reviews))
	for k, v := range f.Reviews {
		out[k] = v
	}
	return out, nil
}

func (f *Fake) SetMatchQueue(matchKey, queueType string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.Queues == nil {
		f.Queues = map[string]db.QueueState{}
	}
	prev := f.Queues[matchKey]
	if prev.SetAt == "" {
		prev.SetAt = time.Now().UTC().Format(time.RFC3339)
	}
	prev.QueueType = queueType
	f.Queues[matchKey] = prev
	return nil
}

func (f *Fake) ClearMatchQueue(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Queues, matchKey)
	return nil
}

func (f *Fake) BulkSetMatchQueue(matchKeys []string, queueType string) error {
	for _, k := range matchKeys {
		if queueType == "" {
			if err := f.ClearMatchQueue(k); err != nil {
				return err
			}
			continue
		}
		if err := f.SetMatchQueue(k, queueType); err != nil {
			return err
		}
	}
	return nil
}

func (f *Fake) LoadMatchQueues() (map[string]db.QueueState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.QueueState, len(f.Queues))
	for k, v := range f.Queues {
		out[k] = v
	}
	return out, nil
}

func (f *Fake) SetMatchPlayMode(matchKey, playMode string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.PlayModes == nil {
		f.PlayModes = map[string]db.PlayModeState{}
	}
	prev := f.PlayModes[matchKey]
	if prev.SetAt == "" {
		prev.SetAt = time.Now().UTC().Format(time.RFC3339)
	}
	prev.PlayMode = playMode
	f.PlayModes[matchKey] = prev
	return nil
}

func (f *Fake) ClearMatchPlayMode(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.PlayModes, matchKey)
	return nil
}

// ReAggregateUnknowns walks Fake's Summaries / Scoreboards /
// Personals slices and applies the same hero/map-promotion logic
// the SQL store does. Used by App-level tests that exercise the
// boot re-aggregator without needing a real SQLite.
func (f *Fake) ReAggregateUnknowns(heroFn func(rawHero string) string, mapFn func(rawMap string) string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	promoted := 0
	for i := range f.Summaries {
		if f.Summaries[i].Hero == "" && f.Summaries[i].HeroRaw != "" {
			if c := heroFn(f.Summaries[i].HeroRaw); c != "" {
				f.Summaries[i].Hero = c
				promoted++
			}
		}
		if f.Summaries[i].Map == "" && f.Summaries[i].MapRaw != "" {
			if c := mapFn(f.Summaries[i].MapRaw); c != "" {
				f.Summaries[i].Map = c
				promoted++
			}
		}
	}
	for i := range f.Scoreboards {
		if f.Scoreboards[i].Hero == "" && f.Scoreboards[i].HeroRaw != "" {
			if c := heroFn(f.Scoreboards[i].HeroRaw); c != "" {
				f.Scoreboards[i].Hero = c
				promoted++
			}
		}
		if f.Scoreboards[i].Map == "" && f.Scoreboards[i].MapRaw != "" {
			if c := mapFn(f.Scoreboards[i].MapRaw); c != "" {
				f.Scoreboards[i].Map = c
				promoted++
			}
		}
	}
	for i := range f.Personals {
		if f.Personals[i].Hero == "" && f.Personals[i].HeroRaw != "" {
			if c := heroFn(f.Personals[i].HeroRaw); c != "" {
				f.Personals[i].Hero = c
				promoted++
			}
		}
	}
	return promoted, nil
}

func (f *Fake) BulkSetMatchPlayMode(matchKeys []string, playMode string) error {
	for _, k := range matchKeys {
		if playMode == "" {
			if err := f.ClearMatchPlayMode(k); err != nil {
				return err
			}
			continue
		}
		if err := f.SetMatchPlayMode(k, playMode); err != nil {
			return err
		}
	}
	return nil
}

func (f *Fake) LoadMatchPlayModes() (map[string]db.PlayModeState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.PlayModeState, len(f.PlayModes))
	for k, v := range f.PlayModes {
		out[k] = v
	}
	return out, nil
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
	for k, v := range f.Ignored {
		out[k] = v
	}
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
	return true, nil
}
