package app

import (
	"errors"
	"fmt"

	"recall/pkg/match"
)

// ErrIgnoreFilenameRequired is the typed sentinel HTTP handlers
// errors.Is against to map "missing filename in URL" to a 400.
var ErrIgnoreFilenameRequired = errors.New("filename is required")

// IgnoreScreenshot adds `filename` to the suppress-list backing the
// Unknown tab's "Delete forever" affordance. Future parse runs skip
// any file whose name matches. Also wipes the matching match row
// (and its hidden / annotation / review side-tables) so the row
// disappears from the result set immediately, not just on the next
// parse — the user clicked "Delete forever," they expect the row
// gone now.
//
// The wipe targets THREE shapes of match_key:
//
//  1. `unmatched-<filename>` — the parser couldn't read a timestamp.
//  2. `ambiguous-<filename>` — the resolver tied between candidates.
//  3. `match-<timestamp>` — a tracked match whose OCR failed to extract
//     a map (so the aggregator surfaces it on the Unknown tab via the
//     `!data.map` filter). The match_key isn't derivable from the
//     filename alone, so we look up every match_key that references
//     `filename` across the five parent tables and wipe those too.
//
// Without case 3, an Unknown card whose underlying match_key is
// `match-<ts>` never disappeared — the suppress-list row went in but
// the source row stayed, so the next reload re-rendered the card.
//
// Idempotent: ignoring an already-ignored filename refreshes the
// timestamp; wiping a non-existent matchKey is a no-op.
func (a *App) IgnoreScreenshot(filename string) error {
	if filename == "" {
		return ErrIgnoreFilenameRequired
	}
	if err := a.store.AddIgnoredScreenshot(filename); err != nil {
		return fmt.Errorf("add ignored screenshot: %w", err)
	}
	// Deduplicate so a tracked-match lookup that returns the same key
	// we already had in the hard-coded fallback list doesn't call
	// HardDeleteMatch twice (harmless but noisier in tests + audit
	// logs). Build the set, then iterate it in a stable order so
	// failure messages stay reproducible.
	tracked, err := a.store.LookupMatchKeysForFilename(filename)
	if err != nil {
		return fmt.Errorf("lookup match keys for %s: %w", filename, err)
	}
	seen := map[string]bool{}
	keys := make([]string, 0, 2+len(tracked))
	for _, k := range append([]string{
		match.NewUnmatchedMatchKey(filename).String(),
		match.NewAmbiguousMatchKey(filename).String(),
	}, tracked...) {
		if seen[k] {
			continue
		}
		seen[k] = true
		keys = append(keys, k)
	}
	for _, key := range keys {
		if err := a.store.HardDeleteMatch(key); err != nil {
			return fmt.Errorf("hard delete match for %s: %w", key, err)
		}
	}
	return nil
}

// UnignoreScreenshot removes `filename` from the suppress-list so
// the next parse re-ingests it. Idempotent on absent filenames.
// Surfaced for completeness; no UI affordance ships in PR 4 (debug /
// future "show ignored" panel).
func (a *App) UnignoreScreenshot(filename string) error {
	if filename == "" {
		return ErrIgnoreFilenameRequired
	}
	return a.store.RemoveIgnoredScreenshot(filename)
}

// IgnoredScreenshot is the wire shape returned by GetIgnoredScreenshots.
// `Filename` is the raw filename the suppress-list keys on; `IgnoredAt`
// is the server-assigned timestamp the Settings panel renders so users
// can tell recent ignores from old ones.
type IgnoredScreenshot struct {
	Filename  string `json:"filename"`
	IgnoredAt string `json:"ignored_at"`
}

// GetIgnoredScreenshots returns the suppress-list with timestamps,
// sorted most-recently-ignored first. Backs the Settings "Manage
// ignored files" panel.
func (a *App) GetIgnoredScreenshots() ([]IgnoredScreenshot, error) {
	rows, err := a.store.ListIgnoredScreenshots()
	if err != nil {
		return nil, fmt.Errorf("list ignored screenshots: %w", err)
	}
	out := make([]IgnoredScreenshot, len(rows))
	for i, r := range rows {
		out[i] = IgnoredScreenshot{Filename: r.Filename, IgnoredAt: r.IgnoredAt}
	}
	return out, nil
}

// ClearIgnoredScreenshots truncates the suppress-list — the bulk
// "Re-enable all" action on the Settings panel. After the call, the
// next Parse run will re-discover every previously-ignored file from
// disk (the on-disk files never moved). Idempotent on an empty list.
func (a *App) ClearIgnoredScreenshots() error {
	if err := a.store.ClearIgnoredScreenshots(); err != nil {
		return fmt.Errorf("clear ignored screenshots: %w", err)
	}
	return nil
}
