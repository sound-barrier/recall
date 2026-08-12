package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

// Emerald landed in Season 4, inserted BETWEEN Platinum and Diamond. Position
// is the assertion that matters: a tier's index is its ladder coordinate, so
// "emerald exists" is worth nothing without "emerald sits at 4".
func TestRanks_EmeraldSitsBetweenPlatinumAndDiamond(t *testing.T) {
	ranks := parser.Ranks()
	idx := map[string]int{}
	for i, r := range ranks {
		idx[r] = i
	}
	if !parser.IsKnownRank("emerald") {
		t.Fatal(`IsKnownRank("emerald") = false, want true`)
	}
	if idx["emerald"] != idx["platinum"]+1 || idx["diamond"] != idx["emerald"]+1 {
		t.Errorf("ladder order wrong: platinum=%d emerald=%d diamond=%d",
			idx["platinum"], idx["emerald"], idx["diamond"])
	}
	if want := 9; len(ranks) != want {
		t.Errorf("ladder length = %d, want %d", len(ranks), want)
	}
}

// The ladder must stay a strict lowest→highest sequence with no duplicates —
// a duplicate would give one tier two ladder positions.
func TestRanks_NoDuplicates(t *testing.T) {
	seen := map[string]bool{}
	for _, r := range parser.Ranks() {
		if seen[r] {
			t.Errorf("duplicate rank %q", r)
		}
		seen[r] = true
	}
}
