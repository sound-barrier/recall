package matchedit

import (
	"errors"

	"recall/pkg/db"
)

// validReviewers enumerates the two scenarios users can tag a match
// review with:
//   - "self"  — the user reviewed the match VOD themselves
//   - "coach" — a coach reviewed the match VOD with the user
//
// The empty string is the third logical state ("not reviewed") and
// goes through ClearReview, not SetReview.
var validReviewers = map[string]bool{"self": true, "coach": true}

// ErrInvalidReviewedBy is returned by SetReview when the reviewed_by
// value isn't 'self' or 'coach'. HTTP handlers map this to 400 —
// user-input error, not a server fault.
var ErrInvalidReviewedBy = errors.New("invalid reviewed_by: must be 'self' or 'coach'")

// SetReview tags a match as reviewed by the user themselves ('self')
// or by a coach ('coach'). Idempotent — repeated identical calls
// succeed; calling with a different reviewer overwrites.
//
// Use ClearReview to revert to the "not reviewed" state.
func SetReview(s db.Store, matchKey, reviewedBy string) error {
	if matchKey == "" {
		return errors.New("match_key required")
	}
	if !validReviewers[reviewedBy] {
		return ErrInvalidReviewedBy
	}
	if err := AssertMatchExists(s, matchKey); err != nil {
		return err
	}
	return s.SetReview(matchKey, reviewedBy)
}

// ClearReview removes the review-status tag. Idempotent — clearing an
// unreviewed match is a no-op.
func ClearReview(s db.Store, matchKey string) error {
	if matchKey == "" {
		return errors.New("match_key required")
	}
	return s.ClearReview(matchKey)
}
