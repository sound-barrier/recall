package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"recall/pkg/app"
	"recall/pkg/match"
)

// registerMatchRoutes attaches every /api/v1/matches/... handler to
// apiMux. New routes under this resource family go in this file
// (collection + bulk handlers) or server_matches_item.go (the
// per-{match_key} sub-resource handlers), not in NewMux.
func registerMatchRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/matches", handleGetMatches(a))
	apiMux.HandleFunc("DELETE /api/v1/matches", handleClearMatches(a))
	apiMux.HandleFunc("POST /api/v1/matches", handleCreateManualMatch(a))
	apiMux.HandleFunc("POST /api/v1/matches/transfers", handleMoveMatches(a))

	// Explicit 405 stubs for `/matches/transfers`. Without these,
	// `GET / PUT / DELETE /api/v1/matches/transfers` route to the
	// {match_key} wildcard handler (the literal segment only wins on
	// the methods we register) — DELETE would try to hard-delete a
	// match keyed "transfers".
	apiMux.HandleFunc("GET /api/v1/matches/transfers", methodNotAllowed("POST"))
	apiMux.HandleFunc("PUT /api/v1/matches/transfers", methodNotAllowed("POST"))
	apiMux.HandleFunc("DELETE /api/v1/matches/transfers", methodNotAllowed("POST"))

	// Same 405 stub pattern for the bulk endpoints — without
	// these, GET /api/v1/matches/play-mode would resolve to the
	// {match_key} wildcard with matchKey="play-mode" and return 404.
	// (Schemathesis's unsupported_method check expects 405.)
	apiMux.HandleFunc("GET /api/v1/matches/play-mode", methodNotAllowed("PUT"))
	apiMux.HandleFunc("POST /api/v1/matches/play-mode", methodNotAllowed("PUT"))
	apiMux.HandleFunc("DELETE /api/v1/matches/play-mode", methodNotAllowed("PUT"))
	apiMux.HandleFunc("GET /api/v1/matches/queue", methodNotAllowed("PUT"))
	apiMux.HandleFunc("POST /api/v1/matches/queue", methodNotAllowed("PUT"))
	apiMux.HandleFunc("DELETE /api/v1/matches/queue", methodNotAllowed("PUT"))

	// Per-{match_key} sub-resource handlers live in server_matches_item.go.
	apiMux.HandleFunc("DELETE /api/v1/matches/{match_key}", handleHardDeleteMatch(a))
	apiMux.HandleFunc("GET /api/v1/matches/{match_key}", handleGetMatchByKey(a))
	apiMux.HandleFunc("PUT /api/v1/matches/{match_key}/visibility", handleSetMatchVisibility(a))
	apiMux.HandleFunc("PUT /api/v1/matches/{match_key}/resolution", handleResolveMatch(a))
	apiMux.HandleFunc("PUT /api/v1/matches/{match_key}/annotation", handleSetMatchAnnotation(a))
	apiMux.HandleFunc("DELETE /api/v1/matches/{match_key}/annotation", handleDeleteMatchAnnotation(a))
	apiMux.HandleFunc("PUT /api/v1/matches/{match_key}/data", handleUpdateMatchData(a))
	apiMux.HandleFunc("DELETE /api/v1/matches/{match_key}/data", handleResetMatchData(a))
	apiMux.HandleFunc("PUT /api/v1/matches/{match_key}/review", handleSetMatchReview(a))
	apiMux.HandleFunc("DELETE /api/v1/matches/{match_key}/review", handleClearMatchReview(a))
	apiMux.HandleFunc("PUT /api/v1/matches/{match_key}/queue", handleSetMatchQueue(a))
	apiMux.HandleFunc("DELETE /api/v1/matches/{match_key}/queue", handleClearMatchQueue(a))
	apiMux.HandleFunc("PUT /api/v1/matches/{match_key}/play-mode", handleSetMatchPlayMode(a))
	apiMux.HandleFunc("DELETE /api/v1/matches/{match_key}/play-mode", handleClearMatchPlayMode(a))

	apiMux.HandleFunc("PUT /api/v1/matches/queue", handleBulkSetMatchQueue(a))
	apiMux.HandleFunc("PUT /api/v1/matches/play-mode", handleBulkSetMatchPlayMode(a))
}

// matchKeyFromPath reads the {match_key} path value and 400s when it is
// empty. On failure the response is already written, so the caller just
// returns. Shared by every per-{match_key} handler.
func matchKeyFromPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	matchKey := r.PathValue("match_key")
	if matchKey == "" {
		writeProblem(w, r, probInvalidBody, "match_key required in URL")
		return "", false
	}
	return matchKey, true
}

func handleGetMatches(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		limit, cursor, pErr := parseMatchesPaginationStrict(r)
		if pErr != nil {
			writeProblem(w, r, probInvalidBody, pErr.Error())
			return
		}
		rows, err := a.GetMatchResults()
		if err != nil {
			writeJSON(w, r, rows, err)
			return
		}
		if limit > 0 || cursor != "" {
			rows = applyMatchesPagination(rows, limit, cursor)
		}
		writeJSON(w, r, rows, nil)
	}
}

func handleClearMatches(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
				writeProblem(w, r, probInvalidBody, "unknown query parameter: "+k)
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
				writeProblem(w, r, probInvalidBody, "keep_ignored must be true or false")
				return
			}
		}
		if writeError(w, r, a.ClearDatabase(keepIgnored)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleCreateManualMatch hand-enters a match for users without OCR. Derives
// the match_key from played_at (default now), 409s on a collision with any
// existing match, writes the override + queue / play-mode rows, and returns the
// created MatchRecord (source: manual).
func handleCreateManualMatch(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input match.ManualMatchInput
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		rec, err := a.CreateManualMatch(input)
		if writeError(w, r, err,
			errStatus{app.ErrManualNeedsMap, probInvalidBody},
			errStatus{app.ErrManualNeedsHero, probInvalidBody},
			errStatus{app.ErrInvalidResult, probInvalidBody},
			errStatus{app.ErrInvalidPlayMode, probInvalidBody},
			errStatus{app.ErrInvalidQueueType, probInvalidBody},
			errStatus{app.ErrInvalidPlayedAt, probInvalidBody},
			errStatus{app.ErrInvalidLeaver, probInvalidBody},
			errStatus{app.ErrInvalidRank, probInvalidBody},
			errStatus{app.ErrUnknownMap, probConflict},
			errStatus{app.ErrUnknownHero, probConflict},
			errStatus{app.ErrMatchKeyExists, probConflict}) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(rec)
	}
}

// handleMoveMatches bulk-moves matches to another profile. The endpoint
// takes a list of match_keys + the target profile name and transfers
// every matching row (across all 5 parent tables) + annotation + hidden
// flag into the target's SQLite DB, then hard-deletes the source. See
// pkg/app/profile_move.go for the two-phase rationale.
func handleMoveMatches(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if body.TargetProfile == nil {
			writeProblem(w, r, probInvalidBody, "target_profile must be a non-null string")
			return
		}
		matchKeys, mkErr := derefStringArray("match_keys", body.MatchKeys)
		if mkErr != nil {
			writeProblem(w, r, probInvalidBody, mkErr.Error())
			return
		}
		// ErrInvalidProfileName → 409: target_profile was a well-formed
		// string but didn't pass the profile-name format validator.
		if writeError(w, r, a.MoveMatches(matchKeys, *body.TargetProfile),
			errStatus{app.ErrInvalidProfileName, probConflict},
			errStatus{app.ErrProfileNotFound, probNotFound},
			errStatus{app.ErrMoveTargetIsActive, probConflict}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleBulkSetMatchQueue writes a queue-type to many matches at once.
// Body: {"match_keys": [...], "queue_type": "role"|"open"|""}. Empty
// string clears the rows (bulk Clear). One SQL transaction so a partial
// mid-write crash leaves the table consistent; the per-match PUT/DELETE
// endpoints are still the right shape for one-off toggles, this endpoint
// exists so the sticky "set 47 selected matches" toolbar doesn't fire 47
// PUTs and pay 47 commit round-trips.
func handleBulkSetMatchQueue(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			MatchKeys []string `json:"match_keys"`
			QueueType string   `json:"queue_type"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if writeError(w, r, a.BulkSetMatchQueue(body.MatchKeys, body.QueueType),
			errStatus{app.ErrInvalidQueueType, probInvalidBody}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleBulkSetMatchPlayMode is the play-mode counterpart of
// handleBulkSetMatchQueue. Body: {"match_keys": [...], "play_mode":
// "quickplay"|"competitive"|""}.
func handleBulkSetMatchPlayMode(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			MatchKeys []string `json:"match_keys"`
			PlayMode  string   `json:"play_mode"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if writeError(w, r, a.BulkSetMatchPlayMode(body.MatchKeys, body.PlayMode),
			errStatus{app.ErrInvalidPlayMode, probInvalidBody}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
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
		return 0, "", errors.New("limit must be an integer in [1, 1000], got empty value")
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
func applyMatchesPagination(rows []match.MatchRecord, limit int, cursor string) []match.MatchRecord {
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
		return []match.MatchRecord{}
	}
	tail := rows[start:]
	if limit > 0 && len(tail) > limit {
		tail = tail[:limit]
	}
	return tail
}
