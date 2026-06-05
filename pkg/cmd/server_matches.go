package cmd

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"recall/pkg/app"
)

// registerMatchRoutes attaches every /api/v1/matches/... handler to
// apiMux. New routes under this resource family go in this file,
// not in NewMux.
func registerMatchRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/matches", func(w http.ResponseWriter, r *http.Request) {
		// Optional pagination — `?limit=N&cursor=KEY` returns at most
		// N records starting AFTER the record whose match_key matches
		// `cursor`. The cursor is the previous page's last match_key;
		// using the existing identity (no separate opaque encoding)
		// keeps the wire shape transparent + lets curl users page
		// without a lookup table. Omitted limit = back-compat (the
		// full corpus, as before). limit is clamped to [1, 1000].
		//
		// Reject unknown query params with 400 so schemathesis's
		// negative_data_rejection check stays green and clients
		// can't silently mis-type `limit` as `Limit`.
		if err := validateMatchesQueryParams(r.URL.Query()); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		limit, cursor, pErr := parseMatchesPaginationStrict(r)
		if pErr != nil {
			http.Error(w, pErr.Error(), http.StatusBadRequest)
			return
		}
		rows, err := a.GetMatchResults()
		if err != nil {
			writeJSON(w, rows, err)
			return
		}
		if limit > 0 || cursor != "" {
			rows = applyMatchesPagination(rows, limit, cursor)
		}
		writeJSON(w, rows, nil)
	})

	apiMux.HandleFunc("DELETE /api/v1/matches", func(w http.ResponseWriter, r *http.Request) {
		// `keep_ignored=true` preserves the Unknown-tab "Delete forever"
		// suppress list across the wipe (Settings → Advanced exposes
		// this as a "Keep suppress-list" checkbox on the Clear Database
		// arm step). Default-off matches the historical "factory reset"
		// semantic. Strict — anything other than "true"/"false"/absent
		// or unknown query keys returns 400, so scripted curl callers
		// can't silently fall through to a different behavior on typo,
		// and schemathesis's coverage-phase negative tests don't
		// require a 204 from a malformed URL.
		for k := range r.URL.Query() {
			if k != "keep_ignored" {
				http.Error(w, "unknown query parameter: "+k, http.StatusBadRequest)
				return
			}
		}
		keepIgnored := false
		// `Query().Has` distinguishes "key absent" (use default) from
		// "key present with empty value" (a malformed boolean — 400).
		if r.URL.Query().Has("keep_ignored") {
			switch r.URL.Query().Get("keep_ignored") {
			case "true":
				keepIgnored = true
			case "false":
				keepIgnored = false
			default:
				http.Error(w, "keep_ignored must be true or false", http.StatusBadRequest)
				return
			}
		}
		if err := a.ClearDatabase(keepIgnored); err != nil {
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

	// Per-match queue-type tag. PUT sets `'role'` (5v5 role queue) or
	// `'open'` (6v6 open queue). DELETE clears the tag, reverting to
	// the implicit "queue not set" state. Both directions are
	// idempotent. Drives the radiogroup at the top of the
	// match-detail panel and the Queue chip in "Narrow this set."
	apiMux.HandleFunc("PUT /api/v1/matches/{matchKey}/queue", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
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
	})
	apiMux.HandleFunc("DELETE /api/v1/matches/{matchKey}/queue", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
			return
		}
		if err := a.ClearMatchQueue(matchKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Per-match play-mode override. PUT sets `'quickplay'` or
	// `'competitive'` — overriding the parser's data.mode. DELETE
	// clears the override, reverting to the fallback chain
	// (data.mode → rank presence → empty). Both directions are
	// idempotent.
	apiMux.HandleFunc("PUT /api/v1/matches/{matchKey}/play-mode", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
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
	})
	apiMux.HandleFunc("DELETE /api/v1/matches/{matchKey}/play-mode", func(w http.ResponseWriter, r *http.Request) {
		matchKey := r.PathValue("matchKey")
		if matchKey == "" {
			http.Error(w, "match_key required in URL", http.StatusBadRequest)
			return
		}
		if err := a.ClearMatchPlayMode(matchKey); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}

// validateMatchesQueryParams rejects any query param the spec doesn't
// declare for GET /api/v1/matches. Keeps schemathesis's
// negative_data_rejection check green AND surfaces client typos
// (`?Limit=10` instead of `?limit=10`) as 400 instead of silently
// ignoring them.
func validateMatchesQueryParams(q map[string][]string) error {
	allowed := map[string]bool{"limit": true, "cursor": true}
	for k := range q {
		if !allowed[k] {
			return fmt.Errorf("unknown query parameter: %q", k)
		}
	}
	return nil
}

// parseMatchesPaginationStrict pulls `limit` + `cursor` and returns
// an error on a malformed limit (non-integer, negative, zero, or
// present-but-empty). An ABSENT `limit` key keeps the back-compat
// unbounded list; a key that's present with an empty or invalid
// value is treated as a schema violation. Used by the HTTP handler;
// the legacy helper below is preserved for the unit tests that pin
// the lenient parsing branch.
//
// The Has-vs-Get distinction matters because the OpenAPI spec says
// `limit: integer, minimum: 1, maximum: 1000`, which rejects empty
// strings. Pre-fix, `?limit=` (key present, value empty) returned
// 200 with the full corpus — schemathesis caught it.
func parseMatchesPaginationStrict(r *http.Request) (int, string, error) {
	q := r.URL.Query()
	cursor := q.Get("cursor")
	if !q.Has("limit") {
		return 0, cursor, nil
	}
	limitStr := q.Get("limit")
	if limitStr == "" {
		return 0, "", fmt.Errorf("limit must be an integer in [1, 1000], got empty value")
	}
	n, err := strconv.Atoi(limitStr)
	if err != nil {
		return 0, "", fmt.Errorf("limit must be an integer, got %q", limitStr)
	}
	if n < 1 {
		return 0, "", fmt.Errorf("limit must be ≥ 1, got %d", n)
	}
	if n > 1000 {
		return 0, "", fmt.Errorf("limit must be ≤ 1000, got %d", n)
	}
	return n, cursor, nil
}

// parseMatchesPagination is the lenient form used by the legacy tests
// (TestGetMatches_InvalidLimit_DisablesPagination etc.). Bad input
// reads as 0 (= "no limit"). Production handler uses the strict
// form so schemathesis's negative_data_rejection check stays green.
func parseMatchesPagination(r *http.Request) (int, string) {
	cursor := r.URL.Query().Get("cursor")
	limitStr := r.URL.Query().Get("limit")
	if limitStr == "" {
		return 0, cursor
	}
	n, err := strconv.Atoi(limitStr)
	if err != nil || n < 1 {
		return 0, cursor
	}
	if n > 1000 {
		n = 1000
	}
	return n, cursor
}

// applyMatchesPagination slices the rows list into a single page:
// drops everything up to + including the row matching `cursor` (if
// set), then returns the next `limit` records. Pre-condition:
// `limit > 0 || cursor != ""`.
func applyMatchesPagination(rows []app.MatchRecord, limit int, cursor string) []app.MatchRecord {
	start := 0
	if cursor != "" {
		for i, r := range rows {
			if r.MatchKey == cursor {
				start = i + 1
				break
			}
		}
	}
	if start >= len(rows) {
		// Never `nil` so the JSON wire shape stays `[]` (the
		// arrays-are-not-null rule in api-design.md).
		return []app.MatchRecord{}
	}
	tail := rows[start:]
	if limit > 0 && len(tail) > limit {
		tail = tail[:limit]
	}
	return tail
}
