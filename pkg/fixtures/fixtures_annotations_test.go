package fixtures_test

import (
	"strings"
	"testing"

	"recall/pkg/fixtures"
)

// The conventional + custom tags the seed may apply. Black-box, so we mirror the
// known set here — an unexpected tag means the generator drifted.
var seedAnnotationTags = map[string]bool{
	"stack": true, "stream": true, "placement": true,
	"tilt": true, "smurf": true, "comeback": true, "thrower": true, "gg": true, "vod-review": true,
}

var seedAnnotationLeavers = map[string]bool{"self": true, "team": true, "enemy": true}

// TestAnnotationSeeds_RealisticAndDeterministic verifies the walkthrough-
// equivalent corpus (chaos-free) carries believable per-match annotations, that
// every annotation kind appears across a 500-match run, and that a fixed seed
// reproduces the same set.
func TestAnnotationSeeds_RealisticAndDeterministic(t *testing.T) {
	fx := fixtures.GenerateMatchFixtureWithChaos(500, 8, "flex", 0)

	if len(fx.Annotations) == 0 {
		t.Fatal("no annotations seeded")
	}
	if n := len(fx.Annotations); n < 50 || n >= len(fx.Summaries) {
		t.Errorf("annotation count %d looks off — want a realistic minority of %d matches", n, len(fx.Summaries))
	}

	keys := make(map[string]bool, len(fx.Annotations))
	var members, notes, tags, replays, leavers int
	for _, a := range fx.Annotations {
		if a.MatchKey == "" {
			t.Error("annotation with empty match key")
		}
		if keys[a.MatchKey] {
			t.Errorf("duplicate annotation for %s", a.MatchKey)
		}
		keys[a.MatchKey] = true

		// No content-free rows — an all-empty annotation is dropped, not written.
		if a.Note == "" && a.ReplayCode == "" && a.Leaver == "" && len(a.Members) == 0 && len(a.Tags) == 0 {
			t.Errorf("content-free annotation for %s", a.MatchKey)
		}
		for _, m := range a.Members {
			if !strings.Contains(m, "#") {
				t.Errorf("member %q is not a BattleTag (name#digits)", m)
			}
		}
		if len(a.Members) > 0 {
			members++
		}
		if a.Note != "" {
			notes++
		}
		for _, tg := range a.Tags {
			if !seedAnnotationTags[tg] {
				t.Errorf("unexpected tag %q", tg)
			}
		}
		if len(a.Tags) > 0 {
			tags++
		}
		if a.ReplayCode != "" {
			if len(a.ReplayCode) != 6 {
				t.Errorf("replay code %q is not 6 chars", a.ReplayCode)
			}
			replays++
		}
		if a.Leaver != "" {
			if !seedAnnotationLeavers[a.Leaver] {
				t.Errorf("invalid leaver %q (must be self/team/enemy)", a.Leaver)
			}
			leavers++
		}
	}

	// Every annotation kind should appear at least once in a 500-match corpus.
	for _, c := range []struct {
		kind string
		n    int
	}{
		{"member (BattleTag)", members},
		{"note", notes},
		{"tag", tags},
		{"replay-code", replays},
		{"leaver", leavers},
	} {
		if c.n == 0 {
			t.Errorf("no %s annotations seeded", c.kind)
		}
	}

	// Deterministic: same seed → same annotation set.
	again := fixtures.GenerateMatchFixtureWithChaos(500, 8, "flex", 0)
	if len(again.Annotations) != len(fx.Annotations) {
		t.Errorf("non-deterministic: got %d then %d annotations", len(fx.Annotations), len(again.Annotations))
	}
}
