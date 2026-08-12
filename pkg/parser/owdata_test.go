package parser_test

import (
	"slices"
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

// TestRoster_RecognizesNewHeroShion guards the Shion roster addition: the new
// damage hero must resolve as known with the "dps" role label (the string
// aggregation + the role filter key off, shared by every heroes.yaml `dps:`
// entry).
func TestRoster_RecognizesNewHeroShion(t *testing.T) {
	if !parser.IsKnownHero("shion") {
		t.Error(`IsKnownHero("shion") = false, want true`)
	}
	if got := parser.HeroRole("shion"); got != "dps" {
		t.Errorf(`HeroRole("shion") = %q, want "dps"`, got)
	}
}

// TestRoster_RecognizesNewHeroDMon guards the D.Mon roster addition — the
// Season 4 tank. The name carries a period, so this also pins that normalize()
// keeps it in the OCR key ("d.mon") rather than stripping it the way it strips
// the colon from "Soldier: 76".
//
// The display spelling is Blizzard's ("D.Mon", capital M) and was transcribed
// from their hero page, NOT from parser output — see the Neon Junction test
// below for why that distinction is load-bearing.
func TestRoster_RecognizesNewHeroDMon(t *testing.T) {
	if !parser.IsKnownHero("d.mon") {
		t.Error(`IsKnownHero("d.mon") = false, want true`)
	}
	if got := parser.HeroRole("d.mon"); got != "tank" {
		t.Errorf(`HeroRole("d.mon") = %q, want "tank"`, got)
	}
}

// TestRoster_DMonDoesNotShadowDVa pins the collision this addition risks.
// "d.mon" and "d.va" are both short and share the "d." prefix, and
// closestFuzzyHero only skips candidates under 5 characters — "d.mon" is
// exactly 5, so it IS fuzzy-matchable. Each must still resolve to itself.
func TestRoster_DMonDoesNotShadowDVa(t *testing.T) {
	if got := parser.HeroRole("d.va"); got != "tank" {
		t.Errorf(`HeroRole("d.va") = %q, want "tank"`, got)
	}
	for raw, want := range map[string]string{"D.Va": "d.va", "D.Mon": "d.mon"} {
		if got := parser.FirstKnownHeroIn(raw); got != want {
			t.Errorf("FirstKnownHeroIn(%q) = %q, want %q", raw, got, want)
		}
	}
}

// TestRoster_NeonJunctionCanonical guards the Neon Junction roster entry.
// The map originally landed in maps.yaml as "Neon Function" — an OCR garble
// (J→F) transcribed from the parser's own output, which then made every
// future read canonicalize to the wrong name. The canonical entry must be
// the real map; the garble must snap TO it via the fuzzy matcher, never
// resolve as a known map itself.
func TestRoster_NeonJunctionCanonical(t *testing.T) {
	if !parser.IsKnownMap("neon junction") {
		t.Error(`IsKnownMap("neon junction") = false, want true`)
	}
	if parser.IsKnownMap("neon function") {
		t.Error(`IsKnownMap("neon function") = true, want false — the OCR garble must not be canonical`)
	}
	if hybrid := parser.MapsByGameMode()["hybrid"]; !slices.Contains(hybrid, "Neon Junction") {
		t.Errorf(`MapsByGameMode()["hybrid"] = %v, want it to contain "Neon Junction"`, hybrid)
	}
	if got := parser.SnapToKnownMap("NEON FUNCTION"); got != "neon junction" {
		t.Errorf(`SnapToKnownMap("NEON FUNCTION") = %q, want "neon junction"`, got)
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
