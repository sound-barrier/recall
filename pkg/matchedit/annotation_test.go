package matchedit_test

import (
	"errors"
	"slices"
	"testing"

	"recall/pkg/db"
	"recall/pkg/matchedit"
)

func TestSetAnnotation_AllFieldsRoundTrip(t *testing.T) {
	fake := seeded("k1")
	in := matchedit.AnnotationInput{
		MatchKey:   "k1",
		Leavers:    []string{"team"},
		Note:       "long set",
		ReplayCode: "7H1K9P",
		Members:    []string{"Apollo#11234", "Cheese#5678"},
	}
	mustNoErr(t, matchedit.SetAnnotation(fake, in))
	got, _ := fake.LoadAnnotations()
	out := got["k1"]
	if !slices.Equal(out.Leavers, []string{"team"}) || out.Note != "long set" || out.ReplayCode != "7H1K9P" {
		t.Errorf("scalars wrong: %+v", out)
	}
	if len(out.Members) != 2 {
		t.Errorf("members count = %d, want 2 (%+v)", len(out.Members), out.Members)
	}
}

// An all-empty SetAnnotation is rejected (upsert-only) rather than silently
// deleting — clearing is the explicit DeleteAnnotation. The seeded row must
// survive the rejected call.
func TestSetAnnotation_AllEmptyRejected(t *testing.T) {
	fake := seeded("k1")
	mustNoErr(t, matchedit.SetAnnotation(fake, matchedit.AnnotationInput{
		MatchKey: "k1", Leavers: []string{"team"}, Note: "x",
	}))
	if err := matchedit.SetAnnotation(fake, matchedit.AnnotationInput{MatchKey: "k1"}); !errors.Is(err, matchedit.ErrEmptyAnnotation) {
		t.Fatalf("all-empty SetAnnotation: got %v, want ErrEmptyAnnotation", err)
	}
	got, _ := fake.LoadAnnotations()
	if _, ok := got["k1"]; !ok {
		t.Errorf("seeded row must survive a rejected all-empty upsert; got %+v", got)
	}
}

// Every one of the six content fields on its own is enough to keep the row.
// The all-empty guard is a single boolean over all of them, so a field
// dropped from that expression would silently start refusing legitimate
// single-field annotations — the tags-only and note-only cases have both
// been shipped as their own regression before.
func TestSetAnnotation_AnySingleFieldIsContent(t *testing.T) {
	cases := []struct {
		field string
		in    matchedit.AnnotationInput
		want  func(db.Annotation) bool
	}{
		{"leavers", matchedit.AnnotationInput{Leavers: []string{"team"}},
			func(a db.Annotation) bool { return len(a.Leavers) == 1 }},
		{"throwers", matchedit.AnnotationInput{Throwers: []string{"enemy"}},
			func(a db.Annotation) bool { return len(a.Throwers) == 1 }},
		{"note", matchedit.AnnotationInput{Note: "no leaver tag yet"},
			func(a db.Annotation) bool { return a.Note == "no leaver tag yet" }},
		{"replay code", matchedit.AnnotationInput{ReplayCode: "7H1K9P"},
			func(a db.Annotation) bool { return a.ReplayCode == "7H1K9P" }},
		{"members", matchedit.AnnotationInput{Members: []string{"Apollo#11234"}},
			func(a db.Annotation) bool { return len(a.Members) == 1 }},
		{"tags", matchedit.AnnotationInput{Tags: []string{"stack"}},
			func(a db.Annotation) bool { return len(a.Tags) == 1 }},
	}
	for _, c := range cases {
		t.Run(c.field, func(t *testing.T) {
			fake := seeded("k")
			in := c.in
			in.MatchKey = "k"
			if err := matchedit.SetAnnotation(fake, in); err != nil {
				t.Fatalf("%s-only annotation refused: %v", c.field, err)
			}
			got, _ := fake.LoadAnnotations()
			if !c.want(got["k"]) {
				t.Errorf("%s-only row dropped or mangled: %+v", c.field, got["k"])
			}
		})
	}
}

// Whitespace is not content: a field carrying only spaces trims to empty and
// the row is still refused, so a stray keystroke can't create an annotation
// the "has a note" filters would then count.
func TestSetAnnotation_WhitespaceOnlyIsNotContent(t *testing.T) {
	fake := seeded("k")
	err := matchedit.SetAnnotation(fake, matchedit.AnnotationInput{
		MatchKey: "k", Note: "   ", ReplayCode: " ", Members: []string{" ", ""}, Tags: []string{"  "},
	})
	if !errors.Is(err, matchedit.ErrEmptyAnnotation) {
		t.Errorf("whitespace-only annotation = %v, want ErrEmptyAnnotation", err)
	}
}

// The case rules are deliberately ASYMMETRIC and have to stay that way:
// tags are user-facing labels with no significant case, so `Stack` and
// `stack` are one tag; members are Battle.net handles, where case is part
// of the identity, so `Apollo#11234` and `apollo#11234` are two people.
// Both halves are documented in comments; this is the assertion that holds
// them together, because "make normalization consistent" is exactly the
// tidy-up that would silently merge two players into one.
func TestSetAnnotation_TagsFoldCaseButMembersDoNot(t *testing.T) {
	fake := seeded("k")
	mustNoErr(t, matchedit.SetAnnotation(fake, matchedit.AnnotationInput{
		MatchKey: "k",
		Tags:     []string{"Stack", "stack", "  STREAM  ", "placement", "", " ", "Placement"},
		Members:  []string{"Apollo#11234", "apollo#11234", "  Cheese#5678  ", "Cheese#5678"},
	}))
	got, _ := fake.LoadAnnotations()
	out := got["k"]

	wantTags := []string{"stack", "stream", "placement"}
	if len(out.Tags) != len(wantTags) {
		t.Errorf("tags = %v, want %v — case variants collapse to one tag", out.Tags, wantTags)
	}
	for _, tag := range wantTags {
		if !slices.Contains(out.Tags, tag) {
			t.Errorf("tags = %v, missing %q", out.Tags, tag)
		}
	}

	wantMembers := []string{"Apollo#11234", "apollo#11234", "Cheese#5678"}
	if !slices.Equal(out.Members, wantMembers) {
		t.Errorf("members = %v, want %v — case is identity, only exact duplicates collapse", out.Members, wantMembers)
	}
}

// DeleteAnnotation removes the row entirely and is idempotent — the verb
// that replaced the old all-empty-PUT-deletes overload.
func TestDeleteAnnotation(t *testing.T) {
	fake := seeded("k")
	mustNoErr(t, matchedit.SetAnnotation(fake, matchedit.AnnotationInput{MatchKey: "k", Tags: []string{"stack"}}))
	mustNoErr(t, matchedit.DeleteAnnotation(fake, "k"))
	got, _ := fake.LoadAnnotations()
	if _, present := got["k"]; present {
		t.Errorf("row should be deleted; got %+v", got["k"])
	}
	// Idempotent — deleting an absent annotation is a no-op.
	mustNoErr(t, matchedit.DeleteAnnotation(fake, "k"))
}

func TestSetAnnotation_MultipleSidesPerKind(t *testing.T) {
	fake := seeded("k1")
	mustNoErr(t, matchedit.SetAnnotation(fake, matchedit.AnnotationInput{
		MatchKey: "k1",
		Leavers:  []string{"team", "self"},
		Throwers: []string{"team", "enemy"},
	}))
	got, _ := fake.LoadAnnotations()
	if len(got["k1"].Leavers) != 2 {
		t.Errorf("leavers = %v, want both sides", got["k1"].Leavers)
	}
	if len(got["k1"].Throwers) != 2 {
		t.Errorf("throwers = %v, want both sides", got["k1"].Throwers)
	}
}

func TestSetAnnotation_RejectsInvalidSides(t *testing.T) {
	fake := seeded("k1")
	if err := matchedit.SetAnnotation(fake, matchedit.AnnotationInput{
		MatchKey: "k1", Throwers: []string{"griefer"},
	}); !errors.Is(err, matchedit.ErrInvalidThrower) {
		t.Errorf("err = %v, want ErrInvalidThrower", err)
	}
	if err := matchedit.SetAnnotation(fake, matchedit.AnnotationInput{
		MatchKey: "k1", Leavers: []string{"team", "afk"},
	}); !errors.Is(err, matchedit.ErrInvalidLeaver) {
		t.Errorf("err = %v, want ErrInvalidLeaver — every element is validated", err)
	}
}

func TestSetAnnotation_EmptySideSlicesStillRejected(t *testing.T) {
	fake := seeded("k1")
	// Empty slices carry no content, so the all-empty guard still fires —
	// clearing an annotation is DeleteAnnotation.
	if err := matchedit.SetAnnotation(fake, matchedit.AnnotationInput{
		MatchKey: "k1", Leavers: []string{}, Throwers: []string{},
	}); !errors.Is(err, matchedit.ErrEmptyAnnotation) {
		t.Errorf("err = %v, want ErrEmptyAnnotation", err)
	}
}

// Clearing the leaver sides via SetAnnotation (empty Leavers, other fields
// preserved) is the canonical path now that the legacy ClearLeaverAnnotation
// shim is gone.
func TestSetAnnotation_EmptyLeaverPreservesOtherFields(t *testing.T) {
	fake := seeded("k")
	mustNoErr(t, matchedit.SetAnnotation(fake, matchedit.AnnotationInput{
		MatchKey: "k", Leavers: []string{"team"}, Note: "important",
		ReplayCode: "ABC", Members: []string{"Apollo#1"},
	}))
	mustNoErr(t, matchedit.SetAnnotation(fake, matchedit.AnnotationInput{
		MatchKey: "k", Leavers: nil, Note: "important",
		ReplayCode: "ABC", Members: []string{"Apollo#1"},
	}))
	got, _ := fake.LoadAnnotations()
	out := got["k"]
	if len(out.Leavers) != 0 {
		t.Errorf("leaver sides should be cleared, got %v", out.Leavers)
	}
	if out.Note != "important" || out.ReplayCode != "ABC" || len(out.Members) != 1 {
		t.Errorf("other fields lost: %+v", out)
	}
}

// ValidateDisruptionSides is the manual-match form's pre-flight: it reports
// the same sentinels SetAnnotation would, without writing anything.
func TestValidateDisruptionSides(t *testing.T) {
	mustNoErr(t, matchedit.ValidateDisruptionSides([]string{"team", "self"}, []string{"enemy"}))
	if err := matchedit.ValidateDisruptionSides([]string{"afk"}, nil); !errors.Is(err, matchedit.ErrInvalidLeaver) {
		t.Errorf("bad leaver = %v, want ErrInvalidLeaver", err)
	}
	if err := matchedit.ValidateDisruptionSides(nil, []string{"griefer"}); !errors.Is(err, matchedit.ErrInvalidThrower) {
		t.Errorf("bad thrower = %v, want ErrInvalidThrower", err)
	}
}

func TestAnnotationWrites_RequireAMatchKey(t *testing.T) {
	fake := seeded("k")
	if err := matchedit.SetAnnotation(fake, matchedit.AnnotationInput{Note: "n"}); err == nil {
		t.Error("SetAnnotation with no match_key succeeded")
	}
	if err := matchedit.DeleteAnnotation(fake, ""); err == nil {
		t.Error("DeleteAnnotation with no match_key succeeded")
	}
}
