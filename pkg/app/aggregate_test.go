package app

import (
	"reflect"
	"sort"
	"testing"

	"recall/pkg/db"
)

func TestAggregate_FusesSummaryAndScoreboardByMatchKey(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			ID: 1, Filename: "s.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:30:00Z",
			Map: "rialto", Mode: "competitive", Hero: "lucio",
			Result: "victory", Date: "2026-05-10", FinishedAt: "21:29",
		}},
		Scoreboards: []db.ScoreboardRow{{
			ID: 1, Filename: "sb.png", MatchKey: "m1", ParsedAt: "2026-05-10T21:30:05Z",
			Mode: "", // intentional: aggregator should pick "competitive" from sibling
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
	if rec.Data.Mode != "competitive" {
		t.Errorf("expected mode to fold to 'competitive' (from SUMMARY sibling), got %q", rec.Data.Mode)
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
	if rec.Data.Mode != "competitive" {
		t.Errorf("expected rank-derived mode=competitive, got %q", rec.Data.Mode)
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
