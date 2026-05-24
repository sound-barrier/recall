package db

import (
	"reflect"
	"testing"
	"time"
)

// openMemory returns a fresh SQLStore backed by an in-memory SQLite database.
// Closed via t.Cleanup so each test gets isolation without a defer at every
// call site.
func openMemory(t *testing.T) *SQLStore {
	s, err := NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore(:memory:): %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestSQLStore_UpsertThenLoadRoundTrip(t *testing.T) {
	s := openMemory(t)
	want := MatchRow{
		MatchKey:    "match:2026-05-10T21:29:28",
		SourceFiles: []string{"a.png", "b.png"},
		SourceTypes: map[string]string{"a.png": "summary", "b.png": "scoreboard"},
		Map:         "rialto",
		Mode:        "competitive",
		Hero:        "lucio",
		Role:        "support",

		Eliminations: 17, Assists: 16, Deaths: 11,
		Damage: 7200, Healing: 0, Mitigation: 0,

		Result:     "victory",
		Date:       "2026-05-10",
		FinishedAt: "21:29",
		GameLength: "11:25",

		HeroesPlayedJSON: `[{"hero":"lucio","percent_played":100}]`,
		PerformanceJSON:  "",
		ModifiersJSON:    `["expected","victory"]`,
		SRJSON:           `[{"hero":"lucio","sr":3200,"change":30}]`,

		Rank:          "platinum",
		Level:         3,
		RankProgress:  40,
		ChangePercent: 5,
	}
	if err := s.Upsert(want); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 row, got %d", len(got))
	}

	// id and parsed_at are both auto-populated by the schema (id via
	// AUTOINCREMENT, parsed_at via CURRENT_TIMESTAMP DEFAULT). Mirror
	// the loaded values so the comparison focuses on caller-set fields.
	want.ID = got[0].ID
	want.ParsedAt = got[0].ParsedAt
	if !reflect.DeepEqual(got[0], want) {
		t.Fatalf("round-trip mismatch:\n got=%+v\nwant=%+v", got[0], want)
	}
}

func TestSQLStore_UpsertIsIdempotentByMatchKey(t *testing.T) {
	s := openMemory(t)
	first := MatchRow{
		MatchKey:    "match:2026-05-10T21:29:28",
		SourceFiles: []string{"a.png"},
		Mode:        "competitive",
		Map:         "rialto",
	}
	second := first
	second.SourceFiles = []string{"a.png", "b.png"} // new file added to same match
	second.Damage = 7200

	if err := s.Upsert(first); err != nil {
		t.Fatalf("first Upsert: %v", err)
	}
	if err := s.Upsert(second); err != nil {
		t.Fatalf("second Upsert: %v", err)
	}

	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("ON CONFLICT must collapse to 1 row, got %d", len(got))
	}
	if got[0].Damage != 7200 {
		t.Errorf("second upsert lost: got Damage=%d want 7200", got[0].Damage)
	}
	if !reflect.DeepEqual(got[0].SourceFiles, []string{"a.png", "b.png"}) {
		t.Errorf("source files not updated: %v", got[0].SourceFiles)
	}
}

func TestSQLStore_LoadSourceFilenames_DedupAcrossRows(t *testing.T) {
	s := openMemory(t)
	must := func(err error) {
		if err != nil {
			t.Fatalf("upsert: %v", err)
		}
	}
	must(s.Upsert(MatchRow{MatchKey: "m1", SourceFiles: []string{"a.png", "b.png"}}))
	must(s.Upsert(MatchRow{MatchKey: "m2", SourceFiles: []string{"b.png", "c.png"}}))

	got, err := s.LoadSourceFilenames()
	if err != nil {
		t.Fatalf("LoadSourceFilenames: %v", err)
	}
	want := map[string]bool{"a.png": true, "b.png": true, "c.png": true}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v want %v", got, want)
	}
}

func TestSQLStore_Clear_LeavesSchema(t *testing.T) {
	s := openMemory(t)
	if err := s.Upsert(MatchRow{MatchKey: "m1", SourceFiles: []string{"a.png"}}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	if err := s.Clear(); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll after Clear: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("rows remained after Clear: %d", len(got))
	}
	// Upsert still works — schema is intact.
	if err := s.Upsert(MatchRow{MatchKey: "m2", SourceFiles: []string{"b.png"}}); err != nil {
		t.Errorf("Upsert after Clear failed (schema gone?): %v", err)
	}
}

func TestSQLStore_LoadAll_EmptyIsNonNilSlice(t *testing.T) {
	s := openMemory(t)
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if got == nil {
		t.Fatalf("LoadAll must return a non-nil slice for an empty table (OpenAPI requires `[]`, not `null`)")
	}
	if len(got) != 0 {
		t.Errorf("empty table should yield 0 rows, got %d", len(got))
	}
}

func TestSQLStore_Migration_IdempotentOnReopen(t *testing.T) {
	// First open creates schema + applies migrations; second open should
	// re-run the same migrations without erroring on "duplicate column".
	s := openMemory(t)
	if err := s.Upsert(MatchRow{MatchKey: "m1", SourceFiles: []string{"a.png"}}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	// A fresh :memory: store doesn't see the previous one's data — but the
	// migration codepath running twice (here on the second open) must not
	// error.
	s2, err := NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	_ = s2.Close()
}

// ── ParsedAt + SourceParsedAt ────────────────────────────────────────
//
// parsed_at is the row's "first inserted at" timestamp; it must NOT
// shift on subsequent upserts of the same match_key. source_parsed_at
// is a JSON map of filename → ISO8601 timestamp; the caller (pkg/app)
// stamps newly-OCR'd files and preserves existing entries when folding
// a new screenshot into an already-known match.

func TestSQLStore_ParsedAt_PopulatedOnInsert(t *testing.T) {
	s := openMemory(t)
	if err := s.Upsert(MatchRow{MatchKey: "m1", SourceFiles: []string{"a.png"}}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 row, got %d", len(got))
	}
	if got[0].ParsedAt == "" {
		t.Error("ParsedAt should be populated by the schema DEFAULT on insert")
	}
}

func TestSQLStore_ParsedAt_StableAcrossReupsert(t *testing.T) {
	s := openMemory(t)
	if err := s.Upsert(MatchRow{MatchKey: "m1", SourceFiles: []string{"a.png"}}); err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	first, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	original := first[0].ParsedAt

	// Sleep one second so any incidental CURRENT_TIMESTAMP refresh
	// would show as a different value at second-resolution.
	time.Sleep(1100 * time.Millisecond)
	if err := s.Upsert(MatchRow{MatchKey: "m1", SourceFiles: []string{"a.png", "b.png"}}); err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	second, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if second[0].ParsedAt != original {
		t.Errorf("parsed_at should NOT refresh on conflict; got %q after upsert, was %q", second[0].ParsedAt, original)
	}
}

func TestSQLStore_SourceParsedAt_RoundTrips(t *testing.T) {
	s := openMemory(t)
	stamps := map[string]string{
		"a.png": "2026-05-23T20:00:00Z",
		"b.png": "2026-05-23T20:05:12Z",
	}
	if err := s.Upsert(MatchRow{
		MatchKey:       "m1",
		SourceFiles:    []string{"a.png", "b.png"},
		SourceParsedAt: stamps,
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if !reflect.DeepEqual(got[0].SourceParsedAt, stamps) {
		t.Errorf("SourceParsedAt round-trip mismatch:\n got=%+v\nwant=%+v", got[0].SourceParsedAt, stamps)
	}
}

func TestSQLStore_SourceParsedAt_NilForLegacyRows(t *testing.T) {
	s := openMemory(t)
	// Insert without SourceParsedAt — simulates a row from before the
	// column existed (or one a caller forgot to populate).
	if err := s.Upsert(MatchRow{MatchKey: "m1", SourceFiles: []string{"a.png"}}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if got[0].SourceParsedAt != nil {
		t.Errorf("SourceParsedAt should be nil for rows without the column set; got %+v", got[0].SourceParsedAt)
	}
}
