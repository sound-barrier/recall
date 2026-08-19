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
		return Note{}, mapStoreErr(err)
	}
	return noteFromRow(saved), nil
}

// DeleteNote removes the note and its moments; absent is a no-op.
func DeleteNote(s Store, reviewID, matchKey string) error {
	return s.DeleteSelfReviewNote(reviewID, matchKey)
}

// PutMoment saves one timestamped moment on the sitting's note about a
// match. A match with no note yet gets a reviewed_only one — a moment IS a
// review of the match, the same rule the coach's room applies — opened by
// the STORE in the moment's own transaction, so a note write racing the
// first moment on a match can never be downgraded to an empty mark by a
// check-then-open here. The rules are the player's own moment rules; the id
// is the client's to mint. An edit keeps its place in the reading order; a
// new one goes after every place taken.
func PutMoment(s Store, reviewID, matchKey, momentID string, in matchedit.MomentInput) (Moment, error) {
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
	saved, err := s.UpsertSelfReviewMoment(reviewID, matchKey, db.SelfReviewMoment{
		MomentID:   momentID,
		MatchClock: normalized.MatchClock,
		Text:       normalized.Text,
		FocusTag:   normalized.FocusTag,
		SortOrder:  sortOrderFor(existing, momentID),
	})
	if err != nil {
		return Moment{}, mapStoreErr(err)
	}
	return momentFromRow(saved), nil
}

// DeleteMoment removes one moment; absent is a no-op.
func DeleteMoment(s Store, reviewID, matchKey, momentID string) error {
	return s.DeleteSelfReviewMoment(reviewID, matchKey, momentID)
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
	if slices.ContainsFunc(existing, func(m db.SelfReviewMoment) bool { return m.MomentID == momentID }) {
		return nil
	}
	if len(existing) >= matchedit.MaxMomentsPerMatch {
		return fmt.Errorf("%w: a match holds at most %d moments", matchedit.ErrInvalidMoment, matchedit.MaxMomentsPerMatch)
	}
	return nil
}

// sortOrderFor keeps an existing moment's place and puts a new one after
// every order already taken — never at len(existing), which collides with a
// survivor after any delete.
func sortOrderFor(existing []db.SelfReviewMoment, momentID string) int {
	next := 0
	for _, m := range existing {
		if m.MomentID == momentID {
			return m.SortOrder
		}
		if m.SortOrder >= next {
			next = m.SortOrder + 1
		}
	}
	return next
}
