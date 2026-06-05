package app

import (
	"errors"
	"fmt"
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
// Idempotent: ignoring an already-ignored filename refreshes the
// timestamp; wiping a non-existent matchKey is a no-op.
func (a *App) IgnoreScreenshot(filename string) error {
	if filename == "" {
		return ErrIgnoreFilenameRequired
	}
	if err := a.store.AddIgnoredScreenshot(filename); err != nil {
		return fmt.Errorf("add ignored screenshot: %w", err)
	}
	// Wipe both unmatched- and ambiguous- match rows that pointed at
	// this file. The matchKey shape is canonical (no colons), so we
	// can derive both candidates and call HardDeleteMatch on each.
	for _, key := range []string{
		"unmatched-" + filename,
		"ambiguous-" + filename,
	} {
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
