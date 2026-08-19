package matchedit

import (
	"errors"

	"recall/pkg/db"
)

// The two scenarios a match review can be tagged with. The empty string
// is the third logical state ("not reviewed") and goes through
// ClearReview, not SetReview. Named here, once: pkg/coach's accept writes
// ReviewedByCoach and pkg/review's finish writes ReviewedBySelf, and the
// rule between them (the coach mark outranks in both directions) is only
// legible if both spell the same word.
const (
	// ReviewedBySelf — the user reviewed the match themselves.
	ReviewedBySelf = "self"
	// ReviewedByCoach — a coach reviewed the match with the user.
	ReviewedByCoach = "coach"
)

var validReviewers = map[string]bool{ReviewedBySelf: true, ReviewedByCoach: true}

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
		return ErrMatchKeyRequired
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
		return ErrMatchKeyRequired
	}
	return s.ClearReview(matchKey)
}
