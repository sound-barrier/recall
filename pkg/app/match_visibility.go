package app

import "fmt"

// HideMatch soft-deletes a match. The screenshot rows in the per-type
// parent tables are untouched, so a re-parse of the same source files
// continues to skip them (LoadAllFilenames sees them as already
// parsed). The aggregator sets `MatchRecord.Hidden = true` on the
// next read, and the default filter drops these rows from the
// rendered Matches list.
//
// Idempotent: hiding an already-hidden match refreshes the
// `hidden_at` timestamp but is otherwise a no-op.
func (a *App) HideMatch(matchKey string) error {
	if matchKey == "" {
		return fmt.Errorf("match_key required")
	}
	return a.store.HideMatch(matchKey)
}

// UnhideMatch removes the soft-delete flag. Idempotent: unhiding a
// match that wasn't hidden is a no-op.
func (a *App) UnhideMatch(matchKey string) error {
	if matchKey == "" {
		return fmt.Errorf("match_key required")
	}
	return a.store.UnhideMatch(matchKey)
}

// HardDeleteMatch wipes every row keyed on matchKey from the database.
// Surfaced by the Hidden drawer's Delete affordance — the user has
// already moved the match to the archive and explicitly confirmed.
// Idempotent: unknown keys complete with no error.
func (a *App) HardDeleteMatch(matchKey string) error {
	if matchKey == "" {
		return fmt.Errorf("match_key required")
	}
	return a.store.HardDeleteMatch(matchKey)
}
