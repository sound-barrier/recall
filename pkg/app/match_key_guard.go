package app

import (
	"fmt"

	"recall/pkg/match"
)

// The unknown-key guard (design rule 2). Every per-match sidecar table is
// keyed on match_key with no foreign key behind it, so a write naming a
// key this database has never seen inserts a row nothing will ever read
// back — an orphan, invisible in the UI and carried along by every export
// and profile move after it. The canonical way to produce one is a client
// holding somebody else's keys: a coach reviewing a loaned corpus, or a
// player accepting a coach's note about a match they deleted.
//
// Only the writes that CREATE a row are guarded. A clear/unhide/reset on
// an unknown key removes nothing and stays idempotent, which is what the
// UI's fire-and-forget undo paths rely on.

// assertMatchExists reports match.ErrMatchNotFound when matchKey names no
// match in this database. The HTTP layer maps that sentinel to 404.
func (a *App) assertMatchExists(matchKey string) error {
	exists, err := a.store.MatchKeyExists(matchKey)
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("%w: %s", match.ErrMatchNotFound, matchKey)
	}
	return nil
}

// assertMatchesExist is the bulk twin: one registry read for the whole
// batch, and the batch is refused whole so a partial write can't leave
// half the selection tagged.
func (a *App) assertMatchesExist(matchKeys []string) error {
	if len(matchKeys) == 0 {
		return nil
	}
	known, err := a.store.LoadMatchKeys()
	if err != nil {
		return err
	}
	for _, key := range matchKeys {
		if !known[key] {
			return fmt.Errorf("%w: %s", match.ErrMatchNotFound, key)
		}
	}
	return nil
}
