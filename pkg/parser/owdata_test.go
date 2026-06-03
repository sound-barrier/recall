package parser

import (
	"testing"
)

// TestEmbeddedYAML_LoadsCleanly is the build-time gate that replaces
// the runtime panic the loaders used to do. If a bad YAML lands in
// the embedded set, this test fails in CI BEFORE the binary ships —
// no chance to flash-crash a desktop user's window.
func TestEmbeddedYAML_LoadsCleanly(t *testing.T) {
	t.Parallel()

	// init() in owdata.go has already run by the time the test
	// binary starts. The error-tracking ref is what we assert
	// against — non-nil means at least one YAML parse failed.
	if OWDataLoadError != nil {
		t.Fatalf("embedded OW data failed to load: %v", OWDataLoadError)
	}

	// Sanity-check the registries — empty would mean a YAML parsed
	// but had no content, which is its own kind of regression.
	if len(HeroesByRole) == 0 {
		t.Error("HeroesByRole is empty — heroes.yaml parsed but registered no entries")
	}
	if len(MapsByType) == 0 {
		t.Error("MapsByType is empty — maps.yaml parsed but registered no entries")
	}
	if len(heroStatKeys) == 0 {
		t.Error("heroStatKeys is empty — hero_stats.yaml parsed but registered no entries")
	}
}
