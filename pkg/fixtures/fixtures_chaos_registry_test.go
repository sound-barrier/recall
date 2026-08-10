package fixtures_test

import (
	"testing"

	"recall/pkg/fixtures"
)

// A registry map, unlike a switch, gets no exhaustive check from the
// linter — this test is that check. A category added to
// allChaosCategories without a registered shape would silently no-op
// in the generator and quietly shrink chaos coverage.
func TestChaosShapes_CoversEveryCategory(t *testing.T) {
	if len(fixtures.AllChaosCategories) == 0 {
		t.Fatal("allChaosCategories is empty — the chaos generator has nothing to pick from")
	}
	for _, cat := range fixtures.AllChaosCategories {
		if _, ok := fixtures.ChaosShapes[cat]; !ok {
			t.Errorf("chaos category %v has no registered shape", cat)
		}
	}
	if len(fixtures.ChaosShapes) != len(fixtures.AllChaosCategories) {
		t.Errorf("ChaosShapes has %d entries, allChaosCategories %d — an orphan shape is dead code",
			len(fixtures.ChaosShapes), len(fixtures.AllChaosCategories))
	}
}
