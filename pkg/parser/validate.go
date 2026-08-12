package parser

import "fmt"

// emptyDataset constructs an owDataset with every registry map
// initialized. Shared by Reload and ValidateDataYAML so the unmarshal
// functions never see a nil map.
func emptyDataset() *owDataset {
	return &owDataset{
		heroesByRole:     map[string][]string{},
		mapsByGameMode:   map[string][]string{},
		heroRoles:        map[string]string{},
		mapGameModes:     map[string]string{},
		heroDisplayNames: map[string]string{},
		mapDisplayNames:  map[string]string{},
		heroStatKeys:     map[string][]string{},
	}
}

// ValidateDataYAML reports whether b parses as the named reference-data
// YAML file. The update-apply path calls it BEFORE replacing the on-disk
// files: a payload with a valid checksum sidecar can still be malformed
// YAML, and committing one records the version as applied while the
// parser silently falls back to embedded data on every subsequent boot.
// Unknown names error so a newly-added data file can't bypass validation.
func ValidateDataYAML(name string, b []byte) error {
	ds := emptyDataset()
	switch name {
	case "heroes.yaml":
		return unmarshalHeroes(ds, b)
	case "maps.yaml":
		return unmarshalMaps(ds, b)
	case "hero_stats.yaml":
		return unmarshalHeroStats(ds, b)
	case "screenshot_sources.yaml":
		return unmarshalScreenshotSources(ds, b)
	case "seasons.yaml":
		return unmarshalSeasons(ds, b)
	case "ranks.yaml":
		return unmarshalRanks(ds, b)
	}
	return fmt.Errorf("validate data yaml: unknown file %q", name)
}
