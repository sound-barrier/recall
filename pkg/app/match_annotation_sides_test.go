package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
)

// Leaver and thrower are independent multi-side sets: a match can carry a
// disruption on both teams, and a thrower-only annotation is real content that
// must not trip the all-empty guard.

func TestSetMatchAnnotation_ThrowersOnlyIsStorable(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	if err := a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: "k1", Throwers: []string{"enemy"},
	}); err != nil {
		t.Fatalf("throwers-only annotation should be storable, got: %v", err)
	}
	got, _ := fake.LoadAnnotations()
	if len(got["k1"].Throwers) != 1 || got["k1"].Throwers[0] != "enemy" {
		t.Errorf("throwers = %v, want [enemy]", got["k1"].Throwers)
	}
}

func TestSetMatchAnnotation_MultipleSidesPerKind(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	if err := a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: "k1",
		Leavers:  []string{"team", "self"},
		Throwers: []string{"team", "enemy"},
	}); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, _ := fake.LoadAnnotations()
	if len(got["k1"].Leavers) != 2 {
		t.Errorf("leavers = %v, want both sides", got["k1"].Leavers)
	}
	if len(got["k1"].Throwers) != 2 {
		t.Errorf("throwers = %v, want both sides", got["k1"].Throwers)
	}
}

func TestSetMatchAnnotation_RejectsInvalidSides(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	if err := a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: "k1", Throwers: []string{"griefer"},
	}); !errors.Is(err, app.ErrInvalidThrower) {
		t.Errorf("err = %v, want ErrInvalidThrower", err)
	}
	if err := a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: "k1", Leavers: []string{"team", "afk"},
	}); !errors.Is(err, app.ErrInvalidLeaver) {
		t.Errorf("err = %v, want ErrInvalidLeaver — every element is validated", err)
	}
}

func TestSetMatchAnnotation_EmptySideSlicesStillRejected(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	// Empty slices carry no content, so the all-empty guard still fires —
	// clearing an annotation is DeleteMatchAnnotation.
	if err := a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: "k1", Leavers: []string{}, Throwers: []string{},
	}); !errors.Is(err, app.ErrEmptyAnnotation) {
		t.Errorf("err = %v, want ErrEmptyAnnotation", err)
	}
}

// The sides must survive the read path. GetMatchByKey exercises the aggregator's
// annotation attach, which has two call sites that both have to carry them.
func TestGetMatchByKey_CarriesBothSideSets(t *testing.T) {
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	rec, err := a.CreateManualMatch(manualQuickInput("ilios", "defeat", []string{"team", "self"}))
	if err != nil {
		t.Fatalf("CreateManualMatch: %v", err)
	}
	if err := a.SetMatchAnnotation(app.AnnotationInput{
		MatchKey: rec.MatchKey,
		Leavers:  []string{"team", "self"},
		Throwers: []string{"enemy"},
	}); err != nil {
		t.Fatalf("SetMatchAnnotation: %v", err)
	}
	got, err := a.GetMatchByKey(rec.MatchKey)
	if err != nil {
		t.Fatalf("GetMatchByKey: %v", err)
	}
	if got.Annotation == nil {
		t.Fatal("annotation missing from the aggregated record")
	}
	if len(got.Annotation.Leavers) != 2 {
		t.Errorf("leavers = %v, want 2 sides", got.Annotation.Leavers)
	}
	if len(got.Annotation.Throwers) != 1 || got.Annotation.Throwers[0] != "enemy" {
		t.Errorf("throwers = %v, want [enemy]", got.Annotation.Throwers)
	}
}
