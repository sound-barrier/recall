package app

import (
	"fmt"
	"os"

	"recall/pkg/aggregate"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// GetNewScreenshotCount returns the number of image files in the configured
// screenshots directory that the next parse run will OCR — the number behind
// the "Run Parse · N" button. It answers off the SAME skip set and the SAME
// directory scan the run itself uses (parsedSkipSet + parser.PendingFiles), so
// it can't disagree with the progress panel's "X / N files". Computing it from
// LoadAllFilenames alone used to leave out every All-Heroes screen, "Delete
// forever" file, and registered duplicate, each of which inflated the button
// permanently because none of them ever returns to a parent table.
func (a *App) GetNewScreenshotCount() (int, error) {
	dir := a.settingsSnapshot().ScreenshotsDir
	if dir == "" {
		return 0, nil
	}
	skip, err := a.parsedSkipSet(false)
	if err != nil {
		return 0, err
	}
	pending, err := parser.PendingFiles(dir, skip)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	return len(pending), nil
}

// GetMatchResults returns one match.Record per match, aggregated from
// the per-screenshot tables. Read-time inference (aggregate.InferSoleHeroPercent,
// aggregate.InferResultFromRank) applies after aggregation; the source DB rows
// are never mutated.
func (a *App) GetMatchResults() ([]match.Record, error) {
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

// GetMatchByKey returns a single aggregated match.Record. Reuses the
// same aggregateAll pipeline as GetMatchResults (so the inference
// + child-table folding semantics are identical), then filters to
// the requested key. Returns match.ErrMatchNotFound if no row matches.
//
// The implementation aggregates the full corpus today; a future
// optimization is a per-key aggregator that runs one SELECT per
// table with a `WHERE match_key = ?` filter. Not done yet because
// the current corpus sizes are small and the predictable shape (one
// aggregator) is worth the duplication cost.
func (a *App) GetMatchByKey(matchKey string) (match.Record, error) {
	recs, err := a.GetMatchResults()
	if err != nil {
		return match.Record{}, err
	}
	for _, r := range recs {
		if r.MatchKey == matchKey {
			return r, nil
		}
	}
	return match.Record{}, match.ErrMatchNotFound
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
