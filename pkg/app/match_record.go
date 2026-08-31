package app

import (
	"fmt"
	"os"
	"path/filepath"

	"recall/pkg/aggregate"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// PendingScreenshots is the wire shape behind the "Run Parse · N" button.
// Count is exactly what the next normal run will OCR; Parked counts the
// on-disk files the run gave up on (parkedAttemptCap failures) so the UI
// can say "2 parked after repeated failures" instead of promising them.
type PendingScreenshots struct {
	Count  int `json:"count"`
	Parked int `json:"parked"`
}

// GetNewScreenshotCount returns the number of image files in the configured
// screenshots directory that the next parse run will OCR — the number behind
// the "Run Parse · N" button. It answers off the SAME skip set and the SAME
// directory scan the run itself uses (parsedSkipSet + parser.PendingFiles), so
// it can't disagree with the progress panel's "X / N files". Computing it from
// LoadAllFilenames alone used to leave out every All-Heroes screen, dismissed
// file, and registered duplicate, each of which inflated the button
// permanently because none of them ever returns to a parent table. Parked
// failures get the complementary treatment: they leave Count (the run skips
// them) and surface in Parked instead — but only while still on disk.
func (a *App) GetNewScreenshotCount() (PendingScreenshots, error) {
	dir := a.settingsSnapshot().ScreenshotsDir
	if dir == "" {
		return PendingScreenshots{}, nil
	}
	// Same folder the run itself would use, so the count and the run cannot
	// disagree about what is already parsed.
	dirID, err := a.store.EnsureScreenshotsDir(dir)
	if err != nil {
		return PendingScreenshots{}, err
	}
	skip, err := a.parsedSkipSet(dirID, false)
	if err != nil {
		return PendingScreenshots{}, err
	}
	pending, err := parser.PendingFiles(dir, skip)
	if err != nil {
		if os.IsNotExist(err) {
			return PendingScreenshots{}, nil
		}
		return PendingScreenshots{}, err
	}
	return PendingScreenshots{Count: len(pending), Parked: a.parkedOnDisk(dir)}, nil
}

// parkedOnDisk counts the parked filenames still present in dir. Parked
// files sit inside the skip set, so the pending scan never sees them; a
// per-file stat over the (small) parked set is the honest existence
// check — a parked row whose file was deleted counts nowhere.
func (a *App) parkedOnDisk(dir string) int {
	n := 0
	for f := range a.parkedSet() {
		if _, err := os.Stat(filepath.Join(dir, f)); err == nil {
			n++
		}
	}
	return n
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
		aggregate.ApplyReadTimeInference(&recs[i].Data)
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
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
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
