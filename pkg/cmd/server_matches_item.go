package cmd

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"regexp"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/matchedit"
	"recall/pkg/parser"
)

// Per-{match_key} sub-resource handlers for the /api/v1/matches family.
// Wired in registerMatchRoutes (server_matches.go). Each reads the key
// via matchKeyFromPath, which 400s on an empty segment.

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

// handleSetMatchPin stars / unstars a match — the visibility
// endpoint's twin over the pinned_matches sidecar. `Pinned *bool` for
// the same missing-vs-false reason (see handleSetMatchVisibility).
func handleSetMatchPin(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var body struct {
			Pinned *bool `json:"pinned"`
		}
		if err := decodeJSONBody(r, &body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if body.Pinned == nil {
			writeProblem(w, r, probInvalidBody, "body must be {\"pinned\":<bool>}",
				withFieldErrors(fieldError{"pinned", "must be a boolean"}))
			return
		}
		var err error
		if *body.Pinned {
			err = a.PinMatch(matchKey)
		} else {
			err = a.UnpinMatch(matchKey)
		}
		if writeError(w, r, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
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
		if err := decodeJSONBody(r, &body); err != nil {
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
		if err := decodeJSONBody(r, &body); err != nil {
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
// decodeAnnotationInput reads the annotation PUT body into the input the app
// takes, writing the problem response itself and reporting false when it
// cannot. Split out of the handler so the handler reads as decode → apply →
// 204; every early return here has already answered the request.
func decodeAnnotationInput(w http.ResponseWriter, r *http.Request, matchKey string) (app.AnnotationInput, bool) {
	// `[]*string` so `members: [null]` and `tags: [null]` decode
	// to a pointer slice with nil entries — distinguishable from
	// the empty-string "" the plain `[]string` form yields. The
	// OpenAPI spec declares items: { type: string }; null isn't
	// a string and must be rejected. Pinned by
	// TestMatchAnnotations_RejectsNullInTags +
	// TestMatchAnnotations_RejectsNullInMembers.
	//
	// Read the raw body first so we can reject `null` (which Go's
	// json silently decodes into the zero-value struct, then the
	// SetMatchAnnotation "all-empty → delete" rule kicks in and
	// the server returns 204 — schema-violating behavior
	// schemathesis v4's negative_data_rejection catches).
	raw, rErr := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if rErr != nil {
		writeProblem(w, r, probInvalidBody, "read body: "+rErr.Error())
		return app.AnnotationInput{}, false
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		writeProblem(w, r, probInvalidBody, "body must be a JSON object, not null")
		return app.AnnotationInput{}, false
	}
	var body struct {
		Leavers         []*string `json:"leavers"`
		Throwers        []*string `json:"throwers"`
		Note            string    `json:"note"`
		ReplayCode      string    `json:"replay_code"`
		Members         []*string `json:"members"`
		Tags            []*string `json:"tags"`
		ExclusionReason string    `json:"exclusion_reason"`
	}
	if err := decodeJSONBytes(raw, &body); err != nil {
		writeProblem(w, r, probInvalidBody, "invalid JSON body")
		return app.AnnotationInput{}, false
	}
	// Every list field rejects a null MEMBER (`["team", null]`) with a
	// per-field error rather than silently dropping it to "".
	var leavers, throwers, members, tags []string
	for _, f := range []struct {
		name string
		in   []*string
		out  *[]string
	}{
		{"leavers", body.Leavers, &leavers},
		{"throwers", body.Throwers, &throwers},
		{"members", body.Members, &members},
		{"tags", body.Tags, &tags},
	} {
		v, err := derefStringArray(f.name, f.in)
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error(), withFieldErrors(fieldError{f.name, err.Error()}))
			return app.AnnotationInput{}, false
		}
		*f.out = v
	}
	return app.AnnotationInput{
		MatchKey:        matchKey,
		Leavers:         leavers,
		Throwers:        throwers,
		Note:            body.Note,
		ReplayCode:      body.ReplayCode,
		Members:         members,
		Tags:            tags,
		ExclusionReason: body.ExclusionReason,
	}, true
}

func handleSetMatchAnnotation(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		in, ok := decodeAnnotationInput(w, r, matchKey)
		if !ok {
			return
		}
		if writeError(w, r, a.SetMatchAnnotation(in),
			errStatus{app.ErrInvalidLeaver, probInvalidBody},
			errStatus{app.ErrInvalidThrower, probInvalidBody},
			errStatus{app.ErrInvalidReplayCode, probInvalidBody},
			// Spec-valid body (parses fine) but no content to upsert → 409, the
			// codebase's "semantic validation" code. 400 would trip schemathesis's
			// positive_data_acceptance ("spec-valid input → no 400").
			errStatus{app.ErrEmptyAnnotation, probConflict}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetMatchMoment saves one of the player's own timestamped moments. The
// moment id is in the path rather than the body because the client mints it —
// the editor keys its save on that id from the first keystroke.
func handleSetMatchMoment(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var in matchedit.MomentInput
		if err := decodeJSONBody(r, &in); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		saved, err := a.SetMatchMoment(matchKey, r.PathValue("moment_id"), in)
		// A malformed clock, empty text or a tag outside the vocabulary is a
		// 400; an id already used on another match is a 409, because the body
		// is spec-valid and the conflict is with what is already stored.
		if writeError(w, r, err,
			errStatus{app.ErrInvalidMoment, probInvalidBody},
			// Spec-valid but says nothing → 409, like ErrEmptyAnnotation.
			errStatus{app.ErrMomentEmpty, probConflict},
			errStatus{db.ErrMomentMatchMismatch, probConflict}) {
			return
		}
		writeJSON(w, r, match.CoachNoteMoment{
			MomentID:    saved.MomentID,
			MatchClock:  saved.MatchClock,
			Text:        saved.Text,
			FocusTag:    saved.FocusTag,
			ImageSHA256: saved.ImageSHA256,
		}, nil)
	}
}

// handleDeleteMatchMoment removes one of the player's moments. Idempotent.
func handleDeleteMatchMoment(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.DeleteMatchMoment(matchKey, r.PathValue("moment_id"))) {
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
		if err := decodeJSONBytes(raw, &input); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if writeError(w, r, a.UpdateMatchData(matchKey, input),
			errStatus{app.ErrInvalidResult, probInvalidBody},
			errStatus{app.ErrStatOutOfRange, probInvalidBody},
			errStatus{app.ErrDuplicateHeroPosition, probInvalidBody},
			errStatus{app.ErrUnknownMap, probConflict},
			errStatus{app.ErrUnknownHero, probConflict}) {
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
		if err := decodeJSONBody(r, &body); err != nil {
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
		if err := decodeJSONBody(r, &body); err != nil {
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
		if err := decodeJSONBody(r, &body); err != nil {
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

// noContentForKey answers a bodyless per-match write — the sidecar removals
// and the reference-gap acknowledgement, whose resource is the row itself:
// the key from the path, act on it, 204. Each act's contract is on the *App
// method it names.
func noContentForKey(act func(matchKey string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, act(matchKey)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// fieldPathPattern mirrors the FieldPath parameter's pattern and length in
// api/openapi.yaml: the data vocabulary, lower-case, with the space and dot
// a stored hero key can carry ("soldier 76", "d.va").
var fieldPathPattern = regexp.MustCompile(`^data(\.[a-z0-9_ ]+)+$`)

const maxFieldPathLen = 200

// matchKeyAndField reads the key and a field path in the data vocabulary
// from the path, answering the 400 itself when the field is not one.
func matchKeyAndField(w http.ResponseWriter, r *http.Request) (string, parser.FieldPath, bool) {
	matchKey, ok := matchKeyFromPath(w, r)
	if !ok {
		return "", "", false
	}
	field := r.PathValue("field")
	if len(field) > maxFieldPathLen || !fieldPathPattern.MatchString(field) {
		writeProblem(w, r, probInvalidBody, "field must be a data path such as data.eliminations")
		return "", "", false
	}
	return matchKey, parser.FieldPath(field), true
}

// handleConfirmFieldReading confirms a flagged reading. The body's value is
// the one the client showed the user, a precondition only: the server stores
// the value the match reads now, and refuses (409) when a parse has changed
// it in between.
func handleConfirmFieldReading(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, field, ok := matchKeyAndField(w, r)
		if !ok {
			return
		}
		var body struct {
			Value *string `json:"value"`
		}
		if err := decodeJSONBody(r, &body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if body.Value == nil {
			writeProblem(w, r, probInvalidBody, `body must be {"value":<the value shown>}`,
				withFieldErrors(fieldError{"value", "must be a string"}))
			return
		}
		err := a.ConfirmFieldReading(matchKey, field, *body.Value)
		if writeError(w, r, err, errStatus{app.ErrNothingToConfirm, probConflict}, errStatus{app.ErrReadingChanged, probConflict}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleUnconfirmFieldReading re-opens a confirmed reading; the confirmation
// is the resource, so DELETE carries no body.
func handleUnconfirmFieldReading(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, field, ok := matchKeyAndField(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.UnconfirmFieldReading(matchKey, field)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
