package app_test

import (
	"strings"
	"testing"

	"recall/pkg/app"
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
		progress(1, 1, file, &parser.MatchResult{Playlist: "competitive", Rank: "platinum", Result: "defeat", RankProgress: new(12)}, nil)
		return nil
	})
	// ReParseAll, not ParseScreenshots: a stored file is in the normal run's
	// skip set, so the force path is the only route that can re-OCR and
	// reclassify it in production.
	if err := a.ReParseAll(); err != nil {
		t.Fatalf("ReParseAll: %v", err)
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

// The DB purge alone is not enough: the run snapshot drives every
// match-updated event and every later file's correlation within the run.
// If the stale sibling row survives in the snapshot, the event re-emits the
// exact garbage the reclassify just purged (first-non-empty fold prefers
// the older row) and the UI shows it until the next full reload.
func TestReParseAll_ReclassifiedFileEventCarriesNoStaleData(t *testing.T) {
	a, _ := newParseReadyApp(t)
	const file = "Overwatch 2 Screenshot 2026.07.05 - 14.54.48.79.png"

	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, file, &parser.MatchResult{Map: "garbage-map", Result: "defeat", Date: "2026-07-05"}, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("first ParseScreenshots: %v", err)
	}

	a.SSEHub = app.NewSSEHub()
	events := a.SSEHub.Subscribe()

	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, file, &parser.MatchResult{Playlist: "competitive", RankScreen: true, Rank: "platinum", Result: "defeat"}, nil)
		return nil
	})
	if err := a.ReParseAll(); err != nil {
		t.Fatalf("ReParseAll: %v", err)
	}

	for {
		select {
		case msg := <-events:
			if msg.Event != "match-updated" {
				continue
			}
			if strings.Contains(msg.Data, "garbage-map") {
				t.Fatalf("match-updated re-emitted the purged summary's data: %s", msg.Data)
			}
			return
		default:
			t.Fatal("no match-updated event observed for the reclassified file")
		}
	}
}

// all_heroes stores no data — only a skip-registry filename. A probe
// false-positive on a force run must NOT evict the file's real typed row:
// with the row gone and the file skip-listed, the loss would be silent and
// permanent (no dossier row, no Unknown entry, no ledger entry, and the
// deterministic misread repeats on every future re-parse).
func TestReParseAll_AllHeroesMisfireDoesNotEvictTypedRow(t *testing.T) {
	a, fake := newParseReadyApp(t)
	const file = "Overwatch 2 Screenshot 2026.07.05 - 14.55.02.89.png"

	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, file, &parser.MatchResult{Map: "colosseo", Result: "defeat", Date: "2026-07-05"}, nil)
		return nil
	})
	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("first ParseScreenshots: %v", err)
	}

	stubParse(t, func(progress parser.ProgressFunc) error {
		progress(1, 1, file, &parser.MatchResult{AllHeroes: true}, nil)
		return nil
	})
	if err := a.ReParseAll(); err != nil {
		t.Fatalf("ReParseAll: %v", err)
	}

	if len(fake.Summaries) != 1 || fake.Summaries[0].Filename != file {
		t.Fatalf("the typed row must survive an all_heroes classification, got %+v", fake.Summaries)
	}
	if !fake.AllHeroes[file] {
		t.Error("the all_heroes registry entry should still be recorded")
	}
}
