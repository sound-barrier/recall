package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"recall/pkg/app"
)

// registerMatchRoutes attaches every /api/v1/matches/... handler to
// apiMux. Extracted out of NewMux to pay down the route-monolith
// debt (TECHNICAL_DEBT.md item 1). Same wire surface as before; no
// behaviour change. New routes under this resource family go in
// this file, not in NewMux.
func registerMatchRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/matches", func(w http.ResponseWriter, r *http.Request) {
		rows, err := a.GetMatchResults()
		writeJSON(w, rows, err)
	})

	apiMux.HandleFunc("DELETE /api/v1/matches", func(w http.ResponseWriter, r *http.Request) {
		if err := a.ClearDatabase(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Bulk move matches to another profile. The endpoint takes a list
	// of match_keys + the target profile name and transfers every
	// matching row (across all 5 parent tables) + annotation + hidden
	// flag into the target's SQLite DB, then hard-deletes the source.
	// See pkg/app/profile_move.go for the two-phase rationale.
	apiMux.HandleFunc("POST /api/v1/matches/transfers", func(w http.ResponseWriter, r *http.Request) {
		// `*string` for target_profile + `[]*string` for match_keys so
		// JSON `null` decodes to a nil-shaped value we can reject —
		// see derefStringArray's doc-comment for the rationale. The
		// schema declares both as required + non-null.
		// Pinned by TestProfiles_PostMatchTransfers_RejectsNullTargetProfile +
		// TestProfiles_PostMatchTransfers_RejectsNullInMatchKeys.
		var body struct {
			MatchKeys     []*string `json:"match_keys"`
			TargetProfile *string   `json:"target_profile"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if body.TargetProfile == nil {
			http.Error(w, "target_profile must be a non-null string", http.StatusBadRequest)
			return
		}
		matchKeys, mkErr := derefStringArray("match_keys", body.MatchKeys)
		if mkErr != nil {
			http.Error(w, mkErr.Error(), http.StatusBadRequest)
			return
		}
		if err := a.MoveMatches(matchKeys, *body.TargetProfile); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidProfileName):
				// 409: target_profile was a well-formed string but didn't
				// pass the profile-name format validator.
				http.Error(w, err.Error(), http.StatusConflict)
				return
			case errors.Is(err, app.ErrProfileNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			case errors.Is(err, app.ErrMoveTargetIsActive):
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Explicit 405 stubs for `/matches/transfers`. Without these,
	// `GET / PUT / DELETE /api/v1/matches/transfers` route to the
	// {matchKey} wildcard handler (the literal segment only wins on
	// the methods we register) — DELETE would try to hard-delete a
	// match keyed "transfers".
	apiMux.HandleFunc("GET /api/v1/matches/transfers", methodNotAllowed("POST"))
	apiMux.HandleFunc("PUT /api/v1/matches/transfers", methodNotAllowed("POST"))
	apiMux.HandleFunc("DELETE /api/v1/matches/transfers", methodNotAllowed("POST"))

	// Hard-delete a single match — every parent row + annotation +
	// hidden flag for matchKey goes. Surfaced by the Hidden drawer's
	// "Delete forever" affordance once a user has already moved the
	// match to the archive. Idempotent: unknown keys return 204.
	apiMux.HandleFunc("DELETE /api/v1/matches/{matchKey}", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
			return
		}
		if err := a.HardDeleteMatch(matchKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Read a single match by key. Reuses GetMatchResults's aggregator
	// + read-time inference, then filters to the requested key. 404
	// via the ErrMatchNotFound sentinel keeps the wire surface clean
	// (no 500 for an honest "not in the corpus").
	apiMux.HandleFunc("GET /api/v1/matches/{matchKey}", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
			return
		}
		rec, err := a.GetMatchByKey(matchKey)
		if errors.Is(err, app.ErrMatchNotFound) {
			http.Error(w, "match not found", http.StatusNotFound)
			return
		}
		writeJSON(w, rec, err)
	})

	// Soft-delete (hide / unhide) a match. `hidden: true` adds the
	// match to hidden_matches; `hidden: false` removes it. Both are
	// idempotent — repeated identical calls succeed without error.
	apiMux.HandleFunc("PUT /api/v1/matches/{matchKey}/visibility", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
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
	})

	// Resolve an ambiguous-attribution screenshot by attaching every
	// parent row carrying the ambiguous: sentinel to the user's chosen
	// match. resolved_to must be one of the recorded candidates OR a
	// freshly-minted "match-<ts>" the user wants to attribute to a
	// new standalone match (escape hatch when none of the candidates
	// is right).
	apiMux.HandleFunc("PUT /api/v1/matches/{matchKey}/resolution", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
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
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Upsert (or clear) the per-match user annotation. When every
	// field is empty the row is deleted entirely — idempotent.
	apiMux.HandleFunc("PUT /api/v1/matches/{matchKey}/annotation", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
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
	})

	// Per-match review-status tag. PUT sets `'self'` (user reviewed
	// the VOD themselves) or `'coach'` (a coach reviewed it). DELETE
	// clears the tag, reverting to the implicit "not reviewed"
	// state. Both directions are idempotent.
	apiMux.HandleFunc("PUT /api/v1/matches/{matchKey}/review", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
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
	})
	apiMux.HandleFunc("DELETE /api/v1/matches/{matchKey}/review", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
			return
		}
		if err := a.ClearMatchReview(matchKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
