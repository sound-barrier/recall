package fixtures_test

import (
	"testing"

	"recall/pkg/fixtures"
	"recall/pkg/parser"
)

// Clash is a quickplay-only mode, so the random seeder must never emit a
// competitive Clash match — not via the playlist, the play-mode override seed,
// or a rank screenshot (rank screens only exist for competitive play).
func TestGenerateMatchFixture_ClashIsQuickplayOnly(t *testing.T) {
	fx := fixtures.GenerateMatchFixture(300, 42, "flex")

	clashKeys := map[string]bool{}
	for _, s := range fx.Summaries {
		if parser.MapGameMode(s.Map) != "clash" {
			continue
		}
		clashKeys[s.MatchKey] = true
		if s.Playlist == "competitive" {
			t.Errorf("clash summary %s has a competitive playlist", s.MatchKey)
		}
	}
	if len(clashKeys) == 0 {
		t.Fatal("fixture produced no clash maps — bump n or the seed so the assertion has teeth")
	}

	for _, seed := range fx.PlayModes {
		if clashKeys[seed.MatchKey] && seed.PlayMode == "competitive" {
			t.Errorf("clash match %s has a competitive play-mode seed", seed.MatchKey)
		}
	}
	for _, r := range fx.Ranks {
		if clashKeys[r.MatchKey] {
			t.Errorf("clash match %s has a rank row (rank is competitive-only)", r.MatchKey)
		}
	}
}
