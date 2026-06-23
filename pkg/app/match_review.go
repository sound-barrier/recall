package app

import "errors"

// validReviewers enumerates the two scenarios users can tag a match
// review with:
//   - "self"  — the user reviewed the match VOD themselves
//   - "coach" — a coach reviewed the match VOD with the user
//
// The empty string is the third logical state ("not reviewed") and
// goes through ClearMatchReview, not SetMatchReview.
var validReviewers = map[string]bool{"self": true, "coach": true}

// ErrInvalidReviewedBy is returned by SetMatchReview when the
// reviewed_by value isn't 'self' or 'coach'. HTTP handlers map this
// to 400 — user-input error, not a server fault.
var ErrInvalidReviewedBy = errors.New("invalid reviewed_by: must be 'self' or 'coach'")

// SetMatchReview tags a match as reviewed by the user themselves
// ('self') or by a coach ('coach'). Idempotent — repeated identical
// calls succeed; calling with a different reviewer overwrites.
//
// Use ClearMatchReview to revert to the "not reviewed" state.
func (a *App) SetMatchReview(matchKey, reviewedBy string) error {
	if matchKey == "" {
		return errors.New("match_key required")
	}
	if !validReviewers[reviewedBy] {
		return ErrInvalidReviewedBy
	}
	return a.store.SetReview(matchKey, reviewedBy)
}

// ClearMatchReview removes the review-status tag. Idempotent —
// clearing an unreviewed match is a no-op.
func (a *App) ClearMatchReview(matchKey string) error {
	if matchKey == "" {
		return errors.New("match_key required")
	}
	return a.store.ClearReview(matchKey)
}
