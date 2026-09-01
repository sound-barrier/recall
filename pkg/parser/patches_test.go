package parser_test

import (
	"testing"
	"time"

	"recall/pkg/parser"
)

// Patches() is the list the split widget divides a history on. Two things
// matter about it and neither is obvious from the YAML: every season start is
// in it (a season start is always a patch), and it is ordered.

func TestPatches_CarriesEverySeasonStart(t *testing.T) {
	patches := parser.Patches()
	at := make(map[time.Time]string, len(patches))
	for _, p := range patches {
		at[p.At.UTC()] = p.Name
	}
	seasons := parser.Seasons()
	if len(seasons) == 0 {
		t.Fatal("no seasons loaded — the fixture this test rests on is gone")
	}
	for _, s := range seasons {
		if _, ok := at[s.Start.UTC()]; !ok {
			t.Errorf("season %q starts at %s and no patch marks it", s.Name, s.Start.UTC())
		}
	}
}

// The season start must arrive from seasons.yaml rather than a copy in
// patches.yaml — the duplicate is what let a corrected start move the season
// filter and leave the patch split on the old boundary.
func TestPatches_DoesNotDuplicateASeasonStart(t *testing.T) {
	seen := make(map[time.Time]int)
	for _, p := range parser.Patches() {
		seen[p.At.UTC()]++
	}
	for at, n := range seen {
		if n > 1 {
			t.Errorf("%d patches share the instant %s", n, at)
		}
	}
}

func TestPatches_AreOrderedOldestFirst(t *testing.T) {
	patches := parser.Patches()
	for i := 1; i < len(patches); i++ {
		if patches[i].At.Before(patches[i-1].At) {
			t.Fatalf("patch %d (%s) precedes patch %d (%s)",
				i, patches[i].At, i-1, patches[i-1].At)
		}
	}
}
