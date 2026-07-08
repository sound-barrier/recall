package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

func TestSeasons_EmbeddedLoadsWithExpectedWindows(t *testing.T) {
	seasons := parser.Seasons()
	if len(seasons) != 3 {
		t.Fatalf("want 3 embedded seasons, got %d", len(seasons))
	}
	s2 := seasons[1]
	if s2.Name != "Reign of Talon — Season 2" || s2.Chapter != "Reign of Talon" || s2.Number != 2 {
		t.Errorf("season 2 = %+v", s2)
	}
	if got := s2.Start.UTC().Format("2006-01-02T15:04:05Z"); got != "2026-04-14T19:00:00Z" {
		t.Errorf("season 2 start = %s", got)
	}
	if got := s2.End.UTC().Format("2006-01-02T15:04:05Z"); got != "2026-06-16T19:00:00Z" {
		t.Errorf("season 2 end = %s", got)
	}
	// Back-to-back: each season's end equals the next season's start.
	if !seasons[0].End.Equal(seasons[1].Start) || !seasons[1].End.Equal(seasons[2].Start) {
		t.Error("seasons should be back-to-back (end == next start)")
	}
}

func TestValidateDataYAML_Seasons(t *testing.T) {
	valid := []byte(`seasons:
  - name: "Test — Season 1"
    chapter: "Test"
    number: 1
    start: "2026-01-01T00:00:00Z"
    end: "2026-03-01T00:00:00Z"
`)
	if err := parser.ValidateDataYAML("seasons.yaml", valid); err != nil {
		t.Errorf("valid seasons.yaml rejected: %v", err)
	}

	for name, body := range map[string]string{
		"bad RFC3339": `seasons:
  - name: "X"
    start: "nope"
    end: "2026-03-01T00:00:00Z"`,
		"start not before end": `seasons:
  - name: "X"
    start: "2026-03-01T00:00:00Z"
    end: "2026-01-01T00:00:00Z"`,
		"empty name": `seasons:
  - name: ""
    start: "2026-01-01T00:00:00Z"
    end: "2026-03-01T00:00:00Z"`,
		"no seasons": `seasons: []`,
	} {
		if err := parser.ValidateDataYAML("seasons.yaml", []byte(body)); err == nil {
			t.Errorf("%s: expected validation error, got nil", name)
		}
	}
}
