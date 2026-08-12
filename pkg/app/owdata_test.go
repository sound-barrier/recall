package app_test

import (
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
	"recall/pkg/parser"
)

// GetOWData surfaces the embedded competitive seasons with UTC RFC3339
// boundaries, alongside heroes/maps/sources.
func TestGetOWData_IncludesSeasons(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
	ow := a.GetOWData()
	// Derived, not a literal: pkg/parser owns the count (seasons_test.go), and
	// duplicating it here only meant every new season failed two packages. What
	// this test is actually for is the WIRE shape — RFC3339 strings, not
	// time.Time — so assert the wiring, not the number.
	if want := len(parser.Seasons()); len(ow.Seasons) != want {
		t.Fatalf("want %d seasons, got %d", want, len(ow.Seasons))
	}
	s2 := ow.Seasons[1]
	if s2.Name != "Reign of Talon — Season 2" || s2.Chapter != "Reign of Talon" || s2.Number != 2 {
		t.Errorf("season 2 = %+v", s2)
	}
	if s2.Start != "2026-04-14T19:00:00Z" || s2.End != "2026-06-16T19:00:00Z" {
		t.Errorf("season 2 window = %s → %s", s2.Start, s2.End)
	}
}
