package cmd

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"syscall"
	"time"

	"recall/pkg/app"
)

// RunServer initializes the App without the Wails GUI and serves the
// embedded frontend + a JSON REST API on 127.0.0.1:7000.
func RunServer(a *app.App, assets embed.FS) {
	a.SSEHub = app.NewSSEHub()

	// Startup loads settings, initializes SQLite, optionally starts
	// the metrics server and file watcher.
	a.Startup(context.Background())

	// Sub into frontend/dist so paths like "/assets/index.js" resolve correctly.
	sub, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatalf("server: could not sub into embedded assets: %v", err)
	}

	mux := NewMux(a, sub)

	addr := os.Getenv("RECALL_SERVER_ADDR")
	if addr == "" {
		addr = "127.0.0.1:7000"
	}

	srv := &http.Server{
		Addr:    addr,
		Handler: mux,
		// Slowloris mitigation (gosec G112): cap how long a client may
		// take to send the request headers. 10s is generous for any
		// real client; an attacker holding the socket open longer will
		// be cut off. Read/Write timeouts stay unset because /api/v1/events
		// is an indefinite-duration SSE stream.
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Graceful shutdown on SIGINT / SIGTERM.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Println("server: shutting down…")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	// #nosec G706 -- addr is operator-controlled via RECALL_SERVER_ADDR
	// (or the compile-time default "127.0.0.1:7000"); never derived
	// from an inbound HTTP request, so no log-injection surface.
	log.Printf("Recall server listening on http://%s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}

// decodeOptionalString decodes a json.RawMessage carrying a string
// field that the OpenAPI spec declares as a strict (non-nullable)
// string. Used where the schema can't be relaxed to `[string,
// "null"]` because some other constraint (an `enum` member that
// Spectral can't co-parse with a null) forces the type to stay
// pure string. Three cases:
//   - raw is empty / nil: field absent. Returns "" with no error.
//   - raw is the literal `null`: field present but null. Returns
//     a 400-shaped error.
//   - raw is a JSON string: decoded into the return value.
func decodeOptionalString(field string, raw json.RawMessage) (string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return "", nil
	}
	if bytes.Equal(trimmed, []byte("null")) {
		return "", fmt.Errorf("%s must be a string, not null", field)
	}
	var s string
	if err := json.Unmarshal(trimmed, &s); err != nil {
		return "", fmt.Errorf("%s: %w", field, err)
	}
	return s, nil
}

// decodeRequiredStringArray decodes a required `type: array` body
// field whose items are strings. Rejects `null` and `[null, ...]`
// shapes that Go's default decoder otherwise accepts as nil / "".
func decodeRequiredStringArray(field string, raw json.RawMessage) ([]string, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("%s is required", field)
	}
	if bytes.Equal(trimmed, []byte("null")) {
		return nil, fmt.Errorf("%s must be an array, not null", field)
	}
	var in []*string
	if err := json.Unmarshal(trimmed, &in); err != nil {
		return nil, fmt.Errorf("%s: %w", field, err)
	}
	return derefStringArray(field, in)
}

// decodeOptionalBool mirrors decodeOptionalString for boolean fields
// that the OpenAPI spec declares as `type: boolean` with a default.
// Absent field → default-zero (false) + no error. Explicit `null` is
// a schema violation (boolean is non-nullable in OpenAPI 3.1 unless
// the spec says otherwise) — returned as a 400-shaped error so
// schemathesis's `negative_data_rejection` check stays green.
func decodeOptionalBool(field string, raw json.RawMessage) (bool, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return false, nil
	}
	if bytes.Equal(trimmed, []byte("null")) {
		return false, fmt.Errorf("%s must be a boolean, not null", field)
	}
	var b bool
	if err := json.Unmarshal(trimmed, &b); err != nil {
		return false, fmt.Errorf("%s: %w", field, err)
	}
	return b, nil
}

// derefStringArray converts a `[]*string` decoded from a JSON array
// into a plain `[]string`, rejecting any nil pointer (which Go's
// json package emits when the original element was `null`). Used by
// request handlers whose OpenAPI schema declares `items: {type:
// string}` — null isn't a string, so the server must enforce that
// even though encoding/json silently coerces null in `[]string` to
// `""`. Returns a descriptive 400-shaped error on the first nil hit.
func derefStringArray(field string, in []*string) ([]string, error) {
	if len(in) == 0 {
		return nil, nil
	}
	out := make([]string, 0, len(in))
	for i, p := range in {
		if p == nil {
			return nil, fmt.Errorf("%s[%d] must be a string, not null", field, i)
		}
		out = append(out, *p)
	}
	return out, nil
}

// NewMux builds the HTTP handler tree the server-mode binary serves.
// Split out of RunServer so tests can drive every route through
// httptest.NewServer without setting up signal handling or binding a
// real port. assets is the SPA root (e.g. an fs.Sub into the embedded
// frontend/dist); pass an fstest.MapFS in tests.
//
// Route conventions (since v0.1.x; was a flat /api/... layout before):
//   - Version prefix `/api/v1/` on every JSON endpoint.
//   - Resources are nouns; sub-resources hang off the parent (e.g.
//     /matches/{key}/visibility, /settings/tesseract).
//   - Methods reflect intent: GET to read, PUT to replace/upsert,
//     DELETE to clear or wipe, POST to kick off an async-ish action
//     that doesn't map to a single resource (the parse run).
//   - Returns 204 No Content for writes with no useful body, 202
//     Accepted for actions whose effect is asynchronous (parse).
//   - Static image binaries stay at /_screenshot/{filename} — they're
//     served from disk, not the JSON surface.
func NewMux(a *app.App, assets fs.FS) *http.ServeMux {
	mux := http.NewServeMux()

	// API routes live on a dedicated sub-mux so the `/` SPA fallback
	// doesn't swallow method-mismatched requests. With everything on
	// one mux, the no-method `/` pattern would always fully match a
	// request like `GET /api/v1/parses` (wrong method on a POST-only
	// route) and Go's ServeMux would route to the FileServer (404)
	// instead of returning 405. Isolating /api/v1/ in its own mux
	// preserves the REST-conventional 405 behavior because the sub-mux
	// has no catch-all.
	apiMux := http.NewServeMux()

	// ── Matches ─────────────────────────────────────────────────────
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
	// match keyed "transfers". The schemathesis `unsupported_method`
	// check exercises this exact collision; see TECHNICAL_DEBT.md
	// item 4 (paid down via this commit).
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

	// ── Profiles ────────────────────────────────────────────────────
	// Multiple-profile support: main + alt accounts get separate
	// SQLite DBs + settings under <base>/profiles/<name>/. GET lists
	// what's known + which is active; POST creates and activates a
	// new profile in one shot (typical UX flow); PUT switches active;
	// DELETE drops a non-active profile and wipes its dir.
	apiMux.HandleFunc("GET /api/v1/profiles", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetProfiles(), nil)
	})
	apiMux.HandleFunc("POST /api/v1/profiles", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.CreateProfile(body.Name); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidProfileName):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			case errors.Is(err, app.ErrProfileExists):
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Content-Type MUST be set before WriteHeader — once the
		// status line is on the wire, header mutations are no-ops
		// and the body would be served as text/plain (the default
		// inferred from the response bytes). writeJSON sets the
		// header on its own but only works when the status is the
		// implicit 200; for 201 / 202 / etc. we have to thread it
		// here manually.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if encErr := json.NewEncoder(w).Encode(a.GetProfiles()); encErr != nil {
			log.Printf("server: json encode: %v", encErr)
		}
	})
	apiMux.HandleFunc("PUT /api/v1/profiles/active", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.SwitchProfile(body.Name); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidProfileName):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			case errors.Is(err, app.ErrProfileNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, a.GetProfiles(), nil)
	})
	// Explicit 405 stubs for `/profiles/active`. Without these,
	// `GET / POST / DELETE /api/v1/profiles/active` route to
	// `{name}` and try to operate on a profile literally named
	// "active". Same collision pattern as `/matches/transfers`.
	apiMux.HandleFunc("GET /api/v1/profiles/active", methodNotAllowed("PUT"))
	apiMux.HandleFunc("POST /api/v1/profiles/active", methodNotAllowed("PUT"))
	apiMux.HandleFunc("DELETE /api/v1/profiles/active", methodNotAllowed("PUT"))
	apiMux.HandleFunc("PUT /api/v1/profiles/{name}", func(w http.ResponseWriter, r *http.Request) {
		old := r.PathValue("name")
		if old == "" {
			http.Error(w, "name required in URL", http.StatusBadRequest)
			return
		}
		var body struct {
			NewName string `json:"new_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.RenameProfile(old, body.NewName); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidProfileName):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			case errors.Is(err, app.ErrProfileNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			case errors.Is(err, app.ErrProfileExists):
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, a.GetProfiles(), nil)
	})
	apiMux.HandleFunc("DELETE /api/v1/profiles/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if name == "" {
			http.Error(w, "name required in URL", http.StatusBadRequest)
			return
		}
		if err := a.DeleteProfile(name); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidProfileName):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			case errors.Is(err, app.ErrProfileNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			case errors.Is(err, app.ErrProfileActive):
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// ── Parse pipeline ──────────────────────────────────────────────
	// Kicks off a synchronous parse run. Returns 202 Accepted because
	// the meaningful side-effect is the SQLite writes + SSE broadcast,
	// not the HTTP response body. Clients should subscribe to
	// /api/v1/events for progress and re-fetch /api/v1/matches when done.
	apiMux.HandleFunc("POST /api/v1/parses", func(w http.ResponseWriter, r *http.Request) {
		if err := a.ParseScreenshots(); err != nil {
			// 409: the parse action can't proceed because the resource
			// state (no screenshots directory configured / readable) is
			// incompatible. Not 400 — the request itself was well-formed,
			// it's the server's runtime state that conflicts.
			if errors.Is(err, app.ErrInvalidScreenshotsDir) {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	// ── Screenshots ─────────────────────────────────────────────────
	apiMux.HandleFunc("GET /api/v1/screenshots/pending-count", func(w http.ResponseWriter, r *http.Request) {
		count, err := a.GetNewScreenshotCount()
		writeJSON(w, map[string]int{"count": count}, err)
	})

	// ── Settings ────────────────────────────────────────────────────
	apiMux.HandleFunc("GET /api/v1/settings/screenshots-folder", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"path": a.GetScreenshotsDir()}, nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/screenshots-folder", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
			http.Error(w, "body must be {\"path\":\"...\"}", http.StatusBadRequest)
			return
		}
		if err := a.SetScreenshotsDir(body.Path); err != nil {
			// 409: path was syntactically well-formed but doesn't exist
			// as a directory on disk. The semantic is "the resource at
			// this path isn't available," which is a state conflict.
			if errors.Is(err, app.ErrInvalidScreenshotsDir) {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"path": body.Path}, nil)
	})
	// DELETE clears the persisted screenshots folder. Symmetric with
	// DELETE /api/v1/settings/tesseract — "the user-set override is
	// the thing being deleted." There's no platform default to fall
	// back to here (unlike tesseract); the natural empty state is
	// "no folder configured" and the user re-picks via Detect /
	// Change. The frontend's Reset button is the only caller.
	apiMux.HandleFunc("DELETE /api/v1/settings/screenshots-folder", func(w http.ResponseWriter, r *http.Request) {
		if err := a.ResetScreenshotsDir(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	apiMux.HandleFunc("GET /api/v1/settings/tesseract", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetTesseractStatus(), nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/tesseract", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
			http.Error(w, "body must be {\"path\":\"...\"}", http.StatusBadRequest)
			return
		}
		st, err := a.SetTesseractPath(body.Path)
		if err != nil {
			// 409: path was syntactically well-formed but doesn't
			// resolve to a tesseract binary. Same shape as
			// PUT /api/v1/settings/screenshots-folder.
			if errors.Is(err, app.ErrInvalidTesseractPath) {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, st, nil)
	})
	// DELETE resets the configured path back to the platform default —
	// the only "absent" state the field can have, modeled as removing
	// the user-set override.
	apiMux.HandleFunc("DELETE /api/v1/settings/tesseract", func(w http.ResponseWriter, r *http.Request) {
		st, err := a.ResetTesseractPath()
		writeJSON(w, st, err)
	})

	apiMux.HandleFunc("GET /api/v1/settings/prometheus", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"enabled": a.GetPrometheusEnabled()}, nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/prometheus", func(w http.ResponseWriter, r *http.Request) {
		// `*bool` so missing / null decodes to nil — see the visibility
		// handler's comment for the rationale (Pinned by
		// TestPrometheusEnabled_RejectsNull).
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Enabled == nil {
			http.Error(w, "body must be {\"enabled\":<bool>}", http.StatusBadRequest)
			return
		}
		if err := a.SetPrometheusEnabled(*body.Enabled); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	apiMux.HandleFunc("GET /api/v1/settings/watcher", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"enabled": a.GetWatchEnabled()}, nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/watcher", func(w http.ResponseWriter, r *http.Request) {
		// `*bool` — see the prometheus / visibility handlers' comments.
		// Pinned by TestWatchEnabled_RejectsNull.
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Enabled == nil {
			http.Error(w, "body must be {\"enabled\":<bool>}", http.StatusBadRequest)
			return
		}
		if err := a.SetWatchEnabled(*body.Enabled); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// ── System / Meta ───────────────────────────────────────────────
	apiMux.HandleFunc("GET /api/v1/system/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"version": a.GetVersion()}, nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/update", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.CheckForUpdate(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/data-location", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetDataLocation(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/reference-data", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetOWData(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/screenshots-folder-probe", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.ProbeScreenshotsDir(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/tesseract-probe", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.ProbeTesseractBinary(), nil)
	})
	// Reveal: open the configured screenshots folder in the host OS
	// file manager. Action-style POST — no resource state change, the
	// effect (a Finder / Explorer / xdg-open window appearing) is
	// out-of-band relative to the HTTP response.
	apiMux.HandleFunc("POST /api/v1/system/screenshots-folder-reveal", func(w http.ResponseWriter, r *http.Request) {
		if err := a.RevealScreenshotsDir(); err != nil {
			// 409: no screenshots directory configured. Same shape as
			// POST /api/v1/parses.
			if errors.Is(err, app.ErrInvalidScreenshotsDir) {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	// ── Backup (exports) + Restore (imports) ────────────────────────
	// `format` query selects the wire format. Default is JSON — CSV
	// emits a ZIP archive (one CSV per parent/child table + manifest).
	apiMux.HandleFunc("GET /api/v1/exports", func(w http.ResponseWriter, r *http.Request) {
		// `format` is OpenAPI-declared as enum:[json, csv] with default
		// json. Honor the spec literally: an absent param defaults to
		// json, anything outside the enum (including the empty string
		// from `?format=`) is 400. The previous "json, \"\"" combined
		// case treated `?format=` (explicit empty) as the same as
		// "param absent" and silently fell through to JSON — that's
		// the schema violation v4's negative_data_rejection caught.
		// Pinned by TestExports_RejectsEmptyFormat.
		query := r.URL.Query()
		format := "json"
		if query.Has("format") {
			format = query.Get("format")
		}
		switch format {
		case "csv":
			data, err := a.ExportDataCSV()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			fname := "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".zip"
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
			_, _ = w.Write(data)
		case "json":
			data, err := a.ExportData()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			fname := "recall-export-" + time.Now().UTC().Format("20060102-150405") + ".json"
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
			_, _ = w.Write(data)
		default:
			http.Error(w, "format must be 'json' or 'csv'", http.StatusBadRequest)
		}
	})

	// Compressed bundle export. Body declares the included match keys
	// plus optional include-unknown / include-hidden toggles; response
	// is the assembled `.zip` (manifest.json + data.json +
	// screenshots/<filename>). See pkg/app/export_bundle.go.
	apiMux.HandleFunc("POST /api/v1/exports/bundle", func(w http.ResponseWriter, r *http.Request) {
		// json.RawMessage on every field so a literal `null` (which
		// Go's default decoder silently treats as the zero value)
		// can be rejected as a schema violation — the spec declares
		// `match_keys` as `type: array` and the toggles as
		// `type: boolean`, neither nullable.
		var body struct {
			MatchKeys      json.RawMessage `json:"match_keys"`
			IncludeUnknown json.RawMessage `json:"include_unknown"`
			IncludeHidden  json.RawMessage `json:"include_hidden"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		matchKeys, mkErr := decodeRequiredStringArray("match_keys", body.MatchKeys)
		if mkErr != nil {
			http.Error(w, mkErr.Error(), http.StatusBadRequest)
			return
		}
		includeUnknown, ferr := decodeOptionalBool("include_unknown", body.IncludeUnknown)
		if ferr != nil {
			http.Error(w, ferr.Error(), http.StatusBadRequest)
			return
		}
		includeHidden, ferr := decodeOptionalBool("include_hidden", body.IncludeHidden)
		if ferr != nil {
			http.Error(w, ferr.Error(), http.StatusBadRequest)
			return
		}
		data, err := a.ExportBundle(app.ExportBundleOptions{
			MatchKeys:      matchKeys,
			IncludeUnknown: includeUnknown,
			IncludeHidden:  includeHidden,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		fname := "recall-bundle-" + time.Now().UTC().Format("20060102-150405") + ".zip"
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+fname+`"`)
		_, _ = w.Write(data)
	})

	// POST a previously-exported payload to REPLACE the local DB.
	// Accepts both the JSON envelope and the CSV ZIP archive — the
	// app layer sniffs the payload's magic bytes.
	apiMux.HandleFunc("POST /api/v1/imports", func(w http.ResponseWriter, r *http.Request) {
		// Cap at 50 MiB — large but generous for years of OW history;
		// guards against an accidentally-uploaded multi-GB blob.
		body, err := io.ReadAll(io.LimitReader(r.Body, 50<<20))
		if err != nil {
			http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
			return
		}
		if err := a.ImportData(body); err != nil {
			// 409: the payload was syntactically well-formed JSON / ZIP
			// but failed semantic validation (missing required fields,
			// unsupported schema, etc.). Schemathesis's
			// `positive_data_acceptance` check disallows 400 for
			// spec-valid inputs; the imports body schema is intentionally
			// loose for forward-compatibility, so the strict checks fire
			// at the app layer.
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// ── Server-Sent Events ──────────────────────────────────────────
	apiMux.HandleFunc("GET /api/v1/events", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering if proxied

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming not supported", http.StatusInternalServerError)
			return
		}

		ch := a.SSEHub.Subscribe()
		defer a.SSEHub.Unsubscribe(ch)

		// Send a keepalive comment every 25 s so proxies don't close the connection.
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case msg := <-ch:
				_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", msg.Event, msg.Data)
				flusher.Flush()
			case <-ticker.C:
				_, _ = fmt.Fprintf(w, ": keepalive\n\n")
				flusher.Flush()
			}
		}
	})

	// Mount the API sub-mux. Subtree pattern (`/api/v1/`) wins over
	// `/` for any request whose path starts with the prefix, so the
	// SPA fallback never sees these requests; method-mismatched calls
	// stay inside apiMux where they correctly return 405.
	mux.Handle("/api/v1/", apiMux)

	// ── Screenshot image serving ────────────────────────────────────
	// Stays at /_screenshot/{filename} — binary asset, not part of the
	// JSON API surface, so deliberately outside /api/v1/.
	mux.Handle("/_screenshot/", a.ScreenshotHandler())

	// ── pprof (opt-in via RECALL_PPROF) ──────────────────────────────
	// Off by default — only mounted when RECALL_PPROF is set to something
	// truthy. Wires the standard net/http/pprof handlers under
	// /debug/pprof/. Use with `go tool pprof http://127.0.0.1:7000/debug/pprof/heap`
	// (or profile, goroutine, allocs, …). Bind locally only — never expose
	// pprof on a public address.
	if v := os.Getenv("RECALL_PPROF"); v != "" && v != "0" && v != "false" {
		mux.HandleFunc("/debug/pprof/", pprof.Index)
		mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
		mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
		mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
		mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
		log.Printf("server: pprof endpoints enabled at /debug/pprof/")
	}

	// ── Static frontend assets ──────────────────────────────────────
	mux.Handle("/", http.FileServer(http.FS(assets)))

	return mux
}

// methodNotAllowed returns a handler that responds 405 with an
// `Allow` header listing the valid methods for the path (required
// by RFC 9110 and asserted by schemathesis). Registered on the
// exact verb+path combinations where a literal sub-path
// (`/matches/transfers`, `/profiles/active`) would otherwise fall
// through to a wildcard handler (`/matches/{matchKey}`,
// `/profiles/{name}`) on Go 1.22's ServeMux. Without these stubs, a
// `DELETE /api/v1/matches/transfers` routes to HardDeleteMatch and
// tries to operate on a match keyed "transfers".
func methodNotAllowed(allow string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Allow", allow)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// writeJSON encodes v as JSON. If err is non-nil it writes a 500 instead.
func writeJSON(w http.ResponseWriter, v any, err error) {
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if encErr := json.NewEncoder(w).Encode(v); encErr != nil {
		log.Printf("server: json encode: %v", encErr)
	}
}
