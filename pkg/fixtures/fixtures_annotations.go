package fixtures

import (
	"math/rand"

	"recall/pkg/db"
)

// Annotation seed pools — the realistic markup a competitive OW player leaves on
// memorable matches. Friends are stored verbatim as BattleTags (case-preserving,
// `name#digits`); notes/tags read like real shorthand.
var (
	annotationFriends = []string{
		"Apollo#11947", "Vega#21533", "Nyx#2841", "Orion#1199", "Lyra#3360",
		"Atlas#21847", "Juno#1024", "Sable#4471", "Rook#2289", "Echo#3815",
		"Wren#1672", "Cipher#9043", "Pixel#2207", "Quill#5589",
	}
	annotationNotes = []string{
		"ally left after first point",
		"great dive comp, kept pressure all game",
		"enemy smurf on Genji — hard diff",
		"server lag the whole match",
		"clutch defense on the last point",
		"tilted, should've taken a break",
		"good shotcalling from the team",
		"thrower on our team, reported",
		"comeback from 0-2, never gave up",
		"new map, still learning the angles",
		"counter-swapped to Sombra and it worked",
		"close game, came down to the last fight",
	}
	annotationCustomTags = []string{"tilt", "smurf", "comeback", "thrower", "gg", "vod-review"}
	// Leaver scenarios, weighted toward team/enemy leavers (a self-leave is the
	// rarest); every value is one of validLeavers in the app layer.
	annotationLeavers = []string{"team", "team", "enemy", "enemy", "self"}
)

// appendAnnotationSeeds populates per-match annotations (members / note / tags /
// replay code / leaver) on a realistic minority of matches — the way a player
// marks up memorable games. Uses a derived RNG (seed+3) so changing the
// annotation mix doesn't shift the main corpus or the review seeds (seed+2).
func (fx *Fixture) appendAnnotationSeeds(seed int64) {
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	rng := rand.New(rand.NewSource(seed + 3))
	for _, s := range fx.Summaries {
		if ann := rollAnnotation(rng, s.MatchKey); annotationHasContent(ann) {
			fx.Annotations = append(fx.Annotations, ann)
		}
	}
}

// rollAnnotation rolls each annotation field independently at a realistic rate.
// Stacked games (~20%) carry both the friends' BattleTags and the conventional
// `stack` tag; the rest are sprinkled so the demo exercises every markup kind.
func rollAnnotation(rng *rand.Rand, matchKey string) db.Annotation {
	ann := db.Annotation{MatchKey: matchKey}
	if rng.Float64() < 0.20 {
		ann.Members = pickFriends(rng)
		ann.Tags = append(ann.Tags, "stack")
	}
	if rng.Float64() < 0.05 {
		ann.Tags = append(ann.Tags, "stream")
	}
	if rng.Float64() < 0.03 {
		ann.Tags = append(ann.Tags, "placement")
	}
	if rng.Float64() < 0.05 {
		ann.Tags = append(ann.Tags, annotationCustomTags[rng.Intn(len(annotationCustomTags))])
	}
	if rng.Float64() < 0.08 {
		ann.Note = annotationNotes[rng.Intn(len(annotationNotes))]
	}
	if rng.Float64() < 0.04 {
		ann.ReplayCode = replayCode(rng)
	}
	if rng.Float64() < 0.04 {
		ann.Leaver = annotationLeavers[rng.Intn(len(annotationLeavers))]
	}
	return ann
}

// pickFriends draws 1–4 distinct BattleTags from the friend pool.
func pickFriends(rng *rand.Rand) []string {
	k := 1 + rng.Intn(4)
	perm := rng.Perm(len(annotationFriends))
	out := make([]string, 0, k)
	for i := 0; i < k && i < len(perm); i++ {
		out = append(out, annotationFriends[perm[i]])
	}
	return out
}

// replayCode mints a 6-character Overwatch-style replay code (A–Z, 0–9).
func replayCode(rng *rand.Rand) string {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = charset[rng.Intn(len(charset))]
	}
	return string(b)
}

// annotationHasContent reports whether any field was actually set — an all-empty
// roll is skipped rather than written as a content-free row (mirrors the app
// layer's ErrEmptyAnnotation guard).
func annotationHasContent(a db.Annotation) bool {
	return a.Leaver != "" || a.Note != "" || a.ReplayCode != "" ||
		len(a.Members) > 0 || len(a.Tags) > 0
}
