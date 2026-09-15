// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net/http"
	"net/http/pprof"
	"os"
	"os/signal"
	"strconv"
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
		defer applog.RecoverPanic("server")
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

// decodeJSONBody decodes the request body into dst, the way every handler
// that reads a JSON body should.
//
// It exists because JSON Schema and encoding/json disagree about what an
// integer is. `{"interval_days": 7.0}` is a valid `type: integer` in JSON
// Schema — the type describes the VALUE, and 7.0 has no fractional part —
// so api/openapi.yaml advertises it as acceptable and every client
// generated from that spec is entitled to send it. encoding/json looks at
// the SPELLING instead and refuses a decimal point into an `int`, so the
// server answered 400 to requests its own contract calls valid. A
// JavaScript caller hits this by accident (JSON.stringify of a Number is
// free to write either), which is how a generated client can be wrong
// without anyone writing a wrong line.
//
// So an integral number is normalized to its integer spelling before the
// decode. A genuinely fractional value (7.5) is left exactly as written and
// still fails against an `int` field, because that one really is a type
// error. Values too large for int64 are left alone for the same reason.
func decodeJSONBody(r *http.Request, dst any) error {
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	return decodeJSONBytes(raw, dst)
}

// decodeJSONBytes is decodeJSONBody for a handler that already holds the
// body — the ones that read it first to tell a literal `null` from an absent
// field. Same contract: an integral number decodes wherever an integer is
// expected, however it was spelled.
func decodeJSONBytes(raw []byte, dst any) error {
	// UseNumber keeps every number as its literal text, so a value that
	// needs no rewriting round-trips byte-for-byte.
	var tree any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&tree); err != nil {
		return err
	}
	normalized, changed := normalizeIntegralFloats(tree)
	if !changed {
		return json.Unmarshal(raw, dst)
	}
	rewritten, err := json.Marshal(normalized)
	if err != nil {
		return err
	}
	return json.Unmarshal(rewritten, dst)
}

// normalizeIntegralFloats rewrites every number whose value is a whole one
// but whose spelling is not (7.0, 7e0) into its integer form, anywhere in
// the document — nested objects and arrays included, since the generated
// body that first exposed this carried its float inside `heroes[]`. The
// bool reports whether anything changed, so an untouched body can be
// decoded from its original bytes.
func normalizeIntegralFloats(v any) (any, bool) {
	switch t := v.(type) {
	case map[string]any:
		changed := false
		for key, val := range t {
			next, c := normalizeIntegralFloats(val)
			if c {
				t[key] = next
				changed = true
			}
		}
		return t, changed
	case []any:
		changed := false
		for i, val := range t {
			next, c := normalizeIntegralFloats(val)
			if c {
				t[i] = next
				changed = true
			}
		}
		return t, changed
	case json.Number:
		return integerSpelling(t)
	default:
		return v, false
	}
}

// integerSpelling returns n written as a plain integer when its value is a
// whole number that int64 can hold, and reports whether it rewrote it.
func integerSpelling(n json.Number) (json.Number, bool) {
	text := n.String()
	if !strings.ContainsAny(text, ".eE") {
		return n, false // already an integer spelling
	}
	f, err := strconv.ParseFloat(text, 64)
	if err != nil || f != math.Trunc(f) || math.IsInf(f, 0) {
		return n, false
	}
	// Outside int64 the rewrite would lose the value, and the field it is
	// headed for can't hold it either — leave it for the decoder to reject.
	if f < math.MinInt64 || f > math.MaxInt64 {
		return n, false
	}
	return json.Number(strconv.FormatInt(int64(f), 10)), true
}

// decodeRequiredString decodes a one-field JSON body of the shape
// `{"<field>":"<value>"}` and rejects empty / absent / null values
// uniformly. Used by simple PUT setters that take exactly one
// non-empty string (`/settings/screenshots-folder`,
// `/settings/tesseract`). The returned error is the same
// 400-shaped message regardless of whether the JSON failed to
// decode or the field was empty — both shapes are spec-violating
// the same way ("body must be {<field>: \"…\"}").
func decodeRequiredString(r *http.Request, field string) (string, error) {
	// Decode into json.RawMessage so unrelated extra fields with
	// non-string values don't break the decode — `additionalProperties:
	// true` is the default in OpenAPI 3.1 and schemathesis exercises
	// it heavily.
	body := map[string]json.RawMessage{}
	if err := decodeJSONBody(r, &body); err != nil {
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
	if err := decodeJSONBytes(trimmed, &in); err != nil {
		return nil, fmt.Errorf("%s: %w", field, err)
	}
	return derefStringArray(field, in)
}

// decodeOptionalBool is decodeRequiredString's boolean sibling, for fields
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
	if err := decodeJSONBytes(trimmed, &b); err != nil {
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
	apiMux := newAPIMux(a)

	// ── Server-Sent Events ──────────────────────────────────────────
	// /api/v1/events registers in server_events.go — server mode only.
	// See newAPIMux for why the desktop asset-server path must never
	// mount it.
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
	// Attachments the app owns, addressed by content digest. A sibling of the
	// screenshot route rather than part of it: that one resolves a filename
	// inside a directory the user chose, this one looks up bytes we stored.
	mux.Handle(app.MomentImagePrefix(), a.MomentImageHandler())

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

// newAPIMux builds the /api/v1/ sub-mux shared by RunServer's NewMux and
// the desktop asset-server middleware (wails.go). It deliberately EXCLUDES
// the /api/v1/events SSE route: the Wails asset server on Windows buffers
// the whole response body and only delivers it when the handler returns —
// Flush() is a no-op and the request context is never canceled — so a
// streaming handler hangs the webview request and leaks its goroutine.
// a.SSEHub is also only assigned in RunServer, so Subscribe() would panic
// on the desktop path. Desktop events ride the Wails event bus instead;
// NewMux mounts registerEventsRoutes on top of this mux for the HTTP/SSE
// contract. Any future streaming endpoint must follow the same
// server-only registration pattern.
func newAPIMux(a *app.App) *http.ServeMux {
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

	// ── Coaching ────────────────────────────────────────────────────
	// /api/v1/coach/... + /api/v1/settings/coaching + the per-match
	// coach-notes DELETE register in server_coach.go.
	registerCoachRoutes(apiMux, a)

	// ── Self review ─────────────────────────────────────────────────
	// /api/v1/self-reviews… — the player's own saved review sittings.
	// Registers in server_self_review.go.
	registerSelfReviewRoutes(apiMux, a)
	registerFocusRoutes(apiMux, a)
	registerRosterRoutes(apiMux, a)

	// ── Test-harness-only routes ────────────────────────────────────
	// No-op unless RECALL_E2E=1 (the Playwright e2e harness). Never in
	// production. See server_test_reset.go.
	registerE2ERoutes(apiMux, a)

	return apiMux
}

// methodNotAllowed returns a handler that responds 405 with an
// `Allow` header listing the valid methods for the path (required
// by RFC 9110 and asserted by schemathesis).
func methodNotAllowed(allow string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Allow", allow)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// standardMethods is every method a client might plausibly send: RFC 9110's
// eight, plus PATCH.
var standardMethods = []string{
	http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut,
	http.MethodPatch, http.MethodDelete, http.MethodConnect,
	http.MethodOptions, http.MethodTrace,
}

// registerLiteralPath answers `path` on every method except `live`, which the
// caller registers itself. Two things need this.
//
// A literal sub-path (`/matches/transfers`, `/profiles/active`) sits under a
// wildcard (`/matches/{match_key}`, `/profiles/{name}`), and the literal only
// wins on the methods actually registered for it — so without a stub,
// `DELETE /api/v1/matches/transfers` routes to HardDeleteMatch and tries to
// hard-delete a match keyed "transfers".
//
// The full sweep, rather than a stub per colliding verb, is about the `Allow`
// header. Go's ServeMux synthesizes its own 405 for a method nothing is
// registered for, and that response advertises every method that IS
// registered — stubs included. So three stubs meant `OPTIONS
// /api/v1/matches/play-mode` answered `Allow: DELETE, GET, HEAD, POST, PUT`:
// four methods the resource refuses, promised to any client that asked what it
// could do. Covering the whole method set means the mux's synthesized 405
// never fires here and every answer carries the one true verb.
func registerLiteralPath(mux *http.ServeMux, path, live string) {
	for _, method := range standardMethods {
		if method == live {
			continue
		}
		mux.HandleFunc(method+" "+path, methodNotAllowed(live))
	}
}
