package app_test

import (
	"testing"

	"recall/pkg/parser"
)

// A parser improvement can change a file's classification between runs —
// the 2026-07 bundle's rank screen whose garbled tier once stored it as a
// summary row is the canonical case. The second parse must leave exactly
// one row for the file, in the new type's table; without sibling cleanup
// the stale summary row survives beside the rank row and the match
// aggregates garbage forever.
func TestParseScreenshots_ReclassifiedFileLeavesNoStaleRow(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const file = "Overwatch 2 Screenshot 2026.07.05 - 14.54.48.79.png"

	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, file, &parser.MatchResult{Result: "defeat"}, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("first ParseScreenshots: %v", err)
	}
	if len(fake.Summaries) != 1 {
		t.Fatalf("precondition: first run stores a summary row, got %d", len(fake.Summaries))
	}

	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, file, &parser.MatchResult{Playlist: "competitive", Rank: "platinum", Result: "defeat", RankProgress: 12}, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("second ParseScreenshots: %v", err)
	}

	if len(fake.Summaries) != 0 {
		t.Errorf("stale summary row survived reclassification: %+v", fake.Summaries)
	}
	if len(fake.Ranks) != 1 || fake.Ranks[0].Filename != file {
		t.Fatalf("want exactly the rank row for %s, got %+v", file, fake.Ranks)
	}
	if fake.Ranks[0].MatchKey != "match-2026-07-05T14-54-48" {
		t.Errorf("match key must survive the type flip, got %q", fake.Ranks[0].MatchKey)
	}
}
