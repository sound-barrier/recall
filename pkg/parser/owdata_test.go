package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

// TestEmbeddedYAML_LoadsCleanly is the build-time gate that replaces
// the runtime panic the loaders used to do. If a bad YAML lands in
// the embedded set, this test fails in CI BEFORE the binary ships —
// no chance to flash-crash a desktop user's window.
func TestEmbeddedYAML_LoadsCleanly(t *testing.T) {
	// init() in owdata.go has already run by the time the test
	// binary starts; LoadError() reports any per-YAML parse failure
	// (joined across heroes / maps / hero_stats / screenshot_sources).
	if err := parser.LoadError(); err != nil {
		t.Fatalf("embedded OW data failed to load: %v", err)
	}

	// Sanity-check the registries — empty would mean a YAML parsed
	// but had no content, which is its own kind of regression.
	if len(parser.HeroesByRole()) == 0 {
		t.Error("HeroesByRole() is empty — heroes.yaml parsed but registered no entries")
	}
	if len(parser.MapsByGameMode()) == 0 {
		t.Error("MapsByGameMode() is empty — maps.yaml parsed but registered no entries")
	}
	if len(parser.HeroStatKeys()) == 0 {
		t.Error("heroStatKeys is empty — hero_stats.yaml parsed but registered no entries")
	}
}

// SnapHeroStatKey corrects OCR-mangled stat keys to the hero's canonical roster
// (hero_stats.yaml). The PERSONAL parser's short-word trim drops a legit prefix
// ("RIP-TIRE KILL" → tire_kill) and the italic font inserts a stray letter
// ("EARTHSHATTER" → earthshatiter); both snap back. Correct keys must stay put
// — including ones near a same-prefix sibling — via the exact-match shortcut.
func TestSnapHeroStatKey_CanonicalizesMangledLabels(t *testing.T) {
	cases := []struct {
		hero, raw, want string
	}{
		{"junkrat", "tire_kill", "rip_tire_kill"},
		{"reinhardt", "earthshatiter_kills", "earthshatter_kills"},
		{"reinhardt", "earthshatter_stuns", "earthshatter_stuns"},         // exact, not snapped to a sibling earthshatter_*
		{"baptiste", "weapon_accuracy", "weapon_accuracy"},                // exact match
		{"junkrat", "totally_unrelated_label", "totally_unrelated_label"}, // nothing within threshold
		{"nonexistent_hero", "tire_kill", "tire_kill"},                    // no roster → passthrough
	}
	for _, c := range cases {
		if got := parser.SnapHeroStatKey(c.hero, c.raw); got != c.want {
			t.Errorf("SnapHeroStatKey(%q, %q) = %q, want %q", c.hero, c.raw, got, c.want)
		}
	}
}
