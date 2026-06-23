package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"recall/pkg/app"
	"recall/pkg/match"
)

// Per-{match_key} sub-resource handlers for the /api/v1/matches family.
// Wired in registerMatchRoutes (server_matches.go). Each reads the key
// via matchKeyFromPath, which 400s on an empty segment.

// handleHardDeleteMatch removes every parent row + annotation + hidden
// flag for matchKey. Surfaced by the Hidden drawer's "Delete forever"
// affordance once a user has already moved the match to the archive.
// Idempotent: unknown keys return 204.
func handleHardDeleteMatch(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.HardDeleteMatch(matchKey)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleGetMatchByKey reads a single match by key. Reuses
// GetMatchResults's aggregator + read-time inference, then filters to the
// requested key. 404 via the ErrMatchNotFound sentinel keeps the wire
// surface clean (no 500 for an honest "not in the corpus").
func handleGetMatchByKey(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		rec, err := a.GetMatchByKey(matchKey)
		if errors.Is(err, match.ErrMatchNotFound) {
			writeProblem(w, r, probNotFound, "match not found")
			return
		}
		writeJSON(w, r, rec, err)
	}
}

// handleSetMatchVisibility soft-deletes (hides / unhides) a match.
// `hidden: true` adds the match to hidden_matches; `hidden: false`
// removes it. Both are idempotent — repeated identical calls succeed
// without error.
func handleSetMatchVisibility(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		// `Hidden *bool` so a missing or `null` field decodes to nil
		// — distinguishable from `false`. Plain `bool` accepts both
		// `null` and the field being absent as the zero value, which
		// silently fires an Unhide call. Pinned by
		// TestMatchVisibility_RejectsNullHidden.
		var body struct {
			Hidden *bool `json:"hidden"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if body.Hidden == nil {
			writeProblem(w, r, probInvalidBody, "body must be {\"hidden\":<bool>}",
				withFieldErrors(fieldError{"hidden", "must be a boolean"}))
			return
		}
		var err error
		if *body.Hidden {
			err = a.HideMatch(matchKey)
		} else {
			err = a.UnhideMatch(matchKey)
		}
		if writeError(w, r, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleResolveMatch resolves an ambiguous-attribution screenshot by
// attaching every parent row carrying the ambiguous: sentinel to the
// user's chosen match. resolved_to must be one of the recorded
// candidates OR a freshly-minted "match-<ts>" the user wants to
// attribute to a new standalone match (escape hatch when none of the
// candidates is right).
func handleResolveMatch(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			ResolvedTo string `json:"resolved_to"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if writeError(w, r, a.ResolveAmbiguousMatch(matchKey, body.ResolvedTo),
			errStatus{app.ErrInvalidAmbiguousKey, probNotFound},
			errStatus{app.ErrAmbiguousNotFound, probNotFound},
			errStatus{app.ErrInvalidResolution, probInvalidBody}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetMatchAnnotation upserts (or clears) the per-match user
// annotation. When every field is empty the row is deleted entirely —
// idempotent.
func handleSetMatchAnnotation(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		// `[]*string` so `members: [null]` and `tags: [null]` decode
		// to a pointer slice with nil entries — distinguishable from
		// the empty-string "" the plain `[]string` form yields. The
		// OpenAPI spec declares items: { type: string }; null isn't
		// a string and must be rejected. Pinned by
		// TestMatchAnnotations_RejectsNullInTags +
		// TestMatchAnnotations_RejectsNullInMembers.
		//
		// `leaver` is json.RawMessage so we can detect explicit
		// `leaver: null` (spec disallows it because Spectral can't
		// parse a null member mixed into an enum). Plain `string`
		// would silently decode `null` as "" — and "" IS a valid
		// enum value, so the decoder couldn't differentiate.
		// Read the raw body first so we can reject `null` (which Go's
		// json silently decodes into the zero-value struct, then the
		// SetMatchAnnotation "all-empty → delete" rule kicks in and
		// the server returns 204 — schema-violating behaviour
		// schemathesis v4's negative_data_rejection catches).
		raw, rErr := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if rErr != nil {
			writeProblem(w, r, probInvalidBody, "read body: "+rErr.Error())
			return
		}
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			writeProblem(w, r, probInvalidBody, "body must be a JSON object, not null")
			return
		}
		var body struct {
			Leaver     json.RawMessage `json:"leaver"`
			Note       string          `json:"note"`
			ReplayCode string          `json:"replay_code"`
			Members    []*string       `json:"members"`
			Tags       []*string       `json:"tags"`
		}
		if err := json.Unmarshal(raw, &body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		leaver, lErr := decodeOptionalString("leaver", body.Leaver)
		if lErr != nil {
			writeProblem(w, r, probInvalidBody, lErr.Error(), withFieldErrors(fieldError{"leaver", lErr.Error()}))
			return
		}
		members, mErr := derefStringArray("members", body.Members)
		if mErr != nil {
			writeProblem(w, r, probInvalidBody, mErr.Error(), withFieldErrors(fieldError{"members", mErr.Error()}))
			return
		}
		tags, tErr := derefStringArray("tags", body.Tags)
		if tErr != nil {
			writeProblem(w, r, probInvalidBody, tErr.Error(), withFieldErrors(fieldError{"tags", tErr.Error()}))
			return
		}
		if writeError(w, r, a.SetMatchAnnotation(app.AnnotationInput{
			MatchKey:   matchKey,
			Leaver:     leaver,
			Note:       body.Note,
			ReplayCode: body.ReplayCode,
			Members:    members,
			Tags:       tags,
		}),
			errStatus{app.ErrInvalidLeaver, probInvalidBody},
			// Spec-valid body (parses fine) but no content to upsert → 409, the
			// codebase's "semantic validation" code. 400 would trip schemathesis's
			// positive_data_acceptance ("spec-valid input → no 400").
			errStatus{app.ErrEmptyAnnotation, probConflict}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleDeleteMatchAnnotation removes a match's annotation row. This is the
// explicit "clear" verb — PUT is upsert-only and rejects an all-empty body, so
// erasing an annotation is a DELETE. Idempotent: deleting an absent annotation
// still returns 204.
func handleDeleteMatchAnnotation(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.DeleteMatchAnnotation(matchKey)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleUpdateMatchData replaces a match's user-data override set — the editable
// copy kept separate from the parsed OCR rows. Body is the FULL override set; a
// per-field revert is the same request omitting that field. Idempotent.
func handleUpdateMatchData(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		// Reject an explicit `null` body — Go would silently decode it into
		// the zero struct (all-nil overrides) and 204, violating the
		// type:object schema (schemathesis negative_data_rejection).
		raw, rErr := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if rErr != nil {
			writeProblem(w, r, probInvalidBody, "read body: "+rErr.Error())
			return
		}
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			writeProblem(w, r, probInvalidBody, "body must be a JSON object, not null")
			return
		}
		var input match.UserMatchDataInput
		if err := json.Unmarshal(raw, &input); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if writeError(w, r, a.UpdateMatchData(matchKey, input),
			errStatus{app.ErrInvalidResult, probInvalidBody},
			errStatus{app.ErrStatOutOfRange, probInvalidBody},
			errStatus{app.ErrUnknownMap, probConflict},
			errStatus{app.ErrUnknownHero, probConflict}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleResetMatchData clears a match's user override set, reverting an edited
// OCR match to its parsed values. Idempotent.
func handleResetMatchData(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.ResetMatchData(matchKey)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetMatchReview sets the per-match review-status tag: `'self'`
// (user reviewed the VOD themselves) or `'coach'` (a coach reviewed it).
// Idempotent.
func handleSetMatchReview(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			ReviewedBy string `json:"reviewed_by"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if writeError(w, r, a.SetMatchReview(matchKey, body.ReviewedBy),
			errStatus{app.ErrInvalidReviewedBy, probInvalidBody}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleClearMatchReview clears the review tag, reverting to the implicit
// "not reviewed" state. Idempotent.
func handleClearMatchReview(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.ClearMatchReview(matchKey)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetMatchQueue sets the per-match queue-type tag: `'role'` (5v5
// role queue) or `'open'` (6v6 open queue). Idempotent. Drives the
// radiogroup at the top of the match-detail panel and the Queue chip in
// "Narrow this set."
func handleSetMatchQueue(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			QueueType string `json:"queue_type"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if writeError(w, r, a.SetMatchQueue(matchKey, body.QueueType),
			errStatus{app.ErrInvalidQueueType, probInvalidBody}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleClearMatchQueue clears the queue-type tag, reverting to the
// implicit "queue not set" state. Idempotent.
func handleClearMatchQueue(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.ClearMatchQueue(matchKey)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetMatchPlayMode sets the per-match play-mode override:
// `'quickplay'` or `'competitive'` — overriding the parser's data.mode.
// Idempotent.
func handleSetMatchPlayMode(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			PlayMode string `json:"play_mode"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if writeError(w, r, a.SetMatchPlayMode(matchKey, body.PlayMode),
			errStatus{app.ErrInvalidPlayMode, probInvalidBody}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleClearMatchPlayMode clears the play-mode override, reverting to
// the fallback chain (data.mode → rank presence → empty). Idempotent.
func handleClearMatchPlayMode(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.ClearMatchPlayMode(matchKey)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
