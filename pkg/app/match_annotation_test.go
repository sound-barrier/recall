package app_test

import (
	"errors"
	"slices"
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/match"
)

func TestAttachAnnotations_MergesIntoRecords(t *testing.T) {
	annos := map[string]db.Annotation{
		"k1": {MatchKey: "k1", Leavers: []string{"self"}, Note: "left at 2min"},
		"k3": {MatchKey: "k3", Leavers: []string{"enemy"}},
	}
	recs := []match.MatchRecord{
		{MatchKey: "k1"},
		{MatchKey: "k2"}, // no annotation
		{MatchKey: "k3"},
	}
	aggregate.AttachAnnotations(recs, annos)
	if recs[0].Annotation == nil || !slices.Equal(recs[0].Annotation.Leavers, []string{"self"}) {
		t.Errorf("k1 should have self annotation: %+v", recs[0].Annotation)
	}
	if recs[1].Annotation != nil {
		t.Errorf("k2 should have no annotation: %+v", recs[1].Annotation)
	}
	if recs[2].Annotation == nil || !slices.Equal(recs[2].Annotation.Leavers, []string{"enemy"}) {
		t.Errorf("k3 should have enemy annotation: %+v", recs[2].Annotation)
	}
}

func TestSetMatchAnnotation_AllFieldsRoundTrip(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	in := app.AnnotationInput{
		MatchKey:   "k1",
		Leavers:    []string{"team"},
		Note:       "long set",
		ReplayCode: "7H1K9P",
		Members:    []string{"Apollo#11234", "Cheese#5678"},
	}
	if err := a.SetMatchAnnotation(in); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	out := got["k1"]
	if !slices.Equal(out.Leavers, []string{"team"}) || out.Note != "long set" || out.ReplayCode != "7H1K9P" {
		t.Errorf("scalars wrong: %+v", out)
	}
	if len(out.Members) != 2 {
		t.Errorf("members count = %d, want 2 (%+v)", len(out.Members), out.Members)
	}
}

// An all-empty SetMatchAnnotation is rejected (upsert-only) rather than silently
// deleting — clearing is the explicit DeleteMatchAnnotation. The seeded row must
// survive the rejected call.
func TestSetMatchAnnotation_AllEmptyRejected(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	if err := a.SetMatchAnnotation(app.AnnotationInput{MatchKey: "k1", Leavers: []string{"team"}, Note: "x"}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := a.SetMatchAnnotation(app.AnnotationInput{MatchKey: "k1"}); !errors.Is(err, app.ErrEmptyAnnotation) {
		t.Fatalf("all-empty SetMatchAnnotation: got %v, want ErrEmptyAnnotation", err)
	}
	got, _ := fs.LoadAnnotations()
	if _, ok := got["k1"]; !ok {
		t.Errorf("seeded row must survive a rejected all-empty upsert; got %+v", got)
	}
}

func TestSetMatchAnnotation_TrimsAndDedupesMembers(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	in := app.AnnotationInput{
		MatchKey: "k1",
		Leavers:  []string{"team"},
		Members:  []string{"  Apollo#11234  ", "", "Cheese#5678", "Apollo#11234"},
	}
	if err := a.SetMatchAnnotation(in); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	out := got["k1"]
	if len(out.Members) != 2 {
		t.Errorf("expected 2 unique members after trim+dedupe, got %+v", out.Members)
	}
}

// Tags carry the same trim+dedupe contract as members but also
// case-fold (`Stack` and `stack` collapse to one). The annotation
// row should also persist when ONLY tags are set — tags alone are
// user content that shouldn't trigger the all-empty cleanup.
func TestSetMatchAnnotation_NormalizesTags(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	in := app.AnnotationInput{
		MatchKey: "k1",
		// Cases include the three conventional tags plus duplicates,
		// case variants, and whitespace-only entries that should drop.
		Tags: []string{"Stack", "stack", "  STREAM  ", "placement", "", " ", "Placement"},
	}
	if err := a.SetMatchAnnotation(in); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	out := got["k1"]
	if len(out.Tags) != 3 {
		t.Errorf("expected 3 unique normalized tags, got %+v", out.Tags)
	}
	want := map[string]bool{"stack": true, "stream": true, "placement": true}
	for _, tag := range out.Tags {
		if !want[tag] {
			t.Errorf("unexpected tag %q in %+v (want one of %v)", tag, out.Tags, want)
		}
	}
}

// Tags-only annotation should persist — the all-empty cleanup must
// treat tags the same as members/note/replay (content that gates
// the delete).
func TestSetMatchAnnotation_TagsOnlyKeepsRow(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	if err := a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: "k",
		Tags:     []string{"stack"},
	}); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	if len(got["k"].Tags) != 1 || got["k"].Tags[0] != "stack" {
		t.Errorf("tags-only row dropped or mangled: %+v", got["k"])
	}
}

// DeleteMatchAnnotation removes the row entirely and is idempotent — the verb
// that replaced the old all-empty-PUT-deletes overload.
func TestDeleteMatchAnnotation(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	if err := a.SetMatchAnnotation(app.AnnotationInput{MatchKey: "k", Tags: []string{"stack"}}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := a.DeleteMatchAnnotation("k"); err != nil {
		t.Fatalf("DeleteMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	if _, present := got["k"]; present {
		t.Errorf("row should be deleted; got %+v", got["k"])
	}
	// Idempotent — deleting an absent annotation is a no-op.
	if err := a.DeleteMatchAnnotation("k"); err != nil {
		t.Errorf("second delete should be a no-op, got %v", err)
	}
}

func TestSetMatchAnnotation_RejectsInvalidLeaver(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	err := a.SetMatchAnnotation(app.AnnotationInput{MatchKey: "k1", Leavers: []string{"afk"}})
	if err == nil || err.Error() != app.ErrInvalidLeaver.Error() {
		t.Errorf("expected ErrInvalidLeaver, got %v", err)
	}
}

func TestSetMatchAnnotation_NoteOnlyKeepsRow(t *testing.T) {
	// Annotation row should persist with just a note and no leaver tag,
	// which the schema relaxation enables.
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	if err := a.SetMatchAnnotation(app.AnnotationInput{MatchKey: "k", Note: "no leaver tag yet"}); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	if got["k"].Note != "no leaver tag yet" {
		t.Errorf("note dropped: %+v", got["k"])
	}
}

// Clearing the leaver sides via SetMatchAnnotation (empty Leavers, other
// fields preserved) is the canonical path now that the legacy
// ClearLeaverAnnotation shim is gone.
func TestSetMatchAnnotation_EmptyLeaverPreservesOtherFields(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	_ = a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: "k", Leavers: []string{"team"}, Note: "important",
		ReplayCode: "ABC", Members: []string{"Apollo#1"},
	})
	if err := a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: "k", Leavers: nil, Note: "important",
		ReplayCode: "ABC", Members: []string{"Apollo#1"},
	}); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	out := got["k"]
	if len(out.Leavers) != 0 {
		t.Errorf("leaver sides should be cleared, got %v", out.Leavers)
	}
	if out.Note != "important" || out.ReplayCode != "ABC" || len(out.Members) != 1 {
		t.Errorf("other fields lost: %+v", out)
	}
}
