package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

const rfc3339Z = "2006-01-02T15:04:05Z"

// The embedded windows, pinned. Table-driven so a new season is one row rather
// than another branch — the single-func spelling this replaced hit the
// complexity gate the moment Season 4 was added.
func TestSeasons_EmbeddedWindows(t *testing.T) {
	seasons := parser.Seasons()
	if len(seasons) != 4 {
		t.Fatalf("want 4 embedded seasons, got %d", len(seasons))
	}
	for _, c := range []struct {
		idx                int
		name, chapter      string
		number             int
		wantStart, wantEnd string
	}{
		{1, "Reign of Talon — Season 2", "Reign of Talon", 2, "2026-04-14T19:00:00Z", "2026-06-16T19:00:00Z"},
		{3, "Reign of Talon — Season 4", "Reign of Talon", 4, "2026-08-11T19:00:00Z", "2026-10-13T19:00:00Z"},
	} {
		t.Run(c.name, func(t *testing.T) {
			s := seasons[c.idx]
			if s.Name != c.name || s.Chapter != c.chapter || s.Number != c.number {
				t.Errorf("season = %+v", s)
			}
			if got := s.Start.UTC().Format(rfc3339Z); got != c.wantStart {
				t.Errorf("start = %s, want %s", got, c.wantStart)
			}
			if got := s.End.UTC().Format(rfc3339Z); got != c.wantEnd {
				t.Errorf("end = %s, want %s", got, c.wantEnd)
			}
		})
	}
}

// Back-to-back: each season's end equals the next season's start. A loop, not a
// hand-listed pair chain — the old spelling named seasons[0..2] explicitly, so
// appending a season left the NEWEST boundary unchecked while still passing.
func TestSeasons_AreBackToBack(t *testing.T) {
	seasons := parser.Seasons()
	for i := 0; i+1 < len(seasons); i++ {
		if !seasons[i].End.Equal(seasons[i+1].Start) {
			t.Errorf("season %d end (%s) != season %d start (%s)",
				seasons[i].Number, seasons[i].End, seasons[i+1].Number, seasons[i+1].Start)
		}
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
