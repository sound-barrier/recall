package dbtest

import (
	"sync"

	"recall/pkg/db"
)

// Fake is an in-memory db.Store. Public fields are set directly by
// tests that want to seed fixtures; HideCalls / UnhideCalls /
// ClearCalls / etc. are inspected for "did the App layer call into
// us?" assertions. All access is guarded by `mu`.
//
// Default zero-value behavior: every method succeeds with empty
// state. For fixture-driven tests, set the slices/maps before passing
// the *Fake to `app.NewWithStore(...)`.
type Fake struct {
	mu sync.Mutex

	Summaries []db.SummaryRow
	Teams     []db.TeamsRow
	Personals []db.PersonalRow
	Ranks     []db.RankRow
	Unknowns  []db.UnknownRow

	DirIDs      map[string]int64
	Annotations map[string]db.Annotation
	Hidden      map[string]bool
	Pinned      map[string]bool

	// UserMatchData maps match_key → the per-match user override layer
	// (inline edits + hand-entered matches). Absence = pure OCR / no match.
	UserMatchData map[string]db.UserMatchData

	// Reviews maps match_key → ReviewState (reviewer + timestamp).
	// Absence of an entry means "not reviewed."
	Reviews map[string]db.ReviewState

	// The "share with a coach" sent ledger, in insertion order.
	shareExports   []db.ShareExport
	shareExportSeq int64

	// The focus list — "what to work on" as rows, in its three families.
	CoachFocusItems      map[int64][]db.FocusItem
	SelfReviewFocusItems map[string][]db.FocusItem
	ReceivedFocusItems   []db.ReceivedFocusItem

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
	Ignored       map[string]bool
	IngestedFiles map[string]db.IngestedFile

	// IgnoredAt maps filename → the timestamp at which it was ignored.
	// Parallel to Ignored so ListIgnoredScreenshots can return rows in
	// time order. AddIgnoredScreenshot stamps time.Now().UTC() as RFC3339
	// ("2026-06-05T...Z"), matching the byte-identical value the STRICT
	// TEXT ignored_at column stores via strftime('%Y-%m-%dT%H:%M:%SZ');
	// tests that need a deterministic timestamp seed this map directly
	// before reading.
	IgnoredAt map[string]string

	// AllHeroes is the recognized-skip set keyed by filename — the Fake
	// analog of the all_heroes_screenshots table. Presence means the parser
	// recognized the PERSONAL "All Heroes" aggregate view and the write path
	// recorded it so the next parse run skips it. Mirrors Ignored's role.
	AllHeroes map[string]bool

	// FailedFiles is the OCR-failure ledger keyed by filename — the Fake
	// analog of the failed_files table. RecordFailedFile upserts
	// (attempts+1, refreshed error/last_failed_at); RemoveFailedFile
	// deletes. Tests seed rows directly or assert after a parse run.
	FailedFiles map[string]db.FailedFileRow

	// Ambiguous holds one candidate-list per filename. Tests seed it
	// directly to verify aggregator behavior for ambiguous screenshots
	// without going through the resolver / write path.
	Ambiguous map[string][]db.AmbiguousCandidate

	// Coach-AUTHORED family (survives Clear): players this user has
	// coached, their notes keyed player id → match_key, and the per-player
	// session summary. Coach-RECEIVED family (wiped like match history):
	// accepted blocks on this user's own matches and the staged returns
	// they came from (decisions live inside each CoachReturn).
	CoachPlayers []db.CoachPlayer
	// The player's own timestamped moments, keyed by match.
	MatchMoments map[string][]db.MatchMoment
	CoachNotes   map[int64]map[string]db.CoachNote
	// Keyed by the parent note's PUBLIC id, mirroring the SQL loader.
	CoachNoteMoments map[string][]db.CoachNoteMoment
	MatchCoachNotes  []db.MatchCoachNote
	CoachReturns     []db.CoachReturn
	// The player's saved self-review sittings, keyed by review_id — match
	// history like the received layer (wiped by Clear; HardDeleteMatch takes
	// the match out of every review it was in).
	SelfReviews map[string]db.SelfReview

	// Inspectable counters / call lists. Tests assert on these to
	// verify the App layer (or HTTP handlers) actually reached the
	// store.
	UpsertCalls     int
	OptimizeCalls   int
	ClearCalls      int
	CloseCalls      int
	HideCalls       []string
	UnhideCalls     []string
	HardDeleteCalls []string

	// Error injection. When non-nil, Upsert* methods return UpsertErr,
	// LoadAll returns LoadErr, and ApplyAmbiguity returns AmbiguityErr
	// (each after acquiring the mutex).
	UpsertErr    error
	LoadErr      error
	AmbiguityErr error
}

// New returns an empty Fake. Tests that need fixtures can mutate the
// public fields directly before wiring it into `app.NewWithStore`.
func New() *Fake { return &Fake{} }

// suppliedInstantOrNow mirrors the SQL expression of the same name: the
// caller's instant when a restore supplies one, the Fake's clock when it
// doesn't. Only a parent INSERT consults it on the row path — a re-parse
// keeps the stamp the row already carries.
func suppliedInstantOrNow(supplied string) string {
	if supplied != "" {
		return supplied
	}
	return nowRFC3339()
}

var _ db.Store = (*Fake)(nil)

// LoadFilenamesForDir mirrors the SQL store: the parse skip set is scoped to
// ONE folder, because filename is a basename and a same-named capture in a
// second folder is a different screenshot.
func (f *Fake) LoadFilenamesForDir(dirID int64) (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]bool{}
	collectForDir(out, dirID, f.Summaries, func(r db.SummaryRow) (string, int64) { return r.Filename, r.ScreenshotsDirID })
	collectForDir(out, dirID, f.Teams, func(r db.TeamsRow) (string, int64) { return r.Filename, r.ScreenshotsDirID })
	collectForDir(out, dirID, f.Personals, func(r db.PersonalRow) (string, int64) { return r.Filename, r.ScreenshotsDirID })
	collectForDir(out, dirID, f.Ranks, func(r db.RankRow) (string, int64) { return r.Filename, r.ScreenshotsDirID })
	collectForDir(out, dirID, f.Unknowns, func(r db.UnknownRow) (string, int64) { return r.Filename, r.ScreenshotsDirID })
	return out, nil
}

func collectForDir[T any](out map[string]bool, dirID int64, rows []T, at func(T) (string, int64)) {
	for _, r := range rows {
		if name, dir := at(r); dir == dirID {
			out[name] = true
		}
	}
}

func (f *Fake) LoadAllFilenames() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]bool{}
	for _, r := range f.Summaries {
		out[r.Filename] = true
	}
	for _, r := range f.Teams {
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

// staleKeys adds the match keys of rows older than current to seen. Generic so
// the five parent tables share one branch instead of five copies.
func staleKeys[T any](rows []T, current int, seen map[string]struct{}, read func(T) (key string, gen int)) {
	for _, r := range rows {
		if key, gen := read(r); gen < current {
			seen[key] = struct{}{}
		}
	}
}

// StaleParseCount implements db.Store. Mirrors SQLStore: distinct MATCH keys
// with at least one row below `current`, treating an unstamped 0 as stale the
// way the SQL treats NULL.
func (f *Fake) StaleParseCount(current int) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	keys := map[string]struct{}{}
	// Mirrors SQLStore's exclusion of all-heroes-registered files: their rows are
	// deliberately kept but can never be improved by a re-parse.
	skip := func(filename string) bool { return f.AllHeroes[filename] }
	staleKeys(f.Summaries, current, keys, func(r db.SummaryRow) (string, int) {
		if skip(r.Filename) {
			return "", current
		}
		return r.MatchKey, r.ParserGeneration
	})
	staleKeys(f.Teams, current, keys, func(r db.TeamsRow) (string, int) { return r.MatchKey, r.ParserGeneration })
	staleKeys(f.Personals, current, keys, func(r db.PersonalRow) (string, int) { return r.MatchKey, r.ParserGeneration })
	staleKeys(f.Ranks, current, keys, func(r db.RankRow) (string, int) { return r.MatchKey, r.ParserGeneration })
	staleKeys(f.Unknowns, current, keys, func(r db.UnknownRow) (string, int) { return r.MatchKey, r.ParserGeneration })
	return len(keys), nil
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
		ambig[k] = sortedCandidates(v)
	}
	return db.Screenshots{
		Summaries:           append([]db.SummaryRow(nil), f.Summaries...),
		Teams:               append([]db.TeamsRow(nil), f.Teams...),
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
		if ex.Filename == r.Filename && ex.ScreenshotsDirID == r.ScreenshotsDirID {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Summaries[i] = r
			return nil
		}
	}
	r.ParsedAt = suppliedInstantOrNow(r.ParsedAt)
	r.ID = int64(len(f.Summaries) + 1)
	f.Summaries = append(f.Summaries, r)
	return nil
}

func (f *Fake) UpsertTeams(r db.TeamsRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.UpsertCalls++
	if f.UpsertErr != nil {
		return f.UpsertErr
	}
	for i, ex := range f.Teams {
		if ex.Filename == r.Filename && ex.ScreenshotsDirID == r.ScreenshotsDirID {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Teams[i] = r
			return nil
		}
	}
	r.ParsedAt = suppliedInstantOrNow(r.ParsedAt)
	r.ID = int64(len(f.Teams) + 1)
	f.Teams = append(f.Teams, r)
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
		if ex.Filename == r.Filename && ex.ScreenshotsDirID == r.ScreenshotsDirID {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Personals[i] = r
			return nil
		}
	}
	r.ParsedAt = suppliedInstantOrNow(r.ParsedAt)
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
		if ex.Filename == r.Filename && ex.ScreenshotsDirID == r.ScreenshotsDirID {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Ranks[i] = r
			return nil
		}
	}
	r.ParsedAt = suppliedInstantOrNow(r.ParsedAt)
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
		if ex.Filename == r.Filename && ex.ScreenshotsDirID == r.ScreenshotsDirID {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.Unknowns[i] = r
			return nil
		}
	}
	r.ParsedAt = suppliedInstantOrNow(r.ParsedAt)
	r.ID = int64(len(f.Unknowns) + 1)
	f.Unknowns = append(f.Unknowns, r)
	return nil
}

// Health reports a canned always-ok snapshot — the Fake has no file
// to stat and nothing to corrupt. CheckedAt is fixed so tests are
// deterministic.
func (f *Fake) Health() (db.Health, error) {
	return db.Health{Integrity: "ok", CheckedAt: "2026-01-01T00:00:00Z"}, nil
}

// Optimize is a no-op — nothing to analyze in memory. Calls are
// counted so the post-parse auto-optimize scheduling is observable.
func (f *Fake) Optimize() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.OptimizeCalls++
	return nil
}

// Vacuum is a no-op — nothing to compact in memory.
func (f *Fake) Vacuum() error { return nil }

func (f *Fake) Clear() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ClearCalls++
	f.Summaries = nil
	f.Teams = nil
	f.Personals = nil
	f.Ranks = nil
	f.Unknowns = nil
	f.DirIDs = nil
	f.Annotations = nil
	f.UserMatchData = nil
	f.Hidden = nil
	f.Reviews = nil
	f.Queues = nil
	f.PlayModes = nil
	f.Ambiguous = nil
	f.Ignored = nil
	f.IgnoredAt = nil
	f.AllHeroes = nil
	// The player's own moments are match history too — the SQL Clear wipes
	// match_moments, and the Fake once did not, which no assertion noticed.
	f.MatchMoments = nil
	// The received coach layer is match history; the authored family
	// (CoachPlayers / CoachNotes / CoachFocusItems) deliberately survives.
	f.MatchCoachNotes = nil
	f.CoachReturns = nil
	f.SelfReviews = nil
	f.shareExports = nil
	// The player-side focus families go with the rest of match history; the
	// coach's AUTHORED list survives, like the summary it replaces.
	f.SelfReviewFocusItems = nil
	f.ReceivedFocusItems = nil
	// The dedup registry. A standing duplicate is skipped before OCR on every
	// run, so a row surviving the wipe withholds its file forever.
	f.IngestedFiles = nil
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
		// Mirror SQLStore: empty path returns the sentinel id so
		// the parent-row FK is always non-null.
		return db.SentinelScreenshotsDirID, nil
	}
	if f.DirIDs == nil {
		f.DirIDs = map[string]int64{}
	}
	if id, ok := f.DirIDs[path]; ok {
		return id, nil
	}
	// New real dirs start at 2 so we never collide with the sentinel.
	id := int64(len(f.DirIDs) + 2)
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

func (f *Fake) HardDeleteMatch(matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.HardDeleteCalls = append(f.HardDeleteCalls, matchKey)
	// Mirror SQLStore: the ambiguity surface forgets the match too — the
	// candidate sets of its own screenshots (sentinel case, keyed by
	// filename, collected before the slices are filtered) and every
	// candidate row referencing the key.
	doomed := map[string]bool{}
	collectFilenamesByKey(f.Summaries, matchKey, doomed)
	collectFilenamesByKey(f.Teams, matchKey, doomed)
	collectFilenamesByKey(f.Personals, matchKey, doomed)
	collectFilenamesByKey(f.Ranks, matchKey, doomed)
	collectFilenamesByKey(f.Unknowns, matchKey, doomed)
	for fn := range doomed {
		delete(f.Ambiguous, fn)
	}
	f.forgetIngestedFiles(doomed)
	for fn, cands := range f.Ambiguous {
		kept := cands[:0]
		for _, c := range cands {
			if c.MatchKey != matchKey {
				kept = append(kept, c)
			}
		}
		f.Ambiguous[fn] = kept
	}
	f.Summaries = dropByMatchKey(f.Summaries, matchKey)
	f.Teams = dropByMatchKey(f.Teams, matchKey)
	f.Personals = dropByMatchKey(f.Personals, matchKey)
	f.Ranks = dropByMatchKey(f.Ranks, matchKey)
	f.Unknowns = dropByMatchKey(f.Unknowns, matchKey)
	delete(f.Hidden, matchKey)
	delete(f.Annotations, matchKey)
	delete(f.Reviews, matchKey)
	delete(f.UserMatchData, matchKey)
	delete(f.Queues, matchKey)
	delete(f.PlayModes, matchKey)
	// The SQL store deletes match_moments by key; the Fake once left them
	// behind and nothing swept that surface.
	delete(f.MatchMoments, matchKey)
	f.dropCoachLayerForKey(matchKey)
	f.dropSelfReviewMembershipForKey(matchKey)
	return nil
}

// forgetIngestedFiles mirrors the SQL store: the deleted match's own files
// leave the dedup registry, and ingested_files.duplicate_of ON DELETE CASCADE
// takes every byte-identical copy of one with them. The Fake keeps no engine,
// so the cascade is spelled out.
func (f *Fake) forgetIngestedFiles(doomed map[string]bool) {
	for fn := range doomed {
		delete(f.IngestedFiles, fn)
	}
	for fn, rec := range f.IngestedFiles {
		if doomed[rec.DuplicateOf] {
			delete(f.IngestedFiles, fn)
		}
	}
}

// ReAggregateUnknowns walks Fake's Summaries / Teams /
// Personals slices and applies the same hero/map-promotion logic
// the SQL store does. Used by App-level tests that exercise the
// boot re-aggregator without needing a real SQLite.
// promoteRaw canonicalizes an empty field from its raw OCR capture,
// returning 1 when the promotion happened (the SQL store's
// hero/map-promotion contract).
func promoteRaw(field *string, raw string, canon func(string) string) int {
	if *field != "" || raw == "" {
		return 0
	}
	c := canon(raw)
	if c == "" {
		return 0
	}
	*field = c
	return 1
}

func (f *Fake) ReAggregateUnknowns(heroFn func(rawHero string) string, mapFn func(rawMap string) string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	promoted := 0
	for i := range f.Summaries {
		promoted += promoteRaw(&f.Summaries[i].Hero, f.Summaries[i].HeroRaw, heroFn)
		promoted += promoteRaw(&f.Summaries[i].Map, f.Summaries[i].MapRaw, mapFn)
	}
	// Teams rows carry no hero/map — the in-game scoreboard is
	// combat-stats-only, so there's nothing to promote.
	for i := range f.Personals {
		promoted += promoteRaw(&f.Personals[i].Hero, f.Personals[i].HeroRaw, heroFn)
	}
	return promoted, nil
}
