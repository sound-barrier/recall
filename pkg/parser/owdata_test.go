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
