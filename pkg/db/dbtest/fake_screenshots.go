package dbtest

// The five screenshot parent tables — the rows a parse writes, the
// filename and staleness reads over them, and the reclassification wipe.

import (
	"slices"

	"recall/pkg/db"
	"recall/pkg/parser"
)

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
	// Mirrors SQLStore's exclusion of recognized-registry files, in every
	// table: their rows are deliberately kept but a re-parse cannot improve
	// them. (It once applied to summaries only, which the SQL never did.)
	gen := func(file db.FileRef, key string, g int) (string, int) {
		if f.AllHeroes[file] || f.History[file] {
			return "", current
		}
		return key, g
	}
	staleKeys(f.Summaries, current, keys, func(r db.SummaryRow) (string, int) { return gen(rowFile(r), r.MatchKey, r.ParserGeneration) })
	staleKeys(f.Teams, current, keys, func(r db.TeamsRow) (string, int) { return gen(rowFile(r), r.MatchKey, r.ParserGeneration) })
	staleKeys(f.Personals, current, keys, func(r db.PersonalRow) (string, int) { return gen(rowFile(r), r.MatchKey, r.ParserGeneration) })
	staleKeys(f.Ranks, current, keys, func(r db.RankRow) (string, int) { return gen(rowFile(r), r.MatchKey, r.ParserGeneration) })
	staleKeys(f.Unknowns, current, keys, func(r db.UnknownRow) (string, int) { return gen(rowFile(r), r.MatchKey, r.ParserGeneration) })
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

// Reclassification hygiene — the Fake analog of SQLStore's
// DeleteScreenshotSiblings. Mirrors its contract: drop filename from every
// screenshot surface except keepType's, including the recognized-skip sets.

func (f *Fake) DeleteScreenshotSiblings(dirID int64, filename string, keepType parser.ScreenshotType) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	oldKeys := map[string]bool{}
	collect := func(key string) { oldKeys[key] = true }
	if keepType != "summary" {
		f.Summaries = deleteInFolder(f.Summaries, dirID, filename, collect)
	}
	if keepType != "teams" {
		f.Teams = deleteInFolder(f.Teams, dirID, filename, collect)
	}
	if keepType != "personal" {
		f.Personals = deleteInFolder(f.Personals, dirID, filename, collect)
	}
	if keepType != "rank" {
		f.Ranks = deleteInFolder(f.Ranks, dirID, filename, collect)
	}
	if keepType != "unknown" {
		f.Unknowns = deleteInFolder(f.Unknowns, dirID, filename, collect)
	}
	here := fileRef(db.FileRef{DirID: dirID, Filename: filename})
	if keepType != "all_heroes" {
		delete(f.AllHeroes, here)
	}
	if keepType != "history" {
		delete(f.History, here)
	}
	f.scrubDeadKeyCandidatesLocked(oldKeys)
	return nil
}

// DeleteScreenshotRows mirrors SQLStore's contract: drop filename's rows
// from every screenshot surface (including the recognized-skip sets) and
// its own pending candidate set — never IngestedFiles, whose cascade
// would unregister byte-identical copies — returning, sorted, the keys
// left with no parent rows.
func (f *Fake) DeleteScreenshotRows(filename string) ([]string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	touched := map[string]bool{}
	collect := func(key string) { touched[key] = true }
	f.Summaries = deleteByFilename(f.Summaries, filename, collect)
	f.Teams = deleteByFilename(f.Teams, filename, collect)
	f.Personals = deleteByFilename(f.Personals, filename, collect)
	f.Ranks = deleteByFilename(f.Ranks, filename, collect)
	f.Unknowns = deleteByFilename(f.Unknowns, filename, collect)
	forgetNamed(f.AllHeroes, filename)
	forgetNamed(f.History, filename)
	delete(f.Ambiguous, filename)
	f.scrubDeadKeyCandidatesLocked(touched)
	orphans := []string{}
	for key := range touched {
		if !f.matchKeyHasRowsLocked(key) {
			orphans = append(orphans, key)
		}
	}
	slices.Sort(orphans)
	return orphans, nil
}

// scrubDeadKeyCandidatesLocked mirrors SQLStore: candidates referencing
// a key with no remaining parent rows must go (HardDeleteMatch's
// dead-key invariant). Caller holds f.mu.
func (f *Fake) scrubDeadKeyCandidatesLocked(oldKeys map[string]bool) {
	for key := range oldKeys {
		if f.matchKeyHasRowsLocked(key) {
			continue
		}
		for pending, cands := range f.Ambiguous {
			kept := slices.DeleteFunc(cands, func(c db.AmbiguousCandidate) bool { return c.MatchKey == key })
			if len(kept) == 0 {
				delete(f.Ambiguous, pending)
			} else {
				f.Ambiguous[pending] = kept
			}
		}
	}
}

func (f *Fake) matchKeyHasRowsLocked(key string) bool {
	return hasMatchKey(f.Summaries, key) ||
		hasMatchKey(f.Teams, key) ||
		hasMatchKey(f.Personals, key) ||
		hasMatchKey(f.Ranks, key) ||
		hasMatchKey(f.Unknowns, key)
}
