// Package matchedit writes everything a user edits about a match: the
// per-match sidecars (annotation, review, queue, play-mode, visibility
// and ignore rows that hang off a match key without belonging to any
// parsed screenshot), the override layer that shadows the parsed OCR
// values, and the hand-entered matches that have no OCR rows at all.
//
// Every entry point has the same shape — validate the input, guard
// against an unknown match key, write. Orchestration stays in the shell
// that calls this package: the coaching-session write gate, event
// emission, read-time aggregation, and the profile lifecycle are all
// above this layer, so nothing here needs more than a db.Store.
package matchedit

import (
	"fmt"

	"recall/pkg/db"
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

// AssertMatchExists reports match.ErrMatchNotFound when matchKey names no
// match in this database. The HTTP layer maps that sentinel to 404.
func AssertMatchExists(s db.Store, matchKey string) error {
	exists, err := s.MatchKeyExists(matchKey)
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
func assertMatchesExist(s db.Store, matchKeys []string) error {
	if len(matchKeys) == 0 {
		return nil
	}
	known, err := s.LoadMatchKeys()
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
