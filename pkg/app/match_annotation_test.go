package app

import (
	"errors"
	"testing"

	"recall/pkg/db"
)

func TestSetLeaverAnnotation_ValidatesEnum(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.SetLeaverAnnotation("k1", "afk", ""); !errors.Is(err, ErrInvalidLeaver) {
		t.Errorf("expected ErrInvalidLeaver for invalid leaver value, got %v", err)
	}
}

func TestSetLeaverAnnotation_RejectsEmptyMatchKey(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.SetLeaverAnnotation("", "team", ""); err == nil {
		t.Error("expected error for empty match_key")
	}
}

func TestSetLeaverAnnotation_PersistsThroughStore(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.SetLeaverAnnotation("k1", "team", "ally dc"); err != nil {
		t.Fatalf("SetLeaverAnnotation: %v", err)
	}
	got, err := fs.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations: %v", err)
	}
	if got["k1"].Leaver != "team" || got["k1"].Note != "ally dc" {
		t.Errorf("expected (team, ally dc), got %+v", got["k1"])
	}
}

func TestClearLeaverAnnotation_DeletesFromStore(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	_ = a.SetLeaverAnnotation("k1", "self", "")
	if err := a.ClearLeaverAnnotation("k1"); err != nil {
		t.Fatalf("ClearLeaverAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	if _, ok := got["k1"]; ok {
		t.Errorf("annotation still present after clear: %+v", got)
	}
}

func TestAttachAnnotations_MergesIntoRecords(t *testing.T) {
	annos := map[string]db.Annotation{
		"k1": {MatchKey: "k1", Leaver: "self", Note: "left at 2min"},
		"k3": {MatchKey: "k3", Leaver: "enemy"},
	}
	recs := []MatchRecord{
		{MatchKey: "k1"},
		{MatchKey: "k2"}, // no annotation
		{MatchKey: "k3"},
	}
	attachAnnotations(recs, annos)
	if recs[0].Annotation == nil || recs[0].Annotation.Leaver != "self" {
		t.Errorf("k1 should have self annotation: %+v", recs[0].Annotation)
	}
	if recs[1].Annotation != nil {
		t.Errorf("k2 should have no annotation: %+v", recs[1].Annotation)
	}
	if recs[2].Annotation == nil || recs[2].Annotation.Leaver != "enemy" {
		t.Errorf("k3 should have enemy annotation: %+v", recs[2].Annotation)
	}
}

func TestSetMatchAnnotation_AllFieldsRoundTrip(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	in := AnnotationInput{
		MatchKey:   "k1",
		Leaver:     "team",
		Note:       "long set",
		ReplayCode: "7H1K9P",
		Members:    []string{"Apollo#11234", "Cheese#5678"},
	}
	if err := a.SetMatchAnnotation(in); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	out := got["k1"]
	if out.Leaver != "team" || out.Note != "long set" || out.ReplayCode != "7H1K9P" {
		t.Errorf("scalars wrong: %+v", out)
	}
	if len(out.Members) != 2 {
		t.Errorf("members count = %d, want 2 (%+v)", len(out.Members), out.Members)
	}
}

func TestSetMatchAnnotation_AllEmptyDeletes(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	// First seed a row.
	_ = a.SetMatchAnnotation(AnnotationInput{MatchKey: "k1", Leaver: "team", Note: "x"})
	// Then call again with everything empty.
	if err := a.SetMatchAnnotation(AnnotationInput{MatchKey: "k1"}); err != nil {
		t.Fatalf("SetMatchAnnotation (empty): %v", err)
	}
	got, _ := fs.LoadAnnotations()
	if _, ok := got["k1"]; ok {
		t.Errorf("row should be deleted on all-empty input; got %+v", got["k1"])
	}
}

func TestSetMatchAnnotation_TrimsAndDedupesMembers(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	in := AnnotationInput{
		MatchKey: "k1",
		Leaver:   "team",
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
	a := NewWithStore(fs)
	in := AnnotationInput{
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
	a := NewWithStore(fs)
	if err := a.SetMatchAnnotation(AnnotationInput{
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

// And tags-cleared (alongside every other field empty) should
// delete the row, matching the existing all-empty contract.
func TestSetMatchAnnotation_AllEmptyDeletesIncludingTags(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	// Seed first.
	_ = a.SetMatchAnnotation(AnnotationInput{MatchKey: "k", Tags: []string{"stack"}})
	// Now clear everything.
	if err := a.SetMatchAnnotation(AnnotationInput{MatchKey: "k"}); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	if _, present := got["k"]; present {
		t.Errorf("row should be deleted when every field (incl. tags) is empty; got %+v", got["k"])
	}
}

func TestSetMatchAnnotation_RejectsInvalidLeaver(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	err := a.SetMatchAnnotation(AnnotationInput{MatchKey: "k1", Leaver: "afk"})
	if err == nil || err.Error() != ErrInvalidLeaver.Error() {
		t.Errorf("expected ErrInvalidLeaver, got %v", err)
	}
}

func TestSetMatchAnnotation_NoteOnlyKeepsRow(t *testing.T) {
	// Annotation row should persist with just a note and no leaver tag,
	// which the schema relaxation enables.
	fs := &fakeStore{}
	a := NewWithStore(fs)
	if err := a.SetMatchAnnotation(AnnotationInput{MatchKey: "k", Note: "no leaver tag yet"}); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	if got["k"].Note != "no leaver tag yet" {
		t.Errorf("note dropped: %+v", got["k"])
	}
}

func TestClearLeaverAnnotation_PreservesNoteAndMembers(t *testing.T) {
	fs := &fakeStore{}
	a := NewWithStore(fs)
	_ = a.SetMatchAnnotation(AnnotationInput{
		MatchKey: "k", Leaver: "team", Note: "important",
		ReplayCode: "ABC", Members: []string{"Apollo#1"},
	})
	if err := a.ClearLeaverAnnotation("k"); err != nil {
		t.Fatalf("ClearLeaverAnnotation: %v", err)
	}
	got, _ := fs.LoadAnnotations()
	out := got["k"]
	if out.Leaver != "" {
		t.Errorf("leaver should be cleared, got %q", out.Leaver)
	}
	if out.Note != "important" || out.ReplayCode != "ABC" || len(out.Members) != 1 {
		t.Errorf("other fields lost: %+v", out)
	}
}
