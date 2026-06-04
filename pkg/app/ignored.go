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

// GetIgnoredScreenshots returns the suppress-list sorted by
// filename. Used by the debug GET endpoint and (eventually) by a
// "Manage ignored" surface.
func (a *App) GetIgnoredScreenshots() ([]string, error) {
	m, err := a.store.LoadIgnoredFilenames()
	if err != nil {
		return nil, fmt.Errorf("load ignored filenames: %w", err)
	}
	out := make([]string, 0, len(m))
	for f := range m {
		out = append(out, f)
	}
	// Stable order so JSON responses + tests don't flake on map
	// iteration randomness.
	sortStrings(out)
	return out, nil
}

// sortStrings is a tiny helper to keep this file dependency-light;
// avoids pulling sort into the import block when only one site uses
// it.
func sortStrings(s []string) {
	// insertion sort — the list is small (typically dozens, not
	// thousands) so an O(n²) sort is fine and avoids the sort
	// package import.
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j-1] > s[j]; j-- {
			s[j-1], s[j] = s[j], s[j-1]
		}
	}
}
