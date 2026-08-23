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
	return review.List(a.store)
}

// GetSelfReview returns one sitting whole.
func (a *App) GetSelfReview(reviewID string) (review.Session, error) {
	return review.Get(a.store, reviewID)
}

// assertSelfReviewWritable is the lock every sitting write asks: no open
// coach session — the visible records are someone else's loan then. (It
// used to also require a mutable profile; the tour's sample is a writable
// sandbox now, so the coach session is the one remaining lock.)
func (a *App) assertSelfReviewWritable() error {
	return a.assertNoCoachSession()
}

// CreateSelfReview opens a sitting over the given matches.
func (a *App) CreateSelfReview(in review.CreateInput) (review.Session, error) {
	if err := a.assertSelfReviewWritable(); err != nil {
		return review.Session{}, err
	}
	return review.Create(a.store, in)
}

// UpdateSelfReview renames the sitting. What it concluded lives in its
// focus items — SetSelfReviewFocusItems.
func (a *App) UpdateSelfReview(reviewID string, in review.UpdateInput) (review.Session, error) {
	if err := a.assertSelfReviewWritable(); err != nil {
		return review.Session{}, err
	}
	r, err := review.Update(a.store, reviewID, in)
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
	if err := a.assertSelfReviewWritable(); err != nil {
		return review.Session{}, err
	}
	before, err := review.Get(a.store, reviewID)
	if err != nil {
		return review.Session{}, err
	}
	r, err := review.SetMatches(a.store, reviewID, matchKeys)
	if err != nil {
		return review.Session{}, err
	}
	a.emitMatchesByKey(before.MatchKeys)
	return r, nil
}

// DeleteSelfReview removes the sitting and its blocks from every match it
// touched; the reviewed-by flags a finish stamped stay.
func (a *App) DeleteSelfReview(reviewID string) error {
	if err := a.assertSelfReviewWritable(); err != nil {
		return err
	}
	// Read the set first so the matches that lose a block can be
	// re-broadcast; absent is a no-op, like the store's own delete.
	r, ok, err := a.store.LoadSelfReview(reviewID)
	if err != nil || !ok {
		return err
	}
	if err := review.Delete(a.store, reviewID); err != nil {
		return err
	}
	a.emitMatchesByKey(r.MatchKeys)
	return nil
}

// FinishSelfReview stamps the sitting done and every member match reviewed
// by self where a coach has not already.
func (a *App) FinishSelfReview(reviewID string) (review.Session, error) {
	if err := a.assertSelfReviewWritable(); err != nil {
		return review.Session{}, err
	}
	r, err := review.Finish(a.store, reviewID)
	if err != nil {
		return review.Session{}, err
	}
	a.emitMatchesByKey(r.MatchKeys)
	return r, nil
}

// PutSelfReviewNote saves the sitting's note about one match.
func (a *App) PutSelfReviewNote(reviewID, matchKey string, in coach.NoteInput) (review.Note, error) {
	if err := a.assertSelfReviewWritable(); err != nil {
		return review.Note{}, err
	}
	n, err := review.PutNote(a.store, reviewID, matchKey, in)
	if err != nil {
		return review.Note{}, err
	}
	a.emitMatchByKey(matchKey)
	return n, nil
}

// DeleteSelfReviewNote removes the sitting's note about one match.
func (a *App) DeleteSelfReviewNote(reviewID, matchKey string) error {
	if err := a.assertSelfReviewWritable(); err != nil {
		return err
	}
	if err := review.DeleteNote(a.store, db.SelfReviewNoteRef{ReviewID: reviewID, MatchKey: matchKey}); err != nil {
		return err
	}
	a.emitMatchByKey(matchKey)
	return nil
}

// PutSelfReviewMoment saves one timestamped moment on the sitting's note
// about a match, opening the note as reviewed_only when there is none.
func (a *App) PutSelfReviewMoment(reviewID, matchKey, momentID string, in matchedit.MomentInput) (review.Moment, error) {
	if err := a.assertSelfReviewWritable(); err != nil {
		return review.Moment{}, err
	}
	m, err := review.PutMoment(a.store, momentRef(reviewID, matchKey, momentID), in)
	if err != nil {
		return review.Moment{}, err
	}
	a.emitMatchByKey(matchKey)
	return m, nil
}

// DeleteSelfReviewMoment removes one moment from the sitting's note.
func (a *App) DeleteSelfReviewMoment(reviewID, matchKey, momentID string) error {
	if err := a.assertSelfReviewWritable(); err != nil {
		return err
	}
	if err := review.DeleteMoment(a.store, momentRef(reviewID, matchKey, momentID)); err != nil {
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
	if err := a.assertSelfReviewWritable(); err != nil {
		return review.Session{}, err
	}
	if err := review.ValidateFocusItems(items); err != nil {
		return review.Session{}, err
	}
	// Through the review package's mapper, not raw: db.ErrSelfReviewUnknown
	// carries no problem-ladder entry, so returning it as-is answered 500
	// for a sitting that simply is not there — where every sibling route
	// answers 404.
	if err := a.store.SetSelfReviewFocusItems(reviewID, items); err != nil {
		return review.Session{}, review.MapStoreErr(err)
	}
	return review.Get(a.store, reviewID)
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
