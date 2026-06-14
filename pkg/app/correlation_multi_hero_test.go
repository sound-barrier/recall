package app_test

import (
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/parser"
)

// Multi-hero bridging tests.
//
// `rowsConflict` used to reject any hero-mismatch between cand and an
// existing screenshot. In real OW play, a single match can have the
// player swap heroes mid-game: SUMMARY records hero=primary +
// heroes_played=[primary, swap]; TEAMS/PERSONAL captured during
// the swap portion record hero=swap. Those rows belong to the SAME
// match but the strict hero check splits them into separate match_keys
// (cohorts F + G in the 400-fixture stress test, 35 pinned bugs).
//
// The fix: rowsConflict consults a per-match-key hero set built from
// every row's contribution (SUMMARY's HeroesPlayed + each row's Hero).
// A hero mismatch is *not* a conflict when the candidate's hero is in
// the existing match's hero set OR the existing row's hero is in the
// candidate's HeroesPlayed list.

func TestResolveMatchKey_MultiHero_TeamsSwapAdoptsSummary(t *testing.T) {
	// SUMMARY anchored on hero=lucio with heroes_played=[lucio, kiriko];
	// TEAMS captured during the kiriko portion arrives 30 s later.
	// rowsConflict's hero predicate would split into two match_keys —
	// the multi-hero fix recognizes kiriko ∈ SUMMARY's heroesPlayed and
	// allows the bridge.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			Filename: "Overwatch 2 Screenshot 2026.07.15 - 14.00.00 _sum.png",
			MatchKey: "match-2026-07-15T14-00-00",
			Map:      "rialto",
			Hero:     "lucio",
			HeroesPlayed: []db.SummaryHeroPlayed{
				{Hero: "lucio", PercentPlayed: 70},
				{Hero: "kiriko", PercentPlayed: 30},
			},
		}},
	}
	teams := &parser.MatchResult{
		Map: "rialto", Hero: "kiriko",
		Eliminations: 18, Assists: 12, Deaths: 6,
	}
	key, _ := app.ResolveMatchKey("Overwatch 2 Screenshot 2026.07.15 - 14.00.30 _sb.png", teams, snap)
	if key != "match-2026-07-15T14-00-00" {
		t.Errorf("expected TEAMS to adopt SUMMARY's key via multi-hero bridge, got %q", key)
	}
}

func TestResolveMatchKey_MultiHero_SecondPersonalAdoptsMatch(t *testing.T) {
	// SUMMARY has heroes_played=[heroA, heroB]; TEAMS + PERSONAL 1
	// already attached on heroA. Second PERSONAL with hero=heroB arrives
	// at +75 s; the closest existing row is PERSONAL 1 (heroA) — without
	// the multi-hero fix it would split off because PERSONAL 1 alone
	// only knows heroA. With the fix, the per-match-key hero set
	// resolved from SUMMARY's HeroesPlayed includes heroB, so PERSONAL 2
	// bridges into the same match.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			Filename: "Overwatch 2 Screenshot 2026.07.20 - 14.00.00 _sum.png",
			MatchKey: "match-2026-07-20T14-00-00",
			Map:      "rialto",
			Hero:     "ana",
			HeroesPlayed: []db.SummaryHeroPlayed{
				{Hero: "ana", PercentPlayed: 60},
				{Hero: "lucio", PercentPlayed: 40},
			},
		}},
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.07.20 - 14.00.30 _sb.png",
			MatchKey:     "match-2026-07-20T14-00-00",
			Eliminations: 15, Assists: 8, Deaths: 5,
		}},
		Personals: []db.PersonalRow{{
			Filename: "Overwatch 2 Screenshot 2026.07.20 - 14.00.45 _p1.png",
			MatchKey: "match-2026-07-20T14-00-00",
			Hero:     "ana",
		}},
	}
	personal2 := &parser.MatchResult{Hero: "lucio"}
	key, _ := app.ResolveMatchKey("Overwatch 2 Screenshot 2026.07.20 - 14.01.15 _p2.png", personal2, snap)
	if key != "match-2026-07-20T14-00-00" {
		t.Errorf("expected PERSONAL 2 to bridge to the match via multi-hero, got %q", key)
	}
}

func TestResolveMatchKey_MultiHero_ReverseOrder_SummaryBridgesToTeams(t *testing.T) {
	// TEAMS arrives first (only carries hero=swap, no HeroesPlayed).
	// SUMMARY arrives 30 s later with hero=primary +
	// HeroesPlayed=[primary, swap]. The candidate (SUMMARY) carries
	// HeroesPlayed; the existing row (TEAMS) is the lone hero=swap.
	// Bridge holds because TEAMS hero is in SUMMARY's
	// HeroesPlayed.
	snap := db.Screenshots{
		Teams: []db.TeamsRow{{
			Filename:     "Overwatch 2 Screenshot 2026.07.15 - 14.00.00 _sb.png",
			MatchKey:     "match-2026-07-15T14-00-00",
			Eliminations: 18, Assists: 12, Deaths: 6,
		}},
	}
	summary := &parser.MatchResult{
		Map: "rialto", Hero: "lucio",
		HeroesPlayed: []parser.HeroPlay{
			{Hero: "lucio", PercentPlayed: 70},
			{Hero: "kiriko", PercentPlayed: 30},
		},
	}
	key, _ := app.ResolveMatchKey("Overwatch 2 Screenshot 2026.07.15 - 14.00.30 _sum.png", summary, snap)
	if key != "match-2026-07-15T14-00-00" {
		t.Errorf("expected SUMMARY to bridge to TEAMS via reverse multi-hero match, got %q", key)
	}
}

func TestResolveMatchKey_MultiHero_UnrelatedHeroStillConflicts(t *testing.T) {
	// Sanity check: when the candidate's hero is NOT in the existing
	// match's hero set (and the existing's hero is not in the candidate's
	// HeroesPlayed), the hero conflict still fires.
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{
			Filename: "Overwatch 2 Screenshot 2026.07.15 - 14.00.00 _sum.png",
			MatchKey: "match-2026-07-15T14-00-00",
			Map:      "rialto",
			Hero:     "lucio",
			HeroesPlayed: []db.SummaryHeroPlayed{
				{Hero: "lucio", PercentPlayed: 100},
			},
		}},
	}
	// TEAMS with hero=ana (not in SUMMARY's heroes_played) lands
	// outside the existing match.
	teams := &parser.MatchResult{Hero: "ana"}
	key, _ := app.ResolveMatchKey("Overwatch 2 Screenshot 2026.07.15 - 14.00.30 _sb.png", teams, snap)
	if key == "match-2026-07-15T14-00-00" {
		t.Errorf("unrelated hero should NOT bridge, but got %q", key)
	}
}
