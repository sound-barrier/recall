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
