// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"recall/pkg/app"
	"recall/pkg/applog"
)

// RunServer initializes the App without the Wails GUI and serves the
// embedded frontend + a JSON REST API on 127.0.0.1:7000.
func RunServer(a *app.App, assets embed.FS) {
	a.SSEHub = app.NewSSEHub()

	// Startup loads settings, initializes SQLite, optionally starts
	// the metrics server and file watcher. Failures are captured on
	// the App via StartupError() rather than panic-style log.Fatal;
	// we check + exit cleanly so the user sees a human-readable
	// message instead of a stack trace.
	a.Startup(context.Background())
	if err := a.StartupError(); err != nil {
		log.Fatalf("Recall server failed to start: %v", err)
	}

	// Sub into frontend/dist so paths like "/assets/index.js" resolve correctly.
	sub, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatalf("server: could not sub into embedded assets: %v", err)
	}

	// Wrap the entire mux: request-ID for traceability, then the
	// security hardening layer (request-body size caps + nosniff
	// header) so every inbound request (API + screenshot handler +
	// SPA fallback) is covered.
	mux := withRequestID(withSecurityHardening(NewMux(a, sub)))

	addr := os.Getenv("RECALL_SERVER_ADDR")
	if addr == "" {
		addr = "127.0.0.1:7000"
	}

	// pprof (RECALL_PPROF) exposes heap / goroutine / profile dumps
	// with no auth. It's a deliberate opt-in, but combining it with a
	// non-loopback bind makes those dumps reachable from the LAN —
	// warn loudly so an operator who set both notices.
	if pprofEnabled() && !isLoopbackBind(addr) {
		applog.Subsystem("server").Warn(
			"pprof is enabled (RECALL_PPROF) on a non-loopback address — heap/goroutine/profile dumps are reachable from the network without auth; bind RECALL_SERVER_ADDR to 127.0.0.1 or unset RECALL_PPROF",
			"addr", addr,
		)
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
	logger := applog.Subsystem("server")
	go func() {
		<-quit
		logger.Info("shutting down")
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
	}()

	// #nosec G706 -- addr is operator-controlled via RECALL_SERVER_ADDR
	// (or the compile-time default "127.0.0.1:7000"); never derived
	// from an inbound HTTP request, so no log-injection surface.
	logger.Info("listening", "url", "http://"+addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("listen failed", "err", err)
		os.Exit(1)
	}
}

// decodeRequiredString decodes a one-field JSON body of the shape
// `{"<field>":"<value>"}` and rejects empty / absent / null values
// uniformly. Used by simple PUT setters that take exactly one
// non-empty string (`/settings/screenshots-folder`,
// `/settings/tesseract`). The returned error is the same
// 400-shaped message regardless of whether the JSON failed to
// decode or the field was empty — both shapes are spec-violating
// the same way ("body must be {<field>: \"…\"}").
//
// Use `decodeOptionalString` (below) for fields that are part of a
// larger body and may legitimately be absent.
func decodeRequiredString(r *http.Request, field string) (string, error) {
	// Decode into json.RawMessage so unrelated extra fields with
	// non-string values don't break the decode — `additionalProperties:
	// true` is the default in OpenAPI 3.1 and schemathesis exercises
	// it heavily.
	body := map[string]json.RawMessage{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return "", fmt.Errorf("body must be {%q:\"...\"}", field)
	}
	raw, ok := body[field]
	if !ok {
		return "", fmt.Errorf("body must be {%q:\"...\"}", field)
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return "", fmt.Errorf("body must be {%q:\"...\"}", field)
	}
	v = strings.TrimSpace(v)
	if v == "" {
		return "", fmt.Errorf("body must be {%q:\"...\"}", field)
	}
	return v, nil
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
	// Every /api/v1/matches/... route registers in server_matches.go.
	registerMatchRoutes(apiMux, a)

	// ── Profiles ────────────────────────────────────────────────────
	// All /api/v1/profiles/... routes register in server_profiles.go.
	registerProfileRoutes(apiMux, a)

	// ── Parse pipeline + screenshot inventory ──────────────────────
	// POST /api/v1/parses + GET /api/v1/screenshots/pending-count
	// register in server_pipeline.go.
	registerPipelineRoutes(apiMux, a)

	// ── Screenshots suppress-list ──────────────────────────────────
	// POST/DELETE /api/v1/screenshots/{filename}/ignore +
	// GET /api/v1/screenshots/ignored register in
	// server_screenshots.go. Mounted after the pipeline so the
	// /screenshots/ prefix routes resolve consistently.
	registerScreenshotRoutes(apiMux, a)

	// ── Settings ────────────────────────────────────────────────────
	// All /api/v1/settings/... routes register in server_settings.go.
	registerSettingsRoutes(apiMux, a)

	// ── System / Meta ───────────────────────────────────────────────
	// All /api/v1/system/... routes register in server_system.go.
	registerSystemRoutes(apiMux, a)

	// ── Backup (exports) + Restore (imports) ────────────────────────
	// /api/v1/exports + /api/v1/exports/bundle + /api/v1/imports
	// register in server_backup.go.
	registerBackupRoutes(apiMux, a)

	// ── Server-Sent Events ──────────────────────────────────────────
	// /api/v1/events registers in server_events.go.
	registerEventsRoutes(apiMux, a)

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
	if pprofEnabled() {
		mux.HandleFunc("/debug/pprof/", pprof.Index)
		mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
		mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
		mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
		mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
		applog.Subsystem("server").Info("pprof endpoints enabled", "prefix", "/debug/pprof/")
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
// through to a wildcard handler (`/matches/{match_key}`,
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
		applog.Subsystem("server").Error("json encode", "err", encErr)
	}
}
