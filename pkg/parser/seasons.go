package parser

import (
	"errors"
	"fmt"
	"time"

	"gopkg.in/yaml.v3"
)

// seasons.yaml lists the competitive seasons used to filter and compare
// matches by season. Unlike heroes/maps (flat name lists), a season's
// identity is its name and its meaningful content is its [start, end) UTC
// window. Embedded + user-override loaded via owdata.go::Reload; accessor
// Seasons(). Adding/correcting a season is a YAML edit — no Go changes.

// Season is one competitive season window. Start/End are UTC instants;
// consumers compare a match's canonical UTC against [Start, End).
type Season struct {
	Name    string
	Chapter string
	Number  int
	Start   time.Time
	End     time.Time
}

// seasonYAML decodes start/end as strings so time.Parse controls the format
// (RFC 3339) regardless of YAML timestamp-tag quirks.
type seasonYAML struct {
	Name    string `yaml:"name"`
	Chapter string `yaml:"chapter"`
	Number  int    `yaml:"number"`
	Start   string `yaml:"start"`
	End     string `yaml:"end"`
}

type seasonsFile struct {
	Seasons []seasonYAML `yaml:"seasons"`
}

func unmarshalSeasons(ds *owDataset, b []byte) error {
	var raw seasonsFile
	if err := yaml.Unmarshal(b, &raw); err != nil {
		return fmt.Errorf("unmarshal: %w", err)
	}
	if len(raw.Seasons) == 0 {
		return errors.New("no seasons in YAML")
	}
	out := make([]Season, 0, len(raw.Seasons))
	for i, s := range raw.Seasons {
		if s.Name == "" {
			return fmt.Errorf("season[%d]: empty name", i)
		}
		start, err := time.Parse(time.RFC3339, s.Start)
		if err != nil {
			return fmt.Errorf("season[%d] %q: parse start: %w", i, s.Name, err)
		}
		end, err := time.Parse(time.RFC3339, s.End)
		if err != nil {
			return fmt.Errorf("season[%d] %q: parse end: %w", i, s.Name, err)
		}
		if !start.Before(end) {
			return fmt.Errorf("season[%d] %q: start %s is not before end %s", i, s.Name, s.Start, s.End)
		}
		out = append(out, Season{
			Name:    s.Name,
			Chapter: s.Chapter,
			Number:  s.Number,
			Start:   start.UTC(),
			End:     end.UTC(),
		})
	}
	ds.seasons = out
	return nil
}
