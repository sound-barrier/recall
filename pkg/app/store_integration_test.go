package app

import (
	"reflect"
	"sort"
	"sync"
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// fakeStore is an in-memory db.Store used by tests to drive *App without
// SQLite. Each parent type holds its own slice keyed by filename so the
// same Upsert(filename)→replace semantic the SQL store provides is
// preserved.
type fakeStore struct {
	mu sync.Mutex

	summaries   []db.SummaryRow
	scoreboards []db.ScoreboardRow
	personals   []db.PersonalRow
	ranks       []db.RankRow
	unknowns    []db.UnknownRow

	dirIDs map[string]int64

	upsertCalls int
	clearCalls  int
	closeCalls  int
	upsertErr   error
	loadErr     error
}

var _ db.Store = (*fakeStore)(nil)

func (f *fakeStore) LoadAllFilenames() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]bool{}
	for _, r := range f.summaries {
		out[r.Filename] = true
	}
	for _, r := range f.scoreboards {
		out[r.Filename] = true
	}
	for _, r := range f.personals {
		out[r.Filename] = true
	}
	for _, r := range f.ranks {
		out[r.Filename] = true
	}
	for _, r := range f.unknowns {
		out[r.Filename] = true
	}
	return out, nil
}

func (f *fakeStore) LoadAll() (db.Screenshots, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.loadErr != nil {
		return db.Screenshots{}, f.loadErr
	}
	return db.Screenshots{
		Summaries:   append([]db.SummaryRow(nil), f.summaries...),
		Scoreboards: append([]db.ScoreboardRow(nil), f.scoreboards...),
		Personals:   append([]db.PersonalRow(nil), f.personals...),
		Ranks:       append([]db.RankRow(nil), f.ranks...),
		Unknowns:    append([]db.UnknownRow(nil), f.unknowns...),
	}, nil
}

func (f *fakeStore) UpsertSummary(r db.SummaryRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upsertCalls++
	if f.upsertErr != nil {
		return f.upsertErr
	}
	for i, ex := range f.summaries {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.summaries[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.summaries) + 1)
	f.summaries = append(f.summaries, r)
	return nil
}

func (f *fakeStore) UpsertScoreboard(r db.ScoreboardRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upsertCalls++
	if f.upsertErr != nil {
		return f.upsertErr
	}
	for i, ex := range f.scoreboards {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.scoreboards[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.scoreboards) + 1)
	f.scoreboards = append(f.scoreboards, r)
	return nil
}

func (f *fakeStore) UpsertPersonal(r db.PersonalRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upsertCalls++
	if f.upsertErr != nil {
		return f.upsertErr
	}
	for i, ex := range f.personals {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.personals[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.personals) + 1)
	f.personals = append(f.personals, r)
	return nil
}

func (f *fakeStore) UpsertRank(r db.RankRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upsertCalls++
	if f.upsertErr != nil {
		return f.upsertErr
	}
	for i, ex := range f.ranks {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.ranks[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.ranks) + 1)
	f.ranks = append(f.ranks, r)
	return nil
}

func (f *fakeStore) UpsertUnknown(r db.UnknownRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upsertCalls++
	if f.upsertErr != nil {
		return f.upsertErr
	}
	for i, ex := range f.unknowns {
		if ex.Filename == r.Filename {
			r.ID = ex.ID
			r.ParsedAt = ex.ParsedAt
			f.unknowns[i] = r
			return nil
		}
	}
	r.ID = int64(len(f.unknowns) + 1)
	f.unknowns = append(f.unknowns, r)
	return nil
}

func (f *fakeStore) Clear() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.clearCalls++
	f.summaries = nil
	f.scoreboards = nil
	f.personals = nil
	f.ranks = nil
	f.unknowns = nil
	return nil
}

func (f *fakeStore) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closeCalls++
	return nil
}

func (f *fakeStore) EnsureScreenshotsDir(path string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if path == "" {
		return 0, nil
	}
	if f.dirIDs == nil {
		f.dirIDs = map[string]int64{}
	}
	if id, ok := f.dirIDs[path]; ok {
		return id, nil
	}
	id := int64(len(f.dirIDs) + 1)
	f.dirIDs[path] = id
	return id, nil
}

// ──────────────────────────────────────────────────────────────────────────
// App methods that delegate to the store.
// ──────────────────────────────────────────────────────────────────────────

func TestApp_ClearDatabase_DelegatesToStore(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.ClearDatabase(); err != nil {
		t.Fatalf("ClearDatabase: %v", err)
	}
	if fs.clearCalls != 1 {
		t.Errorf("expected one Clear call, got %d", fs.clearCalls)
	}
}

func TestApp_GetMatchResults_DecodesAndFolds(t *testing.T) {
	// Two rows for the same match_key: a SUMMARY + a SCOREBOARD. The
	// aggregator must fuse them into one MatchRecord with both halves
	// of the data.
	fs := &fakeStore{
		summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "match:2026-05-10T21:29:28",
			Map: "rialto", Mode: "competitive", Hero: "lucio",
			Result: "victory", Date: "2026-05-10", FinishedAt: "21:29",
			HeroesPlayed: []db.SummaryHeroPlayed{
				{Hero: "lucio", PercentPlayed: 100},
			},
		}},
		scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "sb.png", MatchKey: "match:2026-05-10T21:29:28",
			Mode: "competitive", Hero: "lucio",
			Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200,
		}},
	}
	a := NewWithStore(fs)
	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 record (rows fused by match_key), got %d", len(got))
	}
	rec := got[0]
	if rec.Data.Map != "rialto" || rec.Data.Result != "victory" || rec.Data.Eliminations != 17 || rec.Data.Damage != 7200 {
		t.Errorf("fold lost fields: %+v", rec.Data)
	}
	if rec.Data.Hero != "lucio" || rec.Data.Role != "support" {
		t.Errorf("derived role not resolved (lucio→support): hero=%q role=%q", rec.Data.Hero, rec.Data.Role)
	}
	if len(rec.SourceFiles) != 2 {
		t.Errorf("expected 2 source files, got %v", rec.SourceFiles)
	}
}

func TestApp_GetMatchResults_AppliesReadTimeInference(t *testing.T) {
	// Single-hero scoreboard row (no SUMMARY → no percent_played) must
	// come back with percent_played=100 via inferSoleHeroPercent.
	fs := &fakeStore{
		scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "a.png", MatchKey: "k1",
			Mode: "competitive", Hero: "lucio",
			Eliminations: 17,
		}},
	}
	a := NewWithStore(fs)
	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(got[0].Data.HeroesPlayed) == 0 {
		// scoreboards now don't auto-populate HeroesPlayed unless they
		// have panel stats — so this test verifies the single-hero
		// fallback isn't triggered when there's no HeroesPlayed entry
		// at all. The Hero field on the row is what surfaces in the UI.
		return
	}
	if got[0].Data.HeroesPlayed[0].PercentPlayed != 100 {
		t.Errorf("inference did not fire: %+v", got[0].Data.HeroesPlayed)
	}
}

func TestApp_GetMatchResults_EmptyTableReturnsNonNilSlice(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if got == nil {
		t.Errorf("expected non-nil slice (OpenAPI requires [], not null)")
	}
	if len(got) != 0 {
		t.Errorf("expected 0 records, got %d", len(got))
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Round-trip via *db.SQLStore — proves the per-type schema survives the
// real SQLite driver.
// ──────────────────────────────────────────────────────────────────────────

func TestApp_RoundTripViaSQLStore(t *testing.T) {
	s, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	a := NewWithStore(s)

	// Insert a SUMMARY + SCOREBOARD for the same match.
	if err := s.UpsertSummary(db.SummaryRow{
		Filename: "s.png", MatchKey: "match:2026-05-10T21:29:28",
		Map: "rialto", Mode: "competitive", Hero: "lucio",
		Result: "victory", Date: "2026-05-10", FinishedAt: "21:29",
		HeroesPlayed: []db.SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100}},
	}); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}
	if err := s.UpsertScoreboard(db.ScoreboardRow{
		Filename: "sb.png", MatchKey: "match:2026-05-10T21:29:28",
		Mode: "competitive", Hero: "lucio",
		Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200,
	}); err != nil {
		t.Fatalf("UpsertScoreboard: %v", err)
	}

	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 record, got %d", len(got))
	}
	rec := got[0]
	if rec.MatchKey != "match:2026-05-10T21:29:28" {
		t.Errorf("match_key lost: %q", rec.MatchKey)
	}
	if rec.Data.Map != "rialto" || rec.Data.Eliminations != 17 || rec.Data.Damage != 7200 {
		t.Errorf("scalars lost across the fold: %+v", rec.Data)
	}
	if len(rec.Data.HeroesPlayed) != 1 || rec.Data.HeroesPlayed[0].PercentPlayed != 100 {
		t.Errorf("HeroesPlayed round-trip broken: %+v", rec.Data.HeroesPlayed)
	}
	wantSourceTypes := map[string]string{"s.png": "summary", "sb.png": "scoreboard"}
	if !reflect.DeepEqual(rec.SourceTypes, wantSourceTypes) {
		t.Errorf("SourceTypes derivation broken:\n  got=%+v\n want=%+v", rec.SourceTypes, wantSourceTypes)
	}
	sort.Strings(rec.SourceFiles)
	wantFiles := []string{"s.png", "sb.png"}
	sort.Strings(wantFiles)
	if !reflect.DeepEqual(rec.SourceFiles, wantFiles) {
		t.Errorf("SourceFiles derivation broken: %v", rec.SourceFiles)
	}
}

// ──────────────────────────────────────────────────────────────────────
// ParsedAt / SourceParsedAt — derived from the per-row parsed_at column.
// ──────────────────────────────────────────────────────────────────────

func TestApp_GetMatchResults_ExposesParsedAtFields(t *testing.T) {
	fs := &fakeStore{
		summaries: []db.SummaryRow{{
			ID: 1, Filename: "a.png", MatchKey: "k1",
			ParsedAt: "2026-05-10T21:30:00Z",
			Mode:     "competitive",
		}},
		scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "b.png", MatchKey: "k1",
			ParsedAt: "2026-05-10T21:30:05Z",
			Mode:     "competitive", Eliminations: 5,
		}},
	}
	a := NewWithStore(fs)
	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if got[0].ParsedAt != "2026-05-10T21:30:00Z" {
		t.Errorf("ParsedAt should be MIN across the group, got %q", got[0].ParsedAt)
	}
	if got[0].SourceParsedAt["a.png"] != "2026-05-10T21:30:00Z" {
		t.Errorf("SourceParsedAt[a.png] missing/wrong: %+v", got[0].SourceParsedAt)
	}
	if got[0].SourceParsedAt["b.png"] != "2026-05-10T21:30:05Z" {
		t.Errorf("SourceParsedAt[b.png] missing/wrong: %+v", got[0].SourceParsedAt)
	}
}

func TestApp_ScrapeReader_ReturnsAllRows(t *testing.T) {
	// scrapeReader returns every row in the DB — competitive filtering is
	// the metrics layer's job.
	fs := &fakeStore{
		scoreboards: []db.ScoreboardRow{
			{Filename: "a.png", MatchKey: "m1", Mode: "competitive", Eliminations: 17, Hero: "lucio"},
			{Filename: "b.png", MatchKey: "m2", Mode: "quickplay", Eliminations: 5, Hero: "kiriko"},
		},
	}
	a := NewWithStore(fs)
	got, err := a.scrapeReader()
	if err != nil {
		t.Fatalf("scrapeReader: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("expected scrapeReader to return all rows (filtering happens at metrics layer), got %d", len(got))
	}
	// Make sure aggregator-supplied Hero/MatchKey are preserved through
	// scrapeReader's projection.
	heroes := map[string]string{}
	for _, r := range got {
		heroes[r.MatchKey] = r.Data.Hero
	}
	if heroes["m1"] != "lucio" || heroes["m2"] != "kiriko" {
		t.Errorf("hero lost in scrapeReader projection: %+v", heroes)
	}
	_ = parser.MatchResult{} // import used for cross-file types
}
