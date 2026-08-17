package matchedit_test

import (
	"testing"

	"recall/pkg/match"
	"recall/pkg/matchedit"
)

// A manual match whose annotation fields all vanish under trimming used to be
// created AND report failure: hasManualAnnotation tested the raw input, so a
// blank tag passed the gate, and SetAnnotation then rejected the normalized
// result — after UpsertUserMatchData had already committed the row. The caller
// got a 500 with no match_key, while the match itself appeared on the next
// reload. Six schema-valid inputs reached it, and none of them is exotic: an
// empty tag chip and a whitespace-only note are what a UI sends when the user
// clears a field before saving.
//
// The contract these pin: a field that normalizes to nothing reads as OMITTED,
// which is the same rule the annotation surface already applies to an all-blank
// leaver list. The match is created, no annotation row is written, no error.
func TestCreateManual_AnnotationThatNormalizesEmptyReadsAsOmitted(t *testing.T) {
	blank := []struct {
		name string
		with func(*match.ManualMatchInput)
	}{
		{"a whitespace note", func(in *match.ManualMatchInput) { in.Note = "   " }},
		{"a whitespace replay code", func(in *match.ManualMatchInput) { in.ReplayCode = " \t " }},
		{"an empty tag", func(in *match.ManualMatchInput) { in.Tags = []string{""} }},
		{"a whitespace member", func(in *match.ManualMatchInput) { in.Members = []string{" "} }},
		{"an empty leaver", func(in *match.ManualMatchInput) { in.Leavers = []string{""} }},
		{"a whitespace thrower", func(in *match.ManualMatchInput) { in.Throwers = []string{"  "} }},
	}

	for _, c := range blank {
		t.Run(c.name, func(t *testing.T) {
			fake := seeded()
			in := manualInput("ilios", "victory")
			c.with(&in)

			key, err := matchedit.CreateManual(fake, in)
			if err != nil {
				t.Fatalf("CreateManual = %v, want nil — %s normalizes to nothing, "+
					"which is an omitted annotation, not a failed one", err, c.name)
			}
			if key == "" {
				t.Fatal("CreateManual returned an empty key")
			}
			if _, ok := fake.UserMatchData[key]; !ok {
				t.Fatalf("match %q was not created", key)
			}
			if _, ok := fake.Annotations[key]; ok {
				t.Errorf("an annotation row was written for %q; %s carries no content", key, c.name)
			}
		})
	}
}

// The other half of the same guarantee: when the annotation is genuinely
// invalid rather than merely blank, CreateManual must fail BEFORE it writes.
// A rejected create that still leaves a match behind is the worse bug — the
// client has no key, so it cannot undo what it did not know it made.
func TestCreateManual_InvalidAnnotationLeavesNoMatchBehind(t *testing.T) {
	fake := seeded()
	in := manualInput("ilios", "victory")
	in.Leavers = []string{"nobody"}

	key, err := matchedit.CreateManual(fake, in)
	if err == nil {
		t.Fatal("CreateManual = nil, want ErrInvalidLeaver")
	}
	if key != "" {
		t.Errorf("key = %q, want \"\" — a failed create must not mint one", key)
	}
	if len(fake.UserMatchData) != 0 {
		t.Errorf("UserMatchData has %d row(s); a create that fails validation must write none",
			len(fake.UserMatchData))
	}
}
