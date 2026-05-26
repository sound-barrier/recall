package app

import (
	"os"
	"path/filepath"
	"strings"

	"recall/pkg/parser"
)

// MatchRecord is the per-match shape returned by GetMatchResults.
// It's assembled at read time by aggregateAll, which fuses every
// per-type screenshot row that shares a match_key. No `id` field —
// the previous single-table primary key is gone; match_key is identity.
type MatchRecord struct {
	MatchKey       string             `json:"match_key"`
	SourceFiles    []string           `json:"source_files"`
	SourceTypes    map[string]string  `json:"source_types,omitempty"`
	SourceParsedAt map[string]string  `json:"source_parsed_at,omitempty"`
	ParsedAt       string             `json:"parsed_at,omitempty"`
	Data           parser.MatchResult `json:"data"`
}

// GetNewScreenshotCount returns the number of image files in the
// configured screenshots directory that haven't been parsed yet.
func (a *App) GetNewScreenshotCount() (int, error) {
	if a.settings.ScreenshotsDir == "" {
		return 0, nil
	}
	parsed, err := a.store.LoadAllFilenames()
	if err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(a.settings.ScreenshotsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	count := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
			continue
		}
		if !parsed[e.Name()] {
			count++
		}
	}
	return count, nil
}

// GetMatchResults returns one MatchRecord per match, aggregated from
// the per-screenshot tables. Read-time inference (inferSoleHeroPercent,
// inferResultFromRank) applies after aggregation; the source DB rows
// are never mutated.
func (a *App) GetMatchResults() ([]MatchRecord, error) {
	recs, err := a.aggregateAll()
	if err != nil {
		return nil, err
	}
	for i := range recs {
		inferSoleHeroPercent(&recs[i].Data)
		inferResultFromRank(&recs[i].Data)
	}
	return recs, nil
}

// ClearDatabase deletes every row across every per-type table.
func (a *App) ClearDatabase() error { return a.store.Clear() }
