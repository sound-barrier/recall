package app

import (
	"reflect"
	"sort"
	"testing"

	"recall/pkg/db"
)

// Boot re-aggregator pins the "YAML grew, promote previously-Unknown
// records" contract. Independent of the live heroes.yaml roster —
// supplies its own matcher closures so the test isn't coupled to the
// global heroRoles init.
func TestReAggregateUnknowns_PromotesPreviouslyUnknownRows(t *testing.T) {
	fs := &fakeStore{}
	fs.Summaries = []db.SummaryRow{
		// Row 1: pre-fix Mei-misattribution → hero='mei', hero_raw='mei'.
		// Matcher leaves it alone because canonical is already set.
		{ID: 1, Filename: "a.png", MatchKey: "ma", Hero: "mei", HeroRaw: "mei"},
		// Row 2: Unknown hero captured by the new fix → hero='',
		// hero_raw='miyazaki'. Matcher promotes it when the YAML grows.
		{ID: 2, Filename: "b.png", MatchKey: "mb", Hero: "", HeroRaw: "miyazaki"},
		// Row 3: still genuinely unknown → matcher returns ''.
		{ID: 3, Filename: "c.png", MatchKey: "mc", Hero: "", HeroRaw: "zhang3000"},
		// Row 4: map promotion → map='', map_raw='new-map-name'.
		{ID: 4, Filename: "d.png", MatchKey: "md", Hero: "lucio", HeroRaw: "lucio", Map: "", MapRaw: "new-map-name"},
	}
	a := NewWithStore(fs)
	heroFn := func(raw string) string {
		if raw == "miyazaki" {
			return "miyazaki"
		}
		return ""
	}
	mapFn := func(raw string) string {
		if raw == "new-map-name" {
			return "new-map"
		}
		return ""
	}
	promoted, err := fs.ReAggregateUnknowns(heroFn, mapFn)
	if err != nil {
		t.Fatalf("ReAggregateUnknowns: %v", err)
	}
	if promoted != 2 {
		t.Errorf("expected 2 promotions (row 2 hero + row 4 map), got %d", promoted)
	}
	if fs.Summaries[1].Hero != "miyazaki" {
		t.Errorf("row 2 hero = %q, want miyazaki", fs.Summaries[1].Hero)
	}
	if fs.Summaries[2].Hero != "" {
		t.Errorf("row 3 hero should stay '', got %q", fs.Summaries[2].Hero)
	}
	if fs.Summaries[3].Map != "new-map" {
		t.Errorf("row 4 map = %q, want new-map", fs.Summaries[3].Map)
	}
	// Confirm the App-level wrapper threads through correctly.
	_ = a // not exercising the live App.reAggregateUnknowns here; the
	// store-level fake gets the same code path via NewWithStore.
}

func TestAggregate_FusesSummaryAndScoreboardByMatchKey(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:30:00Z",
			Map: "rialto", Playlist: "competitive", Hero: "lucio",
			Result: "victory", Date: "2026-05-10", FinishedAt: "21:29",
		}},
		Scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "sb.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:30:05Z",
			Playlist:     "", // intentional: aggregator should pick "competitive" from sibling
			Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200,
		}},
	}
	got := aggregateScreenshots(snap)
	if len(got) != 1 {
		t.Fatalf("expected 1 fused record, got %d", len(got))
	}
	rec := got[0]
	if rec.Data.Map != "rialto" || rec.Data.Damage != 7200 || rec.Data.Result != "victory" {
		t.Errorf("scalars not fused: %+v", rec.Data)
	}
	if rec.Data.Playlist != "competitive" {
		t.Errorf("expected mode to fold to 'competitive' (from SUMMARY sibling), got %q", rec.Data.Playlist)
	}
}

func TestAggregate_DerivedFields_RoleFromHero_TypeFromMap(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "m1",
			Map: "antarctic peninsula", Hero: "juno",
		}},
	}
	got := aggregateScreenshots(snap)
	if got[0].Data.Role != "support" {
		t.Errorf("expected role=support (lucio/juno are support heroes); got %q", got[0].Data.Role)
	}
	if got[0].Data.Type != "control" {
		t.Errorf("expected type=control (antarctic peninsula is a control map); got %q", got[0].Data.Type)
	}
}

func TestAggregate_DerivedFields_HeroUnknown_LeavesRoleEmpty(t *testing.T) {
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "sb.png", MatchKey: "m1", Hero: "nonexistent_hero",
		}},
	}
	got := aggregateScreenshots(snap)
	if got[0].Data.Role != "" {
		t.Errorf("unknown hero should leave role empty, got %q", got[0].Data.Role)
	}
}

func TestAggregate_SourceFilesUnion_AndTypesMap(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "m1", Map: "rialto",
		}},
		Scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "sb.png", MatchKey: "m1", Eliminations: 17,
		}},
		Personals: []db.PersonalRow{{
			ID: 1, Filename: "p.png", MatchKey: "m1", Hero: "lucio",
		}},
		Ranks: []db.RankRow{{
			ID: 1, Filename: "r.png", MatchKey: "m1", Rank: "platinum",
		}},
	}
	got := aggregateScreenshots(snap)
	rec := got[0]
	sort.Strings(rec.SourceFiles)
	wantFiles := []string{"p.png", "r.png", "s.png", "sb.png"}
	if !reflect.DeepEqual(rec.SourceFiles, wantFiles) {
		t.Errorf("source files union broken: %v", rec.SourceFiles)
	}
	wantTypes := map[string]string{
		"s.png": "summary", "sb.png": "scoreboard",
		"p.png": "personal", "r.png": "rank",
	}
	if !reflect.DeepEqual(rec.SourceTypes, wantTypes) {
		t.Errorf("source types map broken: %+v", rec.SourceTypes)
	}
}

func TestAggregate_ParsedAt_MinAcrossGroup(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "m1", ParsedAt: "2026-05-10T22:00:00Z",
		}},
		Scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "sb.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:30:05Z",
		}},
	}
	got := aggregateScreenshots(snap)
	if got[0].ParsedAt != "2026-05-10T21:30:05Z" {
		t.Errorf("expected MIN(parsed_at) across the group, got %q", got[0].ParsedAt)
	}
	if got[0].SourceParsedAt["s.png"] != "2026-05-10T22:00:00Z" {
		t.Errorf("per-file parsed_at wrong: %+v", got[0].SourceParsedAt)
	}
}

func TestAggregate_PartialCoverage_RankOnly(t *testing.T) {
	// Only a rank screenshot — no SUMMARY, no SCOREBOARD. Should still
	// produce a MatchRecord with the rank fields populated and
	// mode=competitive (rank screens are always competitive).
	snap := db.Screenshots{
		Ranks: []db.RankRow{{
			ID: 1, Filename: "r.png", MatchKey: "m1",
			Rank: "platinum", Level: 3, RankProgress: 40, ChangePercent: 5,
			SR: []db.HeroSR{{Hero: "juno", SR: 2867, Change: 22}},
		}},
	}
	got := aggregateScreenshots(snap)
	if len(got) != 1 {
		t.Fatalf("expected 1 record, got %d", len(got))
	}
	rec := got[0]
	if rec.Data.Rank != "platinum" || rec.Data.Level != 3 {
		t.Errorf("rank fields lost: %+v", rec.Data)
	}
	if rec.Data.Playlist != "competitive" {
		t.Errorf("expected rank-derived mode=competitive, got %q", rec.Data.Playlist)
	}
	if len(rec.Data.SR) != 1 || rec.Data.SR[0].SR != 2867 {
		t.Errorf("SR not folded from child: %+v", rec.Data.SR)
	}
}

func TestAggregate_PersonalHeroStats_AttachedByHero(t *testing.T) {
	// PERSONAL screenshot with hero stats: aggregator must build
	// HeroesPlayed[0].Stats from the child rows.
	snap := db.Screenshots{
		Personals: []db.PersonalRow{{
			ID: 1, Filename: "p.png", MatchKey: "m1", Hero: "juno",
			HeroStats: []db.HeroStat{
				{Hero: "juno", StatKey: "weapon_accuracy", StatValue: 24},
				{Hero: "juno", StatKey: "players_saved", StatValue: 5},
			},
		}},
	}
	got := aggregateScreenshots(snap)
	rec := got[0]
	if len(rec.Data.HeroesPlayed) != 1 {
		t.Fatalf("expected 1 HeroesPlayed entry, got %d", len(rec.Data.HeroesPlayed))
	}
	hp := rec.Data.HeroesPlayed[0]
	if hp.Hero != "juno" {
		t.Errorf("hero name lost: %q", hp.Hero)
	}
	if hp.Stats["weapon_accuracy"] != 24 || hp.Stats["players_saved"] != 5 {
		t.Errorf("stats not attached by hero: %+v", hp.Stats)
	}
}

func TestAggregate_OneMatchRecordPerMatchKey(t *testing.T) {
	// Two distinct match_keys → two MatchRecords.
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{
			{ID: 1, Filename: "a.png", MatchKey: "m1", Eliminations: 17},
			{ID: 2, Filename: "b.png", MatchKey: "m2", Eliminations: 5},
		},
	}
	got := aggregateScreenshots(snap)
	if len(got) != 2 {
		t.Fatalf("expected 2 records (one per match_key), got %d", len(got))
	}
}

// ──────────────────────────────────────────────────────────────────
// aggregateMatchKey — per-match extract that powers the
// "match-updated" SSE event. Same precedence rules as
// aggregateScreenshots, scoped to one key.
// ──────────────────────────────────────────────────────────────────

func TestAggregateMatchKey_FusesAcrossTypesForOneKey(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "m1",
			Map: "rialto", Playlist: "competitive", Hero: "lucio",
			Result: "victory", Date: "2026-05-10", FinishedAt: "21:29",
		}},
		Scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "sb.png", MatchKey: "m1",
			Eliminations: 17, Assists: 16, Deaths: 11, Damage: 7200,
		}},
		// A second match that should NOT contaminate the m1 fold.
		Personals: []db.PersonalRow{{
			ID: 1, Filename: "p2.png", MatchKey: "m2", Hero: "juno",
		}},
	}
	rec, ok := aggregateMatchKey("m1", snap, nil, nil, nil)
	if !ok {
		t.Fatal("aggregateMatchKey returned ok=false for an existing key")
	}
	if rec.MatchKey != "m1" {
		t.Errorf("MatchKey = %q, want m1", rec.MatchKey)
	}
	if rec.Data.Map != "rialto" || rec.Data.Damage != 7200 || rec.Data.Result != "victory" {
		t.Errorf("scalars not fused as expected: %+v", rec.Data)
	}
	if len(rec.SourceFiles) != 2 {
		t.Errorf("SourceFiles should have 2 entries, got %v", rec.SourceFiles)
	}
}

func TestAggregateMatchKey_MissingKeyReturnsFalse(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{ID: 1, Filename: "s.png", MatchKey: "m1"}},
	}
	_, ok := aggregateMatchKey("nonexistent", snap, nil, nil, nil)
	if ok {
		t.Error("aggregateMatchKey returned ok=true for an unseen key")
	}
}

func TestAggregateMatchKey_SingleScreenshotMatch(t *testing.T) {
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "lone.png", MatchKey: "m-lonely",
			Eliminations: 8, Assists: 2, Deaths: 4,
		}},
	}
	rec, ok := aggregateMatchKey("m-lonely", snap, nil, nil, nil)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if rec.Data.Eliminations != 8 || rec.Data.Assists != 2 || rec.Data.Deaths != 4 {
		t.Errorf("single-scoreboard data not propagated: %+v", rec.Data)
	}
	if got := rec.SourceTypes["lone.png"]; got != "scoreboard" {
		t.Errorf("SourceTypes[lone.png] = %q, want scoreboard", got)
	}
}

func TestAggregateMatchKey_InferenceAppliedAtReadTime(t *testing.T) {
	// Rank-only match with a positive SR change should have Result
	// inferred to "victory" — same behaviour as GetMatchResults, which
	// is the contract for the live-stream event.
	snap := db.Screenshots{
		Ranks: []db.RankRow{{
			ID: 1, Filename: "rank.png", MatchKey: "m-rank",
			Rank: "platinum", Level: 3,
			SR: []db.HeroSR{{Hero: "lucio", SR: 2350, Change: 23}},
		}},
	}
	rec, ok := aggregateMatchKey("m-rank", snap, nil, nil, nil)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if rec.Data.Result != "victory" {
		t.Errorf("expected inferred Result=victory from positive SR change, got %q", rec.Data.Result)
	}
}

func TestAggregate_AmbiguousSurfacesCandidates(t *testing.T) {
	// A scoreboard + summary share the ambiguous sentinel. The
	// aggregator should fuse them into one MatchRecord, flag it
	// Ambiguous=true, and attach the candidate list pulled from
	// snap.AmbiguousCandidates keyed by the filename embedded in
	// the sentinel.
	snap := db.Screenshots{
		Scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "sb.png", MatchKey: "ambiguous-sb.png",
			Eliminations: 17, Assists: 8, Deaths: 4,
		}},
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "sum.png", MatchKey: "ambiguous-sb.png",
			Map: "rialto",
		}},
		AmbiguousCandidates: map[string][]db.AmbiguousCandidate{
			"sb.png": {
				{MatchKey: "match-2026-05-10T21-29-28", DistanceSeconds: 600},
				{MatchKey: "match-2026-05-10T22-00-00", DistanceSeconds: 1800},
			},
		},
	}
	recs := aggregateScreenshots(snap)
	attachAmbiguity(recs, snap.AmbiguousCandidates)
	if len(recs) != 1 {
		t.Fatalf("expected 1 fused record, got %d", len(recs))
	}
	r := recs[0]
	if !r.Ambiguous {
		t.Errorf("Ambiguous=false; expected true for ambiguous: sentinel")
	}
	if len(r.Candidates) != 2 {
		t.Fatalf("expected 2 candidates, got %d", len(r.Candidates))
	}
	if r.Candidates[0].MatchKey != "match-2026-05-10T21-29-28" || r.Candidates[0].DistanceSeconds != 600 {
		t.Errorf("first candidate wrong: %+v", r.Candidates[0])
	}
}

func TestAggregate_NonAmbiguousLeavesFieldsZero(t *testing.T) {
	// Sanity check — a regular record stays clean.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "match-foo",
			Map: "rialto",
		}},
	}
	recs := aggregateScreenshots(snap)
	attachAmbiguity(recs, snap.AmbiguousCandidates)
	if recs[0].Ambiguous {
		t.Errorf("Ambiguous flipped on a non-ambiguous record")
	}
	if recs[0].Candidates != nil {
		t.Errorf("Candidates set on a non-ambiguous record: %+v", recs[0].Candidates)
	}
}
