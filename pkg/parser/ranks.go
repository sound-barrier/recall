package parser

import (
	"errors"
	"fmt"
	"slices"

	"gopkg.in/yaml.v3"
)

// ranks.yaml is the single source for the competitive tier ladder. Unlike
// heroes/maps (unordered name pools), a rank's ORDER is its meaning: the index
// is the ladder coordinate every rank chart and the Elo calculator compute
// from. Embedded + user-override loaded via owdata.go::Reload; accessor
// Ranks(). Adding a tier is a YAML edit here — no Go changes.

type ranksYAML struct {
	Ranks []string `yaml:"ranks"`
}

// unmarshalRanks decodes ranks.yaml into the dataset. It rejects an empty
// list, blank entries, and duplicates — a duplicate would give one tier two
// ladder positions, which silently corrupts every score derived from the
// index rather than failing anywhere visible.
func unmarshalRanks(ds *owDataset, b []byte) error {
	var doc ranksYAML
	if err := yaml.Unmarshal(b, &doc); err != nil {
		return fmt.Errorf("ranks.yaml: %w", err)
	}
	if len(doc.Ranks) == 0 {
		return errors.New("ranks.yaml: no ranks defined")
	}
	seen := make(map[string]bool, len(doc.Ranks))
	out := make([]string, 0, len(doc.Ranks))
	for i, r := range doc.Ranks {
		if r == "" {
			return fmt.Errorf("ranks.yaml: rank %d is empty", i)
		}
		if seen[r] {
			return fmt.Errorf("ranks.yaml: duplicate rank %q", r)
		}
		seen[r] = true
		out = append(out, r)
	}
	ds.ranks = out
	return nil
}

// Ranks returns the competitive tier ladder in file order, lowest to highest.
// The index IS the ladder position — callers that need "is this a real tier"
// should use IsKnownRank rather than scanning this slice.
func Ranks() []string {
	src := loadDataset().ranks
	out := make([]string, len(src))
	copy(out, src)
	return out
}

// IsKnownRank reports whether name is a tier on the ladder. Case-sensitive
// against the stored lowercase form; callers holding user input should
// normalize first.
func IsKnownRank(name string) bool {
	return slices.Contains(loadDataset().ranks, name)
}
