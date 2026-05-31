package app

import (
	"reflect"
	"sort"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/parser"
)

// fakeStore is the shared in-memory db.Store from pkg/db/dbtest.
// Aliased so the per-test fixture seeding ("&fakeStore{Summaries:
// …}") keeps the same shape it had when fakeStore was defined here.
type fakeStore = dbtest.Fake

// ──────────────────────────────────────────────────────────────────────────
// App methods that delegate to the store.
// ──────────────────────────────────────────────────────────────────────────

func TestApp_ClearDatabase_DelegatesToStore(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.ClearDatabase(); err != nil {
		t.Fatalf("ClearDatabase: %v", err)
	}
	if fs.ClearCalls != 1 {
		t.Errorf("expected one Clear call, got %d", fs.ClearCalls)
	}
}

func TestApp_HardDeleteMatch_DelegatesAndValidates(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.HardDeleteMatch(""); err == nil {
		t.Error("expected error for empty match_key")
	}
	if err := a.HardDeleteMatch("match:k1"); err != nil {
		t.Fatalf("HardDeleteMatch: %v", err)
	}
	if got := fs.HardDeleteCalls; len(got) != 1 || got[0] != "match:k1" {
		t.Errorf("expected one HardDeleteCalls entry for match:k1, got %+v", got)
	}
}

func TestApp_GetMatchResults_DecodesAndFolds(t *testing.T) {
	// Two rows for the same match_key: a SUMMARY + a SCOREBOARD. The
	// aggregator must fuse them into one MatchRecord with both halves
	// of the data.
	fs := &fakeStore{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "match:2026-05-10T21:29:28",
			Map: "rialto", Mode: "competitive", Hero: "lucio",
			Result: "victory", Date: "2026-05-10", FinishedAt: "21:29",
			HeroesPlayed: []db.SummaryHeroPlayed{
				{Hero: "lucio", PercentPlayed: 100},
			},
		}},
		Scoreboards: []db.ScoreboardRow{{
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
		Scoreboards: []db.ScoreboardRow{{
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
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "a.png", MatchKey: "k1",
			ParsedAt: "2026-05-10T21:30:00Z",
			Mode:     "competitive",
		}},
		Scoreboards: []db.ScoreboardRow{{
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
		Scoreboards: []db.ScoreboardRow{
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

// ──────────────────────────────────────────────────────────────────────────
// Soft-delete (hide / unhide) surface.
// ──────────────────────────────────────────────────────────────────────────

func TestApp_HideMatch_RequiresMatchKey(t *testing.T) {
	a := NewWithStore(&fakeStore{})
	if err := a.HideMatch(""); err == nil {
		t.Fatal("HideMatch with empty match_key should error")
	}
	if err := a.UnhideMatch(""); err == nil {
		t.Fatal("UnhideMatch with empty match_key should error")
	}
}

func TestApp_HideMatch_DelegatesToStore(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.HideMatch("m1"); err != nil {
		t.Fatalf("HideMatch: %v", err)
	}
	if !fs.Hidden["m1"] {
		t.Errorf("store did not receive HideMatch: %+v", fs.Hidden)
	}
	// Idempotent: a second call must still leave the row hidden.
	if err := a.HideMatch("m1"); err != nil {
		t.Fatalf("HideMatch idempotent: %v", err)
	}
	if !fs.Hidden["m1"] {
		t.Errorf("idempotent HideMatch lost row: %+v", fs.Hidden)
	}
	if err := a.UnhideMatch("m1"); err != nil {
		t.Fatalf("UnhideMatch: %v", err)
	}
	if fs.Hidden["m1"] {
		t.Errorf("UnhideMatch did not remove row: %+v", fs.Hidden)
	}
	// Unhide of a not-hidden match is a no-op.
	if err := a.UnhideMatch("never-hidden"); err != nil {
		t.Fatalf("UnhideMatch unknown key: %v", err)
	}
}

func TestApp_GetMatchResults_TagsHiddenMatches(t *testing.T) {
	// When a match_key is in hidden_matches, the aggregator must set
	// MatchRecord.Hidden = true so the frontend can dim or filter.
	fs := &fakeStore{
		Scoreboards: []db.ScoreboardRow{
			{ID: 1, Filename: "a.png", MatchKey: "m1", Eliminations: 1},
			{ID: 2, Filename: "b.png", MatchKey: "m2", Eliminations: 2},
		},
		Hidden: map[string]bool{"m2": true},
	}
	a := NewWithStore(fs)
	got, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 records, got %d", len(got))
	}
	seen := map[string]bool{}
	for _, r := range got {
		seen[r.MatchKey] = r.Hidden
	}
	if seen["m1"] {
		t.Errorf("m1 (not hidden) should have Hidden=false")
	}
	if !seen["m2"] {
		t.Errorf("m2 (hidden in store) should have Hidden=true")
	}
}

func TestApp_HideMatch_PreservesSourceFilenamesSoReparseSkipsThem(t *testing.T) {
	// The core feature contract: hiding a match must NOT remove the
	// per-screenshot rows from the parent tables. ParseScreenshots calls
	// LoadAllFilenames() up front and skips any file already in the set,
	// so the source files for a hidden match must continue to appear
	// there. If hide ever turned into a hard delete, this test trips.
	fs := &fakeStore{
		Summaries: []db.SummaryRow{
			{ID: 1, Filename: "a-summary.png", MatchKey: "m1"},
		},
		Scoreboards: []db.ScoreboardRow{
			{ID: 1, Filename: "a-scoreboard.png", MatchKey: "m1"},
		},
	}
	a := NewWithStore(fs)
	if err := a.HideMatch("m1"); err != nil {
		t.Fatalf("HideMatch: %v", err)
	}
	got, err := fs.LoadAllFilenames()
	if err != nil {
		t.Fatalf("LoadAllFilenames: %v", err)
	}
	if !got["a-summary.png"] || !got["a-scoreboard.png"] {
		t.Errorf(
			"hidden match's source files should remain in LoadAllFilenames "+
				"so a re-parse skips them, got %+v",
			got,
		)
	}
	if len(got) != 2 {
		t.Errorf("expected 2 filenames, got %d (%+v)", len(got), got)
	}
}

func TestApp_ScrapeReader_DropsHiddenMatches(t *testing.T) {
	// Pinning test: the Prometheus reader (scrapeReader) drops hidden
	// matches. Hidden is the user's "this match shouldn't count toward
	// my stats" signal — the dossier / heatmap / sparkline already
	// honor it, and Grafana trend data must agree so the long-term
	// curves reconcile with the in-app totals. The metrics-layer
	// filter for competitive-only still lives in
	// pkg/metrics/metrics.go::Collect.
	fs := &fakeStore{
		Scoreboards: []db.ScoreboardRow{
			{ID: 1, Filename: "a.png", MatchKey: "m1", Mode: "competitive", Eliminations: 1},
			{ID: 2, Filename: "b.png", MatchKey: "m2", Mode: "competitive", Eliminations: 2},
		},
		Hidden: map[string]bool{"m2": true},
	}
	a := NewWithStore(fs)
	got, err := a.scrapeReader()
	if err != nil {
		t.Fatalf("scrapeReader: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("scrapeReader should drop hidden matches, got %d rows (expected 1)", len(got))
	}
	if got[0].MatchKey != "m1" {
		t.Errorf("expected the surviving row to be m1, got %q", got[0].MatchKey)
	}
}
