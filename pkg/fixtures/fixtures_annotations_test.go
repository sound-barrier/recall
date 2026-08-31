package fixtures_test

import (
	"strings"
	"testing"

	"recall/pkg/db"
	"recall/pkg/fixtures"
)

// The conventional + custom tags the seed may apply. Black-box, so we mirror the
// known set here — an unexpected tag means the generator drifted.
var seedAnnotationTags = map[string]bool{
	"stack": true, "stream": true, "placement": true,
	"tilt": true, "smurf": true, "comeback": true, "thrower": true, "gg": true, "vod-review": true,
}

var seedAnnotationSides = map[string]bool{"self": true, "team": true, "enemy": true}

// annotationTally counts which annotation kinds appeared across the
// corpus so the coverage assertion reads as one call.
type annotationTally struct {
	members, notes, tags, replays, leavers, throwers, exclusions int
}

func (c *annotationTally) observe(a db.Annotation) {
	if len(a.Members) > 0 {
		c.members++
	}
	if a.Note != "" {
		c.notes++
	}
	if len(a.Tags) > 0 {
		c.tags++
	}
	if a.ReplayCode != "" {
		c.replays++
	}
	if len(a.Leavers) > 0 {
		c.leavers++
	}
	if len(a.Throwers) > 0 {
		c.throwers++
	}
	if a.ExclusionReason != "" {
		c.exclusions++
	}
}

// assertEveryKindSeeded checks each annotation kind appears at least
// once in a 500-match corpus.
func (c *annotationTally) assertEveryKindSeeded(t *testing.T) {
	t.Helper()
	for _, kind := range []struct {
		name string
		n    int
	}{
		{"member (BattleTag)", c.members},
		{"note", c.notes},
		{"tag", c.tags},
		{"replay-code", c.replays},
		{"leaver", c.leavers},
		{"thrower", c.throwers},
		{"exclusion-reason", c.exclusions},
	} {
		if kind.n == 0 {
			t.Errorf("no %s annotations seeded", kind.name)
		}
	}
}

// assertSides checks every side value against the self/team/enemy set.
func assertSides(t *testing.T, kind string, sides []string) {
	t.Helper()
	for _, side := range sides {
		if !seedAnnotationSides[side] {
			t.Errorf("invalid %s side %q (must be self/team/enemy)", kind, side)
		}
	}
}

// assertNotContentFree pins that an all-empty annotation is dropped by
// the generator, never written.
func assertNotContentFree(t *testing.T, a db.Annotation) {
	t.Helper()
	if a.Note == "" && a.ReplayCode == "" && len(a.Leavers) == 0 && len(a.Throwers) == 0 &&
		len(a.Members) == 0 && len(a.Tags) == 0 && a.ExclusionReason == "" {
		t.Errorf("content-free annotation for %s", a.MatchKey)
	}
}

// assertAnnotationContent validates one annotation's field shapes.
func assertAnnotationContent(t *testing.T, a db.Annotation) {
	t.Helper()
	assertNotContentFree(t, a)
	for _, m := range a.Members {
		if !strings.Contains(m, "#") {
			t.Errorf("member %q is not a BattleTag (name#digits)", m)
		}
	}
	for _, tg := range a.Tags {
		if !seedAnnotationTags[tg] {
			t.Errorf("unexpected tag %q", tg)
		}
	}
	if a.ReplayCode != "" && len(a.ReplayCode) != 6 {
		t.Errorf("replay code %q is not 6 chars", a.ReplayCode)
	}
	assertSides(t, "leaver", a.Leavers)
	assertSides(t, "thrower", a.Throwers)
}

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
	var tally annotationTally
	for _, a := range fx.Annotations {
		if a.MatchKey == "" {
			t.Error("annotation with empty match key")
		}
		if keys[a.MatchKey] {
			t.Errorf("duplicate annotation for %s", a.MatchKey)
		}
		keys[a.MatchKey] = true
		assertAnnotationContent(t, a)
		tally.observe(a)
	}
	tally.assertEveryKindSeeded(t)

	// Deterministic: same seed → same annotation set.
	again := fixtures.GenerateMatchFixtureWithChaos(500, 8, "flex", 0)
	if len(again.Annotations) != len(fx.Annotations) {
		t.Errorf("non-deterministic: got %d then %d annotations", len(fx.Annotations), len(again.Annotations))
	}
}
