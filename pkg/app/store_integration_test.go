package app

import (
	"reflect"
	"sync"
	"testing"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// fakeStore is an in-memory db.Store used by tests to drive *App without
// SQLite. The behaviour mirrors *db.SQLStore but skips JSON encoding so test
// fixtures can be authored in Go directly.
type fakeStore struct {
	mu          sync.Mutex
	rows        []db.MatchRow
	upsertCalls int
	clearCalls  int
	closeCalls  int
	upsertErr   error
	loadErr     error
}

func (f *fakeStore) LoadAll() ([]db.MatchRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.loadErr != nil {
		return nil, f.loadErr
	}
	out := make([]db.MatchRow, len(f.rows))
	copy(out, f.rows)
	return out, nil
}

func (f *fakeStore) LoadSourceFilenames() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]bool{}
	for _, r := range f.rows {
		for _, s := range r.SourceFiles {
			out[s] = true
		}
	}
	return out, nil
}

func (f *fakeStore) Upsert(r db.MatchRow) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.upsertCalls++
	if f.upsertErr != nil {
		return f.upsertErr
	}
	for i, existing := range f.rows {
		if existing.MatchKey == r.MatchKey {
			f.rows[i] = r
			return nil
		}
	}
	f.rows = append(f.rows, r)
	return nil
}

func (f *fakeStore) Clear() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.clearCalls++
	f.rows = nil
	return nil
}

func (f *fakeStore) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closeCalls++
	return nil
}

// Compile-time assertion that fakeStore satisfies the interface.
var _ db.Store = (*fakeStore)(nil)

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

func TestApp_GetMatchResults_DecodesJSONColumns(t *testing.T) {
	fs := &fakeStore{
		rows: []db.MatchRow{{
			MatchKey:     "match:2026-05-10T21:29:28",
			SourceFiles:  []string{"a.png"},
			Map:          "rialto",
			Mode:         "competitive",
			Hero:         "lucio",
			Eliminations: 17, Assists: 16, Deaths: 11,
			Date: "2026-05-10", FinishedAt: "21:29",
			Result:           "victory",
			HeroesPlayedJSON: `[{"hero":"lucio","percent_played":100}]`,
			SRJSON:           `[{"hero":"lucio","sr":3200,"change":30}]`,
		}},
	}
	a := NewWithStore(fs)
	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 record, got %d", len(got))
	}
	rec := got[0]
	if rec.Data.Map != "rialto" || rec.Data.Result != "victory" {
		t.Errorf("scalars lost: %+v", rec.Data)
	}
	if len(rec.Data.HeroesPlayed) != 1 || rec.Data.HeroesPlayed[0].Hero != "lucio" {
		t.Errorf("HeroesPlayed not decoded: %+v", rec.Data.HeroesPlayed)
	}
	if len(rec.Data.SR) != 1 || rec.Data.SR[0].SR != 3200 {
		t.Errorf("SR not decoded: %+v", rec.Data.SR)
	}
}

func TestApp_GetMatchResults_AppliesReadTimeInference(t *testing.T) {
	// Single-hero scoreboard row (no SUMMARY → no percent_played) must come
	// back with percent_played=100 via inferSoleHeroPercent.
	fs := &fakeStore{
		rows: []db.MatchRow{{
			MatchKey:         "match:2026-05-10T21:29:28",
			SourceFiles:      []string{"a.png"},
			Mode:             "competitive",
			Hero:             "lucio",
			Eliminations:     17,
			HeroesPlayedJSON: `[{"hero":"lucio","percent_played":0}]`,
		}},
	}
	a := NewWithStore(fs)
	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
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
// upsertMergedRow — App-level marshalling of JSON columns.
// ──────────────────────────────────────────────────────────────────────────

func TestApp_UpsertMergedRow_EncodesJSONColumns(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	row := mergedRow{
		Key:     "match:2026-05-10T21:29:28",
		Sources: []string{"a.png"},
		Types:   map[string]string{"a.png": "summary"},
		Data: parser.MatchResult{
			Map: "rialto", Mode: "competitive", Hero: "lucio",
			HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 100}},
			Modifiers:    []string{"expected", "victory"},
			SR:           []parser.HeroSR{{Hero: "lucio", SR: 3200, Change: 30}},
		},
	}
	if err := a.upsertMergedRow(row); err != nil {
		t.Fatalf("upsertMergedRow: %v", err)
	}
	if len(fs.rows) != 1 {
		t.Fatalf("expected 1 stored row, got %d", len(fs.rows))
	}
	stored := fs.rows[0]
	if stored.HeroesPlayedJSON == "" {
		t.Errorf("HeroesPlayedJSON should be populated when HeroesPlayed is non-empty")
	}
	if stored.SRJSON == "" {
		t.Errorf("SRJSON should be populated when SR is non-empty")
	}
	if stored.ModifiersJSON == "" {
		t.Errorf("ModifiersJSON should be populated when Modifiers is non-empty")
	}
	if stored.PerformanceJSON != "" {
		t.Errorf("PerformanceJSON must stay empty when Performance is nil")
	}
	if !reflect.DeepEqual(stored.SourceTypes, row.Types) {
		t.Errorf("SourceTypes lost: %+v", stored.SourceTypes)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Round-trip via *db.SQLStore — proves the JSON encode/decode dance survives
// the real SQLite driver, not just the fakeStore.
// ──────────────────────────────────────────────────────────────────────────

func TestApp_RoundTripViaSQLStore(t *testing.T) {
	s, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	a := NewWithStore(s)

	original := mergedRow{
		Key:     "match:2026-05-10T21:29:28",
		Sources: []string{"a.png", "b.png"},
		Types:   map[string]string{"a.png": "summary", "b.png": "scoreboard"},
		Data: parser.MatchResult{
			Map: "rialto", Mode: "competitive", Hero: "lucio", Role: "support",
			Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200,
			Result: "victory", Date: "2026-05-10", FinishedAt: "21:29",
			HeroesPlayed: []parser.HeroPlay{{Hero: "lucio", PercentPlayed: 100}},
			Modifiers:    []string{"victory"},
			SR:           []parser.HeroSR{{Hero: "lucio", SR: 3200, Change: 30}},
		},
	}
	if err := a.upsertMergedRow(original); err != nil {
		t.Fatalf("upsertMergedRow: %v", err)
	}

	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 record, got %d", len(got))
	}
	rec := got[0]
	if rec.MatchKey != original.Key {
		t.Errorf("match_key lost: %q", rec.MatchKey)
	}
	if rec.Data.Map != "rialto" || rec.Data.Eliminations != 17 || rec.Data.Damage != 7200 {
		t.Errorf("scalars lost: %+v", rec.Data)
	}
	if len(rec.Data.HeroesPlayed) != 1 || rec.Data.HeroesPlayed[0].PercentPlayed != 100 {
		t.Errorf("HeroesPlayed round-trip broken: %+v", rec.Data.HeroesPlayed)
	}
	if len(rec.Data.SR) != 1 || rec.Data.SR[0].SR != 3200 {
		t.Errorf("SR round-trip broken: %+v", rec.Data.SR)
	}
	if !reflect.DeepEqual(rec.SourceTypes, original.Types) {
		t.Errorf("SourceTypes round-trip broken: %+v", rec.SourceTypes)
	}
}

// ──────────────────────────────────────────────────────────────────────
// ParsedAt / SourceParsedAt
// ──────────────────────────────────────────────────────────────────────
//
// MatchRecord exposes two timestamp fields:
//   - ParsedAt: when the match record was first inserted (stable)
//   - SourceParsedAt: per-file first-insert timestamps (stable)
//
// rowToMatchRecord must pass both through from the underlying MatchRow.

func TestApp_GetMatchResults_ExposesParsedAtFields(t *testing.T) {
	fs := &fakeStore{
		rows: []db.MatchRow{{
			MatchKey:    "match:2026-05-10T21:29:28",
			SourceFiles: []string{"a.png", "b.png"},
			ParsedAt:    "2026-05-10T21:30:00Z",
			SourceParsedAt: map[string]string{
				"a.png": "2026-05-10T21:30:00Z",
				"b.png": "2026-05-10T21:30:05Z",
			},
			Mode: "competitive",
		}},
	}
	a := NewWithStore(fs)
	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if got[0].ParsedAt != "2026-05-10T21:30:00Z" {
		t.Errorf("ParsedAt not lifted onto MatchRecord: %q", got[0].ParsedAt)
	}
	if got[0].SourceParsedAt["a.png"] != "2026-05-10T21:30:00Z" {
		t.Errorf("SourceParsedAt[a.png] not lifted: %+v", got[0].SourceParsedAt)
	}
	if got[0].SourceParsedAt["b.png"] != "2026-05-10T21:30:05Z" {
		t.Errorf("SourceParsedAt[b.png] not lifted: %+v", got[0].SourceParsedAt)
	}
}

func TestApp_UpsertMergedRow_WritesSourceParsedAt(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	row := mergedRow{
		Key:     "match:2026-05-10T21:29:28",
		Sources: []string{"a.png", "b.png"},
		Types:   map[string]string{"a.png": "summary", "b.png": "scoreboard"},
		ParsedAt: map[string]string{
			"a.png": "2026-05-10T21:30:00Z",
			"b.png": "2026-05-10T21:30:05Z",
		},
		Data: parser.MatchResult{Mode: "competitive"},
	}
	if err := a.upsertMergedRow(row); err != nil {
		t.Fatalf("upsertMergedRow: %v", err)
	}
	if !reflect.DeepEqual(fs.rows[0].SourceParsedAt, row.ParsedAt) {
		t.Errorf("SourceParsedAt did not reach the store:\n got=%+v\nwant=%+v", fs.rows[0].SourceParsedAt, row.ParsedAt)
	}
}

func TestApp_ScrapeReader_FiltersHonoredAtMetricsLayer(t *testing.T) {
	// scrapeReader returns every row in the DB — competitive filtering is
	// the metrics layer's job, not the reader's.
	fs := &fakeStore{
		rows: []db.MatchRow{
			{MatchKey: "m1", Mode: "competitive", Eliminations: 17, Date: "2026-05-10", FinishedAt: "21:29"},
			{MatchKey: "m2", Mode: "quickplay", Eliminations: 5},
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
}
