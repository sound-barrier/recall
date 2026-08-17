package matchedit

import (
	"recall/pkg/db"
)

// Hide soft-deletes a match. The screenshot rows in the per-type
// parent tables are untouched, so a re-parse of the same source files
// continues to skip them (LoadAllFilenames sees them as already
// parsed). The aggregator sets `match.Record.Hidden = true` on the
// next read, and the default filter drops these rows from the
// rendered Matches list.
//
// Idempotent: hiding an already-hidden match refreshes the
// `hidden_at` timestamp but is otherwise a no-op.
func Hide(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	if err := AssertMatchExists(s, matchKey); err != nil {
		return err
	}
	return s.HideMatch(matchKey)
}

// Unhide removes the soft-delete flag. Idempotent: unhiding a match
// that wasn't hidden is a no-op.
func Unhide(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	return s.UnhideMatch(matchKey)
}

// Pin stars a match — the list renders pinned matches in a leading
// section above the date groups. Idempotent.
func Pin(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	if err := AssertMatchExists(s, matchKey); err != nil {
		return err
	}
	return s.PinMatch(matchKey)
}

// Unpin removes the star. Idempotent.
func Unpin(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	return s.UnpinMatch(matchKey)
}

// HardDelete wipes every row keyed on matchKey from the database.
// Surfaced by the Hidden drawer's Delete affordance — the user has
// already moved the match to the archive and explicitly confirmed.
// Idempotent: unknown keys complete with no error.
func HardDelete(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	return s.HardDeleteMatch(matchKey)
}
