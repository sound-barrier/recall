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
		if err := a.HardDeleteMatch(matchKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
			http.Error(w, "match not found", http.StatusNotFound)
			return
		}
		writeJSON(w, rec, err)
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
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if body.Hidden == nil {
			http.Error(w, "body must be {\"hidden\":<bool>}", http.StatusBadRequest)
			return
		}
		var err error
		if *body.Hidden {
			err = a.HideMatch(matchKey)
		} else {
			err = a.UnhideMatch(matchKey)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.ResolveAmbiguousMatch(matchKey, body.ResolvedTo); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidAmbiguousKey),
				errors.Is(err, app.ErrAmbiguousNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			case errors.Is(err, app.ErrInvalidResolution):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
			http.Error(w, "read body: "+rErr.Error(), http.StatusBadRequest)
			return
		}
		if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			http.Error(w, "body must be a JSON object, not null", http.StatusBadRequest)
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
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		leaver, lErr := decodeOptionalString("leaver", body.Leaver)
		if lErr != nil {
			http.Error(w, lErr.Error(), http.StatusBadRequest)
			return
		}
		members, mErr := derefStringArray("members", body.Members)
		if mErr != nil {
			http.Error(w, mErr.Error(), http.StatusBadRequest)
			return
		}
		tags, tErr := derefStringArray("tags", body.Tags)
		if tErr != nil {
			http.Error(w, tErr.Error(), http.StatusBadRequest)
			return
		}
		if err := a.SetMatchAnnotation(app.AnnotationInput{
			MatchKey:   matchKey,
			Leaver:     leaver,
			Note:       body.Note,
			ReplayCode: body.ReplayCode,
			Members:    members,
			Tags:       tags,
		}); err != nil {
			if errors.Is(err, app.ErrInvalidLeaver) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.SetMatchReview(matchKey, body.ReviewedBy); err != nil {
			if errors.Is(err, app.ErrInvalidReviewedBy) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
		if err := a.ClearMatchReview(matchKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.SetMatchQueue(matchKey, body.QueueType); err != nil {
			if errors.Is(err, app.ErrInvalidQueueType) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
		if err := a.ClearMatchQueue(matchKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.SetMatchPlayMode(matchKey, body.PlayMode); err != nil {
			if errors.Is(err, app.ErrInvalidPlayMode) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
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
		if err := a.ClearMatchPlayMode(matchKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
