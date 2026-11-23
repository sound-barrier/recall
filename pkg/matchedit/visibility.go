package matchedit

import (
	"errors"
	"fmt"
	"slices"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
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

// AcknowledgeReferenceGap dismisses a match's reference-data-gap
// warning on the Unknown tab. The match and its rows are untouched — a
// future reference-data update can still resolve the raw hero/map — so
// this hides the WARNING only, restorably. Requires the match to exist
// (an acknowledgement for a key nothing backs would strand forever).
// Idempotent: re-acknowledging refreshes the timestamp.
func AcknowledgeReferenceGap(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	if err := AssertMatchExists(s, matchKey); err != nil {
		return err
	}
	return s.AcknowledgeReferenceGap(matchKey)
}

// UnacknowledgeReferenceGap restores the warning. Idempotent on
// matches that weren't acknowledged.
func UnacknowledgeReferenceGap(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	return s.UnacknowledgeReferenceGap(matchKey)
}

// ErrNothingToConfirm is returned when a confirmation names a field the match
// holds no flag on, or one the user's own edit already settled. The HTTP
// layer maps it to 409: the request is well formed, the match's state refuses
// it.
var ErrNothingToConfirm = errors.New("no flagged reading to confirm")

// ErrReadingChanged is returned when the value a confirmation was asked for
// is not the one the match reads now: a parse changed the reading after the
// client showed it. The HTTP layer maps it to 409; the client refetches and
// shows the user the new value.
var ErrReadingChanged = errors.New("the flagged reading changed since it was shown")

// ConfirmFieldReading records that the flagged reading of field on rec is
// right as read. The value stored is the one the flag holds — what the match
// reads now, from the read path that built rec — and shown, the value the
// client put in front of the user, is only a precondition on it: a parse that
// changed the reading in between is refused, so a confirmation is never
// bound to a number the user did not look at. rec is the aggregated record
// (the caller found it, so the match exists). Confirming a confirmed reading
// again is idempotent; a flag settled by an edit is refused, since the
// reading it was raised on is no longer what stats use.
func ConfirmFieldReading(s db.Store, rec match.Record, field parser.FieldPath, shown string) error {
	i := slices.IndexFunc(rec.FieldFlags, func(f match.FieldFlag) bool { return f.Field == field })
	if i < 0 || rec.FieldFlags[i].State == match.FlagEdited {
		return fmt.Errorf("%w: %s on %s", ErrNothingToConfirm, field, rec.MatchKey)
	}
	if current := rec.FieldFlags[i].Value; current != shown {
		return fmt.Errorf("%w: %s on %s reads %q, not %q", ErrReadingChanged, field, rec.MatchKey, current, shown)
	}
	return s.ConfirmFieldReading(rec.MatchKey, field, rec.FieldFlags[i].Value)
}

// UnconfirmFieldReading re-opens a confirmed reading. Idempotent, and, like
// the other removals, no unknown-key guard: it removes, never creates.
func UnconfirmFieldReading(s db.Store, matchKey string, field parser.FieldPath) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	return s.UnconfirmFieldReading(matchKey, field)
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
