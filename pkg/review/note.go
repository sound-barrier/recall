package review

import (
	"fmt"
	"slices"

	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/matchedit"
)

// PutNote saves the sitting's one note about a match. The body is the coach
// note's shape and obeys the coach note's rules — the room's editor is one
// component, and a note the player writes about their own game must be one
// a coach could have written about it. Moments on the note are untouched
// (they have their own writes). ErrMatchNotInReview when the match is not in
// the sitting.
func PutNote(s Store, reviewID, matchKey string, in coach.NoteInput) (Note, error) {
	normalized, err := coach.ValidateNoteInput(in)
	if err != nil {
		return Note{}, err
	}
	saved, err := s.UpsertSelfReviewNote(db.SelfReviewNote{
		ReviewID:   reviewID,
		MatchKey:   matchKey,
		Kind:       normalized.Kind,
		Text:       normalized.Text,
		MatchClock: normalized.MatchClock,
		FocusTags:  normalized.FocusTags,
		ExtraTags:  normalized.ExtraTags,
	})
	if err != nil {
		return Note{}, MapStoreErr(err)
	}
	return noteFromRow(saved), nil
}

// DeleteNote removes the note and its moments; absent is a no-op.
func DeleteNote(s Store, ref db.SelfReviewNoteRef) error {
	return s.DeleteSelfReviewNote(ref)
}

// MomentRef says which moment, in which match, in which sitting.
//
// An alias rather than a second struct: this shape used to stop at this
// package's door, so the store below still took three positional strings and
// PutMoment built the ref out of what it had just been handed. One type now,
// all the way down.
type MomentRef = db.SelfReviewMomentRef

// PutMoment saves one timestamped moment on the sitting's note about a
// match. A match with no note yet gets a reviewed_only one — a moment IS a
// review of the match, the same rule the coach's room applies — opened by
// the STORE in the moment's own transaction, so a note write racing the
// first moment on a match can never be downgraded to an empty mark by a
// check-then-open here. The rules are the player's own moment rules; the id
// is the client's to mint. An edit keeps its place in the reading order; a
// new one goes after every place taken.
func PutMoment(s Store, ref MomentRef, in matchedit.MomentInput) (Moment, error) {
	reviewID, matchKey, momentID := ref.ReviewID, ref.MatchKey, ref.MomentID
	if momentID == "" {
		return Moment{}, fmt.Errorf("%w: a moment needs an id", matchedit.ErrInvalidMoment)
	}
	normalized, err := matchedit.ValidateMomentInput(in)
	if err != nil {
		return Moment{}, err
	}
	existing, err := momentsOnMatch(s, reviewID, matchKey)
	if err != nil {
		return Moment{}, err
	}
	if err := checkMomentRoom(existing, momentID); err != nil {
		return Moment{}, err
	}
	saved, err := s.UpsertSelfReviewMoment(db.SelfReviewNoteRef{ReviewID: reviewID, MatchKey: matchKey}, db.SelfReviewMoment{
		MomentID:   momentID,
		MatchClock: normalized.MatchClock,
		Text:       normalized.Text,
		FocusTag:   normalized.FocusTag,
		SortOrder:  matchedit.SortOrderFor(existing, momentID),
	})
	if err != nil {
		return Moment{}, MapStoreErr(err)
	}
	return momentFromRow(saved), nil
}

// DeleteMoment removes one moment; absent is a no-op.
func DeleteMoment(s Store, ref MomentRef) error {
	return s.DeleteSelfReviewMoment(ref)
}

// momentsOnMatch reads the moments the sitting already holds on the match —
// what the ceiling and the reading order are computed against. A match
// outside the sitting is refused here, before anything is written; a match
// with no note yet has none.
func momentsOnMatch(s Store, reviewID, matchKey string) ([]db.SelfReviewMoment, error) {
	r, err := getRow(s, reviewID)
	if err != nil {
		return nil, err
	}
	if !slices.Contains(r.MatchKeys, matchKey) {
		return nil, fmt.Errorf("%w: %s", ErrMatchNotInReview, matchKey)
	}
	return r.Notes[matchKey].Moments, nil
}

// checkMomentRoom refuses a NEW moment past the ceiling; an edit to one
// already stored always fits. Same ceiling as the player's per-match moments.
func checkMomentRoom(existing []db.SelfReviewMoment, momentID string) error {
	if matchedit.IsStoredMoment(existing, momentID) {
		return nil
	}
	if len(existing) >= matchedit.MaxMomentsPerMatch {
		return fmt.Errorf("%w: a match holds at most %d moments", matchedit.ErrInvalidMoment, matchedit.MaxMomentsPerMatch)
	}
	return nil
}
