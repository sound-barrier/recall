package cmd

import (
	"encoding/json"
	"net/http"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/matchedit"
	"recall/pkg/review"
)

// The player's own saved review sittings — `/api/v1/self-reviews…`. A
// sitting is created over a set of the player's OWN match keys, written to
// live (notes and moments autosave from the film room the way a coach's
// do), and finished; each note lands on its match as a block the moment it
// is written. Nothing here is a coaching session: no loan, no write gate on
// the player's data — and, the other way round, every write here IS
// gated on the coaching session like every write to the player's data.
//
// The 4xx ladder is central (defaultProblems): the review sentinels map
// once there, and a handler states only what is peculiar to its own body.

func registerSelfReviewRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/self-reviews", handleListSelfReviews(a))
	apiMux.HandleFunc("POST /api/v1/self-reviews", handleCreateSelfReview(a))
	apiMux.HandleFunc("GET /api/v1/self-reviews/{review_id}", handleGetSelfReview(a))
	apiMux.HandleFunc("PUT /api/v1/self-reviews/{review_id}", handleUpdateSelfReview(a))
	apiMux.HandleFunc("DELETE /api/v1/self-reviews/{review_id}", handleDeleteSelfReview(a))
	apiMux.HandleFunc("PUT /api/v1/self-reviews/{review_id}/matches", handleSetSelfReviewMatches(a))
	apiMux.HandleFunc("POST /api/v1/self-reviews/{review_id}/completion", handleFinishSelfReview(a))
	apiMux.HandleFunc("PUT /api/v1/self-reviews/{review_id}/notes/{match_key}", handlePutSelfReviewNote(a))
	apiMux.HandleFunc("DELETE /api/v1/self-reviews/{review_id}/notes/{match_key}", handleDeleteSelfReviewNote(a))
	apiMux.HandleFunc("PUT /api/v1/self-reviews/{review_id}/notes/{match_key}/moments/{moment_id}", handlePutSelfReviewMoment(a))
	apiMux.HandleFunc("DELETE /api/v1/self-reviews/{review_id}/notes/{match_key}/moments/{moment_id}", handleDeleteSelfReviewMoment(a))
}

// reviewIDFromPath reads {review_id} and 400s when it is empty, the way
// matchKeyFromPath does for its segment.
func reviewIDFromPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("review_id")
	if id == "" {
		writeProblem(w, r, probInvalidBody, "review_id required in URL")
		return "", false
	}
	return id, true
}

func handleListSelfReviews(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		reviews, err := a.ListSelfReviews()
		writeJSON(w, r, reviews, err)
	}
}

// handleCreateSelfReview opens a sitting. 201 with the sitting; an empty
// set is a 409 (spec-valid, semantically nothing to sit over), an unknown
// key a 404 off the central ladder.
func handleCreateSelfReview(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in review.CreateInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		created, err := a.CreateSelfReview(in)
		if writeError(w, r, err) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(created)
	}
}

func handleGetSelfReview(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewIDFromPath(w, r)
		if !ok {
			return
		}
		got, err := a.GetSelfReview(id)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, got, nil)
	}
}

func handleUpdateSelfReview(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewIDFromPath(w, r)
		if !ok {
			return
		}
		var in review.UpdateInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		updated, err := a.UpdateSelfReview(id, in)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, updated, nil)
	}
}

// handleDeleteSelfReview removes the sitting and its blocks. Idempotent.
func handleDeleteSelfReview(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewIDFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.DeleteSelfReview(id)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetSelfReviewMatches replaces the sitting's set (PUT of the whole
// list). A note on a match that leaves goes with it.
func handleSetSelfReviewMatches(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewIDFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			MatchKeys []string `json:"match_keys"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		updated, err := a.SetSelfReviewMatches(id, body.MatchKeys)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, updated, nil)
	}
}

// handleFinishSelfReview is POST /completion — no verb in the path, the
// same shape as /coach/session/export. Idempotent; returns the sitting.
func handleFinishSelfReview(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewIDFromPath(w, r)
		if !ok {
			return
		}
		done, err := a.FinishSelfReview(id)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, done, nil)
	}
}

// handlePutSelfReviewNote saves the sitting's note about one match — the
// coach note's body shape, so the room's editor speaks one language.
func handlePutSelfReviewNote(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewIDFromPath(w, r)
		if !ok {
			return
		}
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var in coach.NoteInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		note, err := a.PutSelfReviewNote(id, matchKey, in)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, note, nil)
	}
}

// handleDeleteSelfReviewNote removes the note and its moments. Idempotent.
func handleDeleteSelfReviewNote(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewIDFromPath(w, r)
		if !ok {
			return
		}
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.DeleteSelfReviewNote(id, matchKey)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handlePutSelfReviewMoment saves one moment on the sitting's note about a
// match; the id is in the path because the client mints it. A malformed
// clock or a tag outside the vocabulary is a 400; a spec-valid body that
// says nothing is a 409, like ErrEmptyAnnotation.
func handlePutSelfReviewMoment(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewIDFromPath(w, r)
		if !ok {
			return
		}
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var in matchedit.MomentInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		moment, err := a.PutSelfReviewMoment(id, matchKey, r.PathValue("moment_id"), in)
		if writeError(w, r, err,
			errStatus{app.ErrInvalidMoment, probInvalidBody},
			errStatus{app.ErrMomentEmpty, probConflict}) {
			return
		}
		writeJSON(w, r, moment, nil)
	}
}

// handleDeleteSelfReviewMoment removes one moment. Idempotent.
func handleDeleteSelfReviewMoment(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewIDFromPath(w, r)
		if !ok {
			return
		}
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.DeleteSelfReviewMoment(id, matchKey, r.PathValue("moment_id"))) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
