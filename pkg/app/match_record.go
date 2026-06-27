package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"recall/pkg/aggregate"
	"recall/pkg/match"
)

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

// GetMatchResults returns one match.MatchRecord per match, aggregated from
// the per-screenshot tables. Read-time inference (aggregate.InferSoleHeroPercent,
// aggregate.InferResultFromRank) applies after aggregation; the source DB rows
// are never mutated.
func (a *App) GetMatchResults() ([]match.MatchRecord, error) {
	recs, err := a.aggregateAll()
	if err != nil {
		return nil, err
	}
	for i := range recs {
		aggregate.InferSoleHeroPercent(&recs[i].Data)
		aggregate.InferResultFromRank(&recs[i].Data)
	}
	a.attachThumbnails(recs)
	return recs, nil
}

// GetMatchByKey returns a single aggregated match.MatchRecord. Reuses the
// same aggregateAll pipeline as GetMatchResults (so the inference
// + child-table folding semantics are identical), then filters to
// the requested key. Returns match.ErrMatchNotFound if no row matches.
//
// The implementation aggregates the full corpus today; a future
// optimization is a per-key aggregator that runs one SELECT per
// table with a `WHERE match_key = ?` filter. Not done yet because
// the current corpus sizes are small and the predictable shape (one
// aggregator) is worth the duplication cost.
func (a *App) GetMatchByKey(matchKey string) (match.MatchRecord, error) {
	recs, err := a.GetMatchResults()
	if err != nil {
		return match.MatchRecord{}, err
	}
	for _, r := range recs {
		if r.MatchKey == matchKey {
			return r, nil
		}
	}
	return match.MatchRecord{}, match.ErrMatchNotFound
}

// ClearDatabase deletes every row across every per-type table. The
// `keepIgnored` opt-out preserves the Unknown-tab "Delete forever"
// suppress list across the wipe (Store.Clear unconditionally truncates
// `ignored_screenshots` — this method snapshots the list, calls Clear,
// then re-inserts so the suppress list survives without threading an
// option through every Store implementation). Pass `false` for the
// standard "factory reset" semantic; pass `true` when the user
// explicitly opts into keeping their curated ignore list.
func (a *App) ClearDatabase(keepIgnored bool) error {
	if !keepIgnored {
		return a.store.Clear()
	}
	snapshot, err := a.store.LoadIgnoredFilenames()
	if err != nil {
		return fmt.Errorf("snapshot ignored filenames: %w", err)
	}
	if err := a.store.Clear(); err != nil {
		return err
	}
	for filename := range snapshot {
		if err := a.store.AddIgnoredScreenshot(filename); err != nil {
			return fmt.Errorf("restore ignored %s: %w", filename, err)
		}
	}
	return nil
}
