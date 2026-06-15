package app_test

import (
	"testing"

	"recall/pkg/parser"
)

// The complete Hollywood open-queue (6v6) competitive match the user captured:
// SUMMARY + post-match TEAMS + three PERSONAL tabs (a tri-role baptiste →
// junkrat → reinhardt swap) + the All Heroes aggregate. All six screenshots
// burst within ~10s, so the 2-minute window folds them into ONE match; the
// matching E/A/D (11/12/3 on both SUMMARY and TEAMS — see the bracket-mangled
// eliminations fix) also bridges them by EAD signature, and the SUMMARY's
// heroes_played list lets the off-hero PERSONAL tabs correlate despite their
// hero differing from the anchor. The All Heroes screen is recognized + skipped.
func TestApp_ParseScreenshots_CompleteOpenQueueMatchFolds(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const allHeroesFile = "Overwatch 2 Screenshot 2026.06.11 - 00.28.39.57.png"
	stubParse(t, func(progress parser.ProgressFunc) error {
		i := 0
		emit := func(file string, r *parser.MatchResult) { i++; progress(i, 6, file, r, nil) }
		emit("Overwatch 2 Screenshot 2026.06.11 - 00.28.29.05.png", &parser.MatchResult{
			Map: "hollywood", GameMode: "hybrid", Role: "support", Hero: "baptiste",
			Eliminations: 11, Assists: 12, Deaths: 3,
			Result: "victory", FinalScore: "3-0", Date: "2026-06-11", FinishedAt: "00:27", GameLength: "7:39",
			HeroesPlayed: []parser.HeroPlay{
				{Hero: "baptiste", PercentPlayed: 51, PlayTime: "03:54"},
				{Hero: "junkrat", PercentPlayed: 29, PlayTime: "02:11"},
				{Hero: "reinhardt", PercentPlayed: 20, PlayTime: "01:32"},
			},
		})
		emit("Overwatch 2 Screenshot 2026.06.11 - 00.28.31.63.png", &parser.MatchResult{
			Eliminations: 11, Assists: 12, Deaths: 3,
			Damage: 6091, Healing: 3042, Mitigation: 1975, QueueType: "open",
		})
		emit("Overwatch 2 Screenshot 2026.06.11 - 00.28.33.80.png", &parser.MatchResult{
			Role: "support", Hero: "baptiste",
			HeroesPlayed: []parser.HeroPlay{{Hero: "baptiste", Stats: map[string]int{"healing_accuracy": 66}}},
		})
		emit("Overwatch 2 Screenshot 2026.06.11 - 00.28.35.46.png", &parser.MatchResult{
			Role: "dps", Hero: "junkrat",
			HeroesPlayed: []parser.HeroPlay{{Hero: "junkrat", Stats: map[string]int{"weapon_accuracy": 31}}},
		})
		emit("Overwatch 2 Screenshot 2026.06.11 - 00.28.37.17.png", &parser.MatchResult{
			Role: "tank", Hero: "reinhardt",
			HeroesPlayed: []parser.HeroPlay{{Hero: "reinhardt", Stats: map[string]int{"fire_strike_accuracy": 50}}},
		})
		emit(allHeroesFile, &parser.MatchResult{AllHeroes: true})
		return nil
	})

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	recs, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("the six screenshots must fold into ONE match, got %d", len(recs))
	}
	rec := recs[0]
	got := rec.Data
	if got.Map != "hollywood" || got.GameMode != "hybrid" || got.Result != "victory" || got.FinalScore != "3-0" {
		t.Errorf("summary fields: map=%q mode=%q result=%q score=%q", got.Map, got.GameMode, got.Result, got.FinalScore)
	}
	if got.Eliminations != 11 || got.Assists != 12 || got.Deaths != 3 {
		t.Errorf("E/A/D = %d/%d/%d, want 11/12/3 (SUMMARY+TEAMS agree)", got.Eliminations, got.Assists, got.Deaths)
	}
	if got.Damage != 6091 || got.Healing != 3042 || got.Mitigation != 1975 {
		t.Errorf("TEAMS combat totals: dmg=%d heal=%d mit=%d", got.Damage, got.Healing, got.Mitigation)
	}
	// The aggregator lifts the TEAMS-inferred queue_type to the record's
	// top-level QueueType (the effective field a user annotation can override);
	// data.QueueType is cleared to avoid duplicating it.
	if rec.QueueType != "open" {
		t.Errorf("queue_type = %q, want open (6v6 — inferred from TEAMS)", rec.QueueType)
	}
	if len(got.HeroesPlayed) != 3 {
		t.Errorf("heroes_played = %d heroes, want 3 (tri-role swap)", len(got.HeroesPlayed))
	}
	if rec.SourceTypes[allHeroesFile] != "" {
		t.Errorf("All Heroes screenshot must not be a match source, got type %q", rec.SourceTypes[allHeroesFile])
	}
	if recognized, _ := fake.LoadAllHeroesFilenames(); !recognized[allHeroesFile] {
		t.Error("All Heroes screenshot not recorded in the recognized-skip list")
	}
}
