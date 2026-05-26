package db

import (
	"reflect"
	"sort"
	"testing"
	"time"
)

// openMemory returns a fresh SQLStore backed by an in-memory SQLite database.
func openMemory(t *testing.T) *SQLStore {
	t.Helper()
	s, err := NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore(:memory:): %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// ──────────────────────────────────────────────────────────────────
// SUMMARY round-trip.
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_Summary_UpsertThenLoadRoundTrip(t *testing.T) {
	s := openMemory(t)
	want := SummaryRow{
		Filename:   "summary.png",
		MatchKey:   "match:2026-05-10T21:29:28",
		Map:        "rialto",
		Mode:       "competitive",
		Hero:       "lucio",
		Result:     "victory",
		FinalScore: "3-1",
		Date:       "2026-05-10",
		FinishedAt: "21:29",
		GameLength: "11:25",

		PerfElimTotal:          17,
		PerfElimAvgPer10Min:    14.5,
		PerfAssistsTotal:       16,
		PerfAssistsAvgPer10Min: 13.6,
		PerfDeathsTotal:        11,
		PerfDeathsAvgPer10Min:  9.4,

		HeroesPlayed: []SummaryHeroPlayed{
			{Hero: "lucio", PercentPlayed: 60, PlayTime: "07:00"},
			{Hero: "kiriko", PercentPlayed: 40, PlayTime: "04:25"},
		},
	}
	if err := s.UpsertSummary(want); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}

	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got.Summaries) != 1 {
		t.Fatalf("expected 1 summary row, got %d", len(got.Summaries))
	}
	want.ID = got.Summaries[0].ID
	want.ParsedAt = got.Summaries[0].ParsedAt
	sortHP := func(hps []SummaryHeroPlayed) {
		sort.Slice(hps, func(i, j int) bool { return hps[i].Hero < hps[j].Hero })
	}
	sortHP(want.HeroesPlayed)
	sortHP(got.Summaries[0].HeroesPlayed)
	if !reflect.DeepEqual(got.Summaries[0], want) {
		t.Fatalf("round-trip mismatch:\n got=%+v\nwant=%+v", got.Summaries[0], want)
	}
}

func TestSQLStore_Summary_UpsertIsIdempotentByFilename(t *testing.T) {
	s := openMemory(t)
	first := SummaryRow{Filename: "a.png", MatchKey: "k1", Map: "rialto"}
	second := SummaryRow{Filename: "a.png", MatchKey: "k1", Map: "rialto", Result: "victory"}
	if err := s.UpsertSummary(first); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := s.UpsertSummary(second); err != nil {
		t.Fatalf("second: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got.Summaries) != 1 {
		t.Fatalf("UNIQUE(filename) must collapse to 1 row, got %d", len(got.Summaries))
	}
	if got.Summaries[0].Result != "victory" {
		t.Errorf("second upsert lost: %q", got.Summaries[0].Result)
	}
}

func TestSQLStore_Summary_Children_CascadeOnReupsert(t *testing.T) {
	s := openMemory(t)
	first := SummaryRow{
		Filename: "a.png", MatchKey: "k1",
		HeroesPlayed: []SummaryHeroPlayed{
			{Hero: "lucio", PercentPlayed: 60},
			{Hero: "kiriko", PercentPlayed: 40},
		},
	}
	if err := s.UpsertSummary(first); err != nil {
		t.Fatalf("first: %v", err)
	}
	second := SummaryRow{
		Filename: "a.png", MatchKey: "k1",
		HeroesPlayed: []SummaryHeroPlayed{
			{Hero: "lucio", PercentPlayed: 100},
		},
	}
	if err := s.UpsertSummary(second); err != nil {
		t.Fatalf("second: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if n := len(got.Summaries[0].HeroesPlayed); n != 1 {
		t.Fatalf("expected 1 hero (children replaced, not appended), got %d: %+v",
			n, got.Summaries[0].HeroesPlayed)
	}
	if got.Summaries[0].HeroesPlayed[0].Hero != "lucio" {
		t.Errorf("wrong hero survived: %q", got.Summaries[0].HeroesPlayed[0].Hero)
	}
}

// ──────────────────────────────────────────────────────────────────
// SCOREBOARD round-trip with panel hero stats.
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_Scoreboard_UpsertThenLoadRoundTrip(t *testing.T) {
	s := openMemory(t)
	want := ScoreboardRow{
		Filename: "sb.png", MatchKey: "k1",
		Map: "rialto", Mode: "competitive", Hero: "lucio",
		Eliminations: 17, Assists: 16, Deaths: 11,
		Damage: 7200, Healing: 10933, Mitigation: 351,
		HeroStats: []HeroStat{
			{Hero: "lucio", StatKey: "weapon_accuracy", StatValue: 24},
			{Hero: "lucio", StatKey: "speed_boosts", StatValue: 5},
		},
	}
	if err := s.UpsertScoreboard(want); err != nil {
		t.Fatalf("UpsertScoreboard: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got.Scoreboards) != 1 {
		t.Fatalf("expected 1 scoreboard, got %d", len(got.Scoreboards))
	}
	want.ID = got.Scoreboards[0].ID
	want.ParsedAt = got.Scoreboards[0].ParsedAt
	sortHS := func(s []HeroStat) {
		sort.Slice(s, func(i, j int) bool {
			if s[i].Hero != s[j].Hero {
				return s[i].Hero < s[j].Hero
			}
			return s[i].StatKey < s[j].StatKey
		})
	}
	sortHS(want.HeroStats)
	sortHS(got.Scoreboards[0].HeroStats)
	if !reflect.DeepEqual(got.Scoreboards[0], want) {
		t.Fatalf("round-trip mismatch:\n got=%+v\nwant=%+v", got.Scoreboards[0], want)
	}
}

// ──────────────────────────────────────────────────────────────────
// PERSONAL round-trip with per-hero stats.
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_Personal_UpsertThenLoadRoundTrip(t *testing.T) {
	s := openMemory(t)
	want := PersonalRow{
		Filename: "p.png", MatchKey: "k1", Hero: "juno",
		HeroStats: []HeroStat{
			{Hero: "juno", StatKey: "orbital_ray_damage", StatValue: 1100},
			{Hero: "juno", StatKey: "players_saved", StatValue: 5},
		},
	}
	if err := s.UpsertPersonal(want); err != nil {
		t.Fatalf("UpsertPersonal: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got.Personals) != 1 {
		t.Fatalf("expected 1 personal, got %d", len(got.Personals))
	}
	want.ID = got.Personals[0].ID
	want.ParsedAt = got.Personals[0].ParsedAt
	sort.Slice(want.HeroStats, func(i, j int) bool { return want.HeroStats[i].StatKey < want.HeroStats[j].StatKey })
	sort.Slice(got.Personals[0].HeroStats, func(i, j int) bool {
		return got.Personals[0].HeroStats[i].StatKey < got.Personals[0].HeroStats[j].StatKey
	})
	if !reflect.DeepEqual(got.Personals[0], want) {
		t.Fatalf("round-trip mismatch:\n got=%+v\nwant=%+v", got.Personals[0], want)
	}
}

// ──────────────────────────────────────────────────────────────────
// RANK round-trip with modifiers + SR per hero.
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_Rank_UpsertThenLoadRoundTrip(t *testing.T) {
	s := openMemory(t)
	want := RankRow{
		Filename: "r.png", MatchKey: "k1",
		Rank: "platinum", Level: 3, RankProgress: 40, ChangePercent: 5,
		Result:    "victory",
		Modifiers: []string{"expected", "victory"},
		SR: []HeroSR{
			{Hero: "lucio", SR: 3200, Change: 30},
			{Hero: "juno", SR: 2867, Change: 22},
		},
	}
	if err := s.UpsertRank(want); err != nil {
		t.Fatalf("UpsertRank: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got.Ranks) != 1 {
		t.Fatalf("expected 1 rank, got %d", len(got.Ranks))
	}
	want.ID = got.Ranks[0].ID
	want.ParsedAt = got.Ranks[0].ParsedAt
	sort.Strings(want.Modifiers)
	sort.Strings(got.Ranks[0].Modifiers)
	sort.Slice(want.SR, func(i, j int) bool { return want.SR[i].Hero < want.SR[j].Hero })
	sort.Slice(got.Ranks[0].SR, func(i, j int) bool { return got.Ranks[0].SR[i].Hero < got.Ranks[0].SR[j].Hero })
	if !reflect.DeepEqual(got.Ranks[0], want) {
		t.Fatalf("round-trip mismatch:\n got=%+v\nwant=%+v", got.Ranks[0], want)
	}
}

// ──────────────────────────────────────────────────────────────────
// LoadAllFilenames — union across all 5 parent tables.
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_LoadAllFilenames_UnionAcrossTables(t *testing.T) {
	s := openMemory(t)
	if err := s.UpsertSummary(SummaryRow{Filename: "s.png", MatchKey: "k1"}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertScoreboard(ScoreboardRow{Filename: "sb.png", MatchKey: "k1"}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertPersonal(PersonalRow{Filename: "p.png", MatchKey: "k1"}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertRank(RankRow{Filename: "r.png", MatchKey: "k1"}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertUnknown(UnknownRow{Filename: "u.png", MatchKey: "k1"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadAllFilenames()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"s.png", "sb.png", "p.png", "r.png", "u.png"}
	for _, w := range want {
		if !got[w] {
			t.Errorf("filename %q missing from union: %v", w, got)
		}
	}
}

// ──────────────────────────────────────────────────────────────────
// Clear — wipes every table; children cascade.
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_Clear_WipesEveryTable(t *testing.T) {
	s := openMemory(t)
	if err := s.UpsertSummary(SummaryRow{
		Filename: "a.png", MatchKey: "k1",
		HeroesPlayed: []SummaryHeroPlayed{{Hero: "lucio", PercentPlayed: 100}},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.Clear(); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	if len(got.Summaries) != 0 {
		t.Errorf("expected 0 summaries after Clear, got %d", len(got.Summaries))
	}
	var n int
	if err := s.db.QueryRow(`SELECT count(*) FROM summary_heroes_played`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("expected 0 child rows after Clear, got %d", n)
	}
}

// ──────────────────────────────────────────────────────────────────
// parsed_at — stamped on insert, preserved across re-upsert.
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_ParsedAt_PopulatedOnInsert(t *testing.T) {
	s := openMemory(t)
	if err := s.UpsertSummary(SummaryRow{Filename: "a.png", MatchKey: "k1"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadAll()
	if err != nil {
		t.Fatal(err)
	}
	if got.Summaries[0].ParsedAt == "" {
		t.Fatal("expected ParsedAt to be populated by CURRENT_TIMESTAMP default")
	}
}

func TestSQLStore_ParsedAt_StableAcrossReupsert(t *testing.T) {
	s := openMemory(t)
	if err := s.UpsertSummary(SummaryRow{Filename: "a.png", MatchKey: "k1"}); err != nil {
		t.Fatal(err)
	}
	first, err := s.LoadAll()
	if err != nil {
		t.Fatal(err)
	}
	originalStamp := first.Summaries[0].ParsedAt
	time.Sleep(1100 * time.Millisecond)
	if err := s.UpsertSummary(SummaryRow{Filename: "a.png", MatchKey: "k1", Map: "rialto"}); err != nil {
		t.Fatal(err)
	}
	second, err := s.LoadAll()
	if err != nil {
		t.Fatal(err)
	}
	if second.Summaries[0].ParsedAt != originalStamp {
		t.Errorf("parsed_at must not refresh on conflict:\n  first=%q\n second=%q",
			originalStamp, second.Summaries[0].ParsedAt)
	}
}

// ──────────────────────────────────────────────────────────────────
// FK enforcement — orphan inserts should fail.
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_ForeignKeysEnforced(t *testing.T) {
	s := openMemory(t)
	_, err := s.db.Exec(
		`INSERT INTO summary_heroes_played (summary_screenshot_id, hero, percent_played) VALUES (?,?,?)`,
		999, "lucio", 100,
	)
	if err == nil {
		t.Fatal("expected FK violation when inserting child without parent")
	}
}

// ──────────────────────────────────────────────────────────────────
// EnsureScreenshotsDir — INSERT-or-lookup for the screenshots_dirs
// reference table. Idempotent; empty path returns 0 (= SQL NULL).
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_EnsureScreenshotsDir(t *testing.T) {
	s := openMemory(t)

	// Empty path → 0, no row created.
	id, err := s.EnsureScreenshotsDir("")
	if err != nil {
		t.Fatalf("empty path: %v", err)
	}
	if id != 0 {
		t.Errorf("empty path: got id %d, want 0", id)
	}

	// First call creates the row.
	id1, err := s.EnsureScreenshotsDir("/Users/jacob/Documents/Overwatch/Screenshots")
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if id1 == 0 {
		t.Fatalf("first call: got id 0, want non-zero")
	}

	// Second call with the same path returns the same id.
	id2, err := s.EnsureScreenshotsDir("/Users/jacob/Documents/Overwatch/Screenshots")
	if err != nil {
		t.Fatalf("repeat call: %v", err)
	}
	if id2 != id1 {
		t.Errorf("repeat call: got id %d, want %d (idempotent)", id2, id1)
	}

	// Different path → different id.
	id3, err := s.EnsureScreenshotsDir("/tmp/some-other-dir")
	if err != nil {
		t.Fatalf("different path: %v", err)
	}
	if id3 == id1 {
		t.Errorf("different path: collided with first dir's id %d", id3)
	}
}

// ──────────────────────────────────────────────────────────────────
// ScreenshotsDirID propagation — round-trip the FK from Upsert →
// LoadAll for every parent type. Catches "I added the column to the
// schema but forgot to read/write it on table X".
// ──────────────────────────────────────────────────────────────────

func TestSQLStore_ScreenshotsDirID_RoundTrip(t *testing.T) {
	s := openMemory(t)
	dirID, err := s.EnsureScreenshotsDir("/test/dir")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertSummary(SummaryRow{Filename: "s.png", MatchKey: "k1", ScreenshotsDirID: dirID}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertScoreboard(ScoreboardRow{Filename: "sb.png", MatchKey: "k1", ScreenshotsDirID: dirID}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertPersonal(PersonalRow{Filename: "p.png", MatchKey: "k1", ScreenshotsDirID: dirID}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertRank(RankRow{Filename: "r.png", MatchKey: "k1", ScreenshotsDirID: dirID}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpsertUnknown(UnknownRow{Filename: "u.png", MatchKey: "k1", ScreenshotsDirID: dirID}); err != nil {
		t.Fatal(err)
	}

	got, err := s.LoadAll()
	if err != nil {
		t.Fatal(err)
	}
	if got.ScreenshotsDirs[dirID] != "/test/dir" {
		t.Errorf("ScreenshotsDirs[%d] = %q, want %q", dirID, got.ScreenshotsDirs[dirID], "/test/dir")
	}
	checks := []struct {
		name string
		id   int64
	}{
		{"summary", got.Summaries[0].ScreenshotsDirID},
		{"scoreboard", got.Scoreboards[0].ScreenshotsDirID},
		{"personal", got.Personals[0].ScreenshotsDirID},
		{"rank", got.Ranks[0].ScreenshotsDirID},
		{"unknown", got.Unknowns[0].ScreenshotsDirID},
	}
	for _, c := range checks {
		if c.id != dirID {
			t.Errorf("%s.ScreenshotsDirID = %d, want %d", c.name, c.id, dirID)
		}
	}
}

func TestSQLStore_Annotation_UpsertLoadDelete(t *testing.T) {
	s := openMemory(t)

	// Initial state — no annotations.
	got, err := s.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations empty: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty annotations map, got %d entries", len(got))
	}

	// Set one — round-trip.
	want := Annotation{MatchKey: "match:k1", Leaver: "team", Note: "ally dc'd at 3min"}
	if err := s.SetAnnotation(want); err != nil {
		t.Fatalf("SetAnnotation: %v", err)
	}
	got, err = s.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
	rt, ok := got["match:k1"]
	if !ok {
		t.Fatal("annotation not present after Set")
	}
	if rt.Leaver != "team" || rt.Note != want.Note {
		t.Errorf("round-trip mismatch: %+v", rt)
	}
	if rt.AnnotatedAt == "" {
		t.Error("AnnotatedAt should be auto-populated by the DEFAULT")
	}

	// Upsert changes leaver in place without inserting a duplicate.
	if err := s.SetAnnotation(Annotation{MatchKey: "match:k1", Leaver: "enemy"}); err != nil {
		t.Fatalf("Set upsert: %v", err)
	}
	got, _ = s.LoadAnnotations()
	if got["match:k1"].Leaver != "enemy" {
		t.Errorf("upsert didn't replace: %+v", got["match:k1"])
	}
	if len(got) != 1 {
		t.Errorf("upsert inserted a duplicate row; have %d", len(got))
	}

	// Delete clears.
	if err := s.DeleteAnnotation("match:k1"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, _ = s.LoadAnnotations()
	if len(got) != 0 {
		t.Errorf("expected empty after delete, got %d", len(got))
	}

	// Idempotent delete on a missing key.
	if err := s.DeleteAnnotation("missing"); err != nil {
		t.Errorf("Delete of missing key should be a no-op, got: %v", err)
	}
}

func TestSQLStore_Annotation_LeaverCheckConstraint(t *testing.T) {
	s := openMemory(t)
	// Invalid leaver value should fail the CHECK constraint at the SQL
	// layer. The App.SetLeaverAnnotation validator catches this first
	// in production; this test pins the belt-and-suspenders DB guard.
	err := s.SetAnnotation(Annotation{MatchKey: "k", Leaver: "afk"})
	if err == nil {
		t.Fatal("expected CHECK constraint to reject 'afk'")
	}
}

func TestSQLStore_Annotation_RoundTrip_AllFields(t *testing.T) {
	s := openMemory(t)
	want := Annotation{
		MatchKey:   "match:nx",
		Leaver:     "team",
		Note:       "ally rage-quit at 3min",
		ReplayCode: "7H1K9P",
		Members:    []string{"Apollo#11234", "Cheese#5678"},
	}
	if err := s.SetAnnotation(want); err != nil {
		t.Fatalf("SetAnnotation: %v", err)
	}
	got, err := s.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
	a, ok := got["match:nx"]
	if !ok {
		t.Fatal("annotation missing after Set")
	}
	if a.Leaver != "team" || a.Note != want.Note || a.ReplayCode != want.ReplayCode {
		t.Errorf("scalar round-trip mismatch: %+v", a)
	}
	if len(a.Members) != 2 {
		t.Fatalf("members count = %d, want 2", len(a.Members))
	}
	// LoadAnnotations orders members by (match_key, member); both inputs
	// happen to sort the same in this case, so just check the set.
	gotSet := map[string]bool{a.Members[0]: true, a.Members[1]: true}
	for _, m := range want.Members {
		if !gotSet[m] {
			t.Errorf("member %q missing from %+v", m, a.Members)
		}
	}
}

func TestSQLStore_Annotation_LeaverlessNoteOnly(t *testing.T) {
	s := openMemory(t)
	// Annotation with empty leaver — should still persist because the
	// CHECK constraint allows NULL after the relax migration.
	if err := s.SetAnnotation(Annotation{
		MatchKey: "k", Leaver: "", Note: "no leaver here",
	}); err != nil {
		t.Fatalf("SetAnnotation with empty leaver: %v", err)
	}
	got, _ := s.LoadAnnotations()
	if got["k"].Leaver != "" {
		t.Errorf("leaver should be empty, got %q", got["k"].Leaver)
	}
	if got["k"].Note != "no leaver here" {
		t.Errorf("note round-trip lost: %q", got["k"].Note)
	}
}

func TestSQLStore_Annotation_MembersRewrittenWholesale(t *testing.T) {
	s := openMemory(t)
	_ = s.SetAnnotation(Annotation{
		MatchKey: "k", Leaver: "team",
		Members: []string{"a", "b", "c"},
	})
	// Re-Set with a smaller list — old members should be replaced.
	_ = s.SetAnnotation(Annotation{
		MatchKey: "k", Leaver: "team",
		Members: []string{"x"},
	})
	got, _ := s.LoadAnnotations()
	if len(got["k"].Members) != 1 || got["k"].Members[0] != "x" {
		t.Errorf("expected members [x], got %+v", got["k"].Members)
	}
}

func TestSQLStore_Annotation_DeleteCascadesMembers(t *testing.T) {
	s := openMemory(t)
	_ = s.SetAnnotation(Annotation{
		MatchKey: "k", Leaver: "team",
		Members: []string{"a", "b"},
	})
	if err := s.DeleteAnnotation("k"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	// Members rows should have cascaded.
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM match_annotation_members WHERE match_key = ?`, "k").Scan(&n); err != nil {
		t.Fatalf("count members: %v", err)
	}
	if n != 0 {
		t.Errorf("expected 0 members after cascade, got %d", n)
	}
}
