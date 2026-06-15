package db_test

import (
	"testing"

	"recall/pkg/db"
)

// Round-trips the user override layer: set scalars persist, unset (nil) scalars
// stay nil, an explicit 0 is a real edit (not "unset"), children attach to the
// right hero, re-upsert replaces children wholesale, and delete clears it all.
func TestSQLStore_UserMatchData_RoundTrip(t *testing.T) {
	s, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	defer func() { _ = s.Close() }()

	const key = "match-2026-06-11T00-28-29"
	mapName, dmg, result, rank, lvl, pct := "hollywood", 0, "victory", "platinum", 5, 51
	want := db.UserMatchData{
		MatchKey: key,
		Map:      &mapName,
		Damage:   &dmg, // explicit zero must survive as an edit, not "unset"
		Result:   &result,
		Rank:     &rank,
		Level:    &lvl,
		Heroes: []db.UserMatchHero{
			{Hero: "baptiste", Position: 0, PercentPlayed: &pct},
			{Hero: "junkrat", Position: 1},
		},
		HeroStats: []db.UserMatchHeroStat{{Hero: "baptiste", StatKey: "healing_accuracy", Value: 66}},
		SR:        []db.HeroSR{{Hero: "baptiste", SR: 2697, Change: 23}},
		Modifiers: []string{"demotion protection"},
	}
	if err := s.UpsertUserMatchData(want); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	all, err := s.LoadAllUserMatchData()
	if err != nil {
		t.Fatalf("LoadAll: %v", err)
	}
	got, ok := all[key]
	if !ok {
		t.Fatalf("match_key not loaded back")
	}
	if got.Map == nil || *got.Map != "hollywood" {
		t.Errorf("Map = %v, want hollywood", got.Map)
	}
	if got.Damage == nil || *got.Damage != 0 {
		t.Errorf("Damage = %v, want explicit 0 (a real edit)", got.Damage)
	}
	if got.Healing != nil {
		t.Errorf("Healing = %v, want nil (not overridden)", got.Healing)
	}
	if got.Level == nil || *got.Level != 5 {
		t.Errorf("Level = %v, want 5", got.Level)
	}
	if len(got.Heroes) != 2 {
		t.Fatalf("Heroes = %d, want 2", len(got.Heroes))
	}
	if got.Heroes[0].Hero != "baptiste" {
		t.Errorf("primary hero wrong: %+v", got.Heroes[0])
	}
	if len(got.HeroStats) != 1 || got.HeroStats[0].Hero != "baptiste" || got.HeroStats[0].Value != 66 {
		t.Errorf("HeroStats wrong: %+v", got.HeroStats)
	}
	if len(got.SR) != 1 || got.SR[0].SR != 2697 {
		t.Errorf("SR wrong: %+v", got.SR)
	}
	if len(got.Modifiers) != 1 || got.Modifiers[0] != "demotion protection" {
		t.Errorf("Modifiers wrong: %v", got.Modifiers)
	}

	// Re-upsert with fewer children replaces them wholesale (no accumulation).
	want.Modifiers = nil
	want.Heroes = want.Heroes[:1]
	if err := s.UpsertUserMatchData(want); err != nil {
		t.Fatalf("re-Upsert: %v", err)
	}
	all, _ = s.LoadAllUserMatchData()
	if got = all[key]; len(got.Heroes) != 1 || len(got.Modifiers) != 0 {
		t.Errorf("re-upsert didn't replace children: heroes=%d mods=%d", len(got.Heroes), len(got.Modifiers))
	}

	// Delete clears the parent + cascades children.
	if err := s.DeleteUserMatchData(key); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	all, _ = s.LoadAllUserMatchData()
	if _, ok := all[key]; ok {
		t.Errorf("match still present after delete")
	}
}

// Clear must keep the default screenshots-dir sentinel (id=1) so a subsequent
// insert — e.g. a forced re-seed of an existing profile — doesn't FK-fail on
// the schema's screenshots_dir_id DEFAULT 1.
func TestSQLStore_Clear_PreservesDefaultScreenshotsDir(t *testing.T) {
	s, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	defer func() { _ = s.Close() }()

	if err := s.UpsertSummary(db.SummaryRow{Filename: "a.png", MatchKey: "m1"}); err != nil {
		t.Fatalf("seed UpsertSummary: %v", err)
	}
	if err := s.Clear(); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	// Pre-fix this FK-failed: Clear had dropped screenshots_dirs(1) but the
	// insert still defaults screenshots_dir_id to 1.
	if err := s.UpsertSummary(db.SummaryRow{Filename: "b.png", MatchKey: "m2"}); err != nil {
		t.Fatalf("UpsertSummary after Clear (regression — Clear dropped the default dir): %v", err)
	}
}
