package app

import (
	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/matchedit"
	"recall/pkg/review"
)

// The player's saved self-review sittings — the orchestration above
// pkg/review. Every rule (validation, the reviewed_only-on-moment rule, the
// coach-outranks rule on Finish) lives in the leaf; what stays here is the
// write gate every mutating method states as its own first line so
// coach_gate_test.go's reflection net can find it, and the match-updated
// broadcast after a write that changes what a match shows.

// pkg/review declares its persistence needs as a consumer-side seam;
// db.Store satisfies it, asserted here where the two are wired.
var _ review.Store = (db.Store)(nil)

// ListSelfReviews returns every sitting, newest first.
func (a *App) ListSelfReviews() ([]review.Session, error) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return nil, leaseErr
	}
	defer release()
	return review.List(store)
}

// GetSelfReview returns one sitting whole.
func (a *App) GetSelfReview(reviewID string) (review.Session, error) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return review.Session{}, leaseErr
	}
	defer release()
	return review.Get(store, reviewID)
}

// CreateSelfReview opens a sitting over the given matches.
func (a *App) CreateSelfReview(in review.CreateInput) (review.Session, error) {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return review.Session{}, leaseErr
	}
	defer release()
	return review.Create(store, in)
}

// UpdateSelfReview renames the sitting. What it concluded lives in its
// focus items — SetSelfReviewFocusItems.
func (a *App) UpdateSelfReview(reviewID string, in review.UpdateInput) (review.Session, error) {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return review.Session{}, leaseErr
	}
	defer release()
	r, err := review.Update(store, reviewID, in)
	if err != nil {
		return review.Session{}, err
	}
	// The title prints on every block the sitting left on a match.
	a.emitMatchesByKey(r.MatchKeys)
	return r, nil
}

// SetSelfReviewMatches replaces the sitting's set; a note on a match that
// leaves goes with it, so that match is re-broadcast too.
func (a *App) SetSelfReviewMatches(reviewID string, matchKeys []string) (review.Session, error) {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return review.Session{}, leaseErr
	}
	defer release()
	before, err := review.Get(store, reviewID)
	if err != nil {
		return review.Session{}, err
	}
	r, err := review.SetMatches(store, reviewID, matchKeys)
	if err != nil {
		return review.Session{}, err
	}
	a.emitMatchesByKey(before.MatchKeys)
	return r, nil
}

// DeleteSelfReview removes the sitting and its blocks from every match it
// touched; the reviewed-by flags a finish stamped stay.
func (a *App) DeleteSelfReview(reviewID string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	// Read the set first so the matches that lose a block can be
	// re-broadcast; absent is a no-op, like the store's own delete.
	r, ok, err := store.LoadSelfReview(reviewID)
	if err != nil || !ok {
		return err
	}
	if err := review.Delete(store, reviewID); err != nil {
		return err
	}
	a.emitMatchesByKey(r.MatchKeys)
	return nil
}

// FinishSelfReview stamps the sitting done and every member match reviewed
// by self where a coach has not already.
func (a *App) FinishSelfReview(reviewID string) (review.Session, error) {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return review.Session{}, leaseErr
	}
	defer release()
	r, err := review.Finish(store, reviewID)
	if err != nil {
		return review.Session{}, err
	}
	a.emitMatchesByKey(r.MatchKeys)
	return r, nil
}

// PutSelfReviewNote saves the sitting's note about one match.
func (a *App) PutSelfReviewNote(reviewID, matchKey string, in coach.NoteInput) (review.Note, error) {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return review.Note{}, leaseErr
	}
	defer release()
	n, err := review.PutNote(store, reviewID, matchKey, in)
	if err != nil {
		return review.Note{}, err
	}
	a.emitMatchByKey(matchKey)
	return n, nil
}

// DeleteSelfReviewNote removes the sitting's note about one match.
func (a *App) DeleteSelfReviewNote(reviewID, matchKey string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	if err := review.DeleteNote(store, db.SelfReviewNoteRef{ReviewID: reviewID, MatchKey: matchKey}); err != nil {
		return err
	}
	a.emitMatchByKey(matchKey)
	return nil
}

// PutSelfReviewMoment saves one timestamped moment on the sitting's note
// about a match, opening the note as reviewed_only when there is none.
func (a *App) PutSelfReviewMoment(reviewID, matchKey, momentID string, in matchedit.MomentInput) (review.Moment, error) {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return review.Moment{}, leaseErr
	}
	defer release()
	m, err := review.PutMoment(store, momentRef(reviewID, matchKey, momentID), in)
	if err != nil {
		return review.Moment{}, err
	}
	a.emitMatchByKey(matchKey)
	return m, nil
}

// DeleteSelfReviewMoment removes one moment from the sitting's note.
func (a *App) DeleteSelfReviewMoment(reviewID, matchKey, momentID string) error {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	if err := review.DeleteMoment(store, momentRef(reviewID, matchKey, momentID)); err != nil {
		return err
	}
	a.emitMatchByKey(matchKey)
	return nil
}

// emitMatchesByKey re-broadcasts each match in the set — a sitting-level
// write (title, finish, delete, membership) changes what every member shows.
func (a *App) emitMatchesByKey(keys []string) {
	for _, k := range keys {
		a.emitMatchByKey(k)
	}
}

// SetSelfReviewFocusItems replaces what the sitting concluded, in the
// player's order, and returns the sitting.
//
// Items born here start Working: the player wrote them, so they are already
// on them — a coach's items arrive New because acknowledging one is a
// separate act from being told it.
func (a *App) SetSelfReviewFocusItems(reviewID string, items []db.FocusItem) (review.Session, error) {
	store, release, leaseErr := a.useStoreForWrite()
	if leaseErr != nil {
		return review.Session{}, leaseErr
	}
	defer release()
	if err := review.ValidateFocusItems(items); err != nil {
		return review.Session{}, err
	}
	// Through the review package's mapper, not raw: db.ErrSelfReviewUnknown
	// carries no problem-ladder entry, so returning it as-is answered 500
	// for a sitting that simply is not there — where every sibling route
	// answers 404.
	if err := store.SetSelfReviewFocusItems(reviewID, items); err != nil {
		return review.Session{}, review.MapStoreErr(err)
	}
	return review.Get(store, reviewID)
}

// momentRef assembles the ref from what the RPC boundary is handed.
//
// The exported methods above keep positional strings because that IS the wire
// shape -- the HTTP handler pulls three path params and the Wails binding is
// generated from the signature. Everything below this line takes the ref, so
// the three-loose-strings window is one function long instead of four layers
// deep (TECHNICAL_DEBT.md section 17).
func momentRef(reviewID, matchKey, momentID string) review.MomentRef {
	return review.MomentRef{
		ReviewID: reviewID, MatchKey: matchKey,
		MomentID: momentID,
	}
}
