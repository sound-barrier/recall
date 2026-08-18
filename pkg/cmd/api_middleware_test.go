//go:build !serveronly

// Package-external tests for the desktop asset-server API middleware: the
// REST mux must short-circuit ahead of the asset pipeline, and the SSE
// route must NOT be mounted on the desktop path — the Windows asset server
// buffers whole responses and never cancels request contexts, so a
// streaming handler would hang the webview request and leak its goroutine.
package cmd_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/cmd"
	"recall/pkg/db/dbtest"
)

// desktopApp builds an *App the way RunWails sees it: fake store and,
// crucially, NO SSEHub — only RunServer assigns one. The events test
// below relies on that nil to prove the desktop path never touches the
// hub.
func desktopApp(t *testing.T) *app.App {
	t.Helper()
	return app.NewWithStore(dbtest.New())
}

func TestAPIMiddleware_ShortCircuitsAPIRequests(t *testing.T) {
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatalf("API request leaked to the asset pipeline")
	})
	handler := cmd.APIMiddleware(cmd.DesktopAPIHandler(desktopApp(t)))(next)

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/system/version", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"version"`) {
		t.Errorf("body = %q, want a {\"version\": ...} JSON object", rec.Body.String())
	}
}

func TestAPIMiddleware_PassesThroughNonAPIPaths(t *testing.T) {
	api := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatalf("non-API path reached the API handler")
	})
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Source", "asset-pipeline")
	})
	handler := cmd.APIMiddleware(api)(next)

	for _, path := range []string{
		"/",
		"/index.html",
		"/assets/index-abc.js",
		"/_screenshot/match.png",
		"/wails/runtime.js",
		"/api/v2/anything",
		"/api/v1", // no trailing slash — not an API route shape
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if got := rec.Header().Get("X-Source"); got != "asset-pipeline" {
				t.Errorf("path %q: X-Source = %q, want asset-pipeline (should pass through)", path, got)
			}
		})
	}
}

func TestAPIMiddleware_EventsNotMountedOnDesktop(t *testing.T) {
	// If /api/v1/events were mounted here, this request would panic in
	// SSEHub.Subscribe (nil hub) — or hang as an indefinite stream inside
	// the buffering Windows asset server. A plain 404 is the contract:
	// desktop events ride the Wails event bus.
	handler := cmd.APIMiddleware(cmd.DesktopAPIHandler(desktopApp(t)))(
		http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
			t.Fatalf("/api/v1/events leaked to the asset pipeline")
		}))

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/events", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET /api/v1/events = %d, want 404 (SSE must stay server-only)", rec.Code)
	}
}

func TestAPIMiddleware_MethodNotAllowedSurvives(t *testing.T) {
	handler := cmd.APIMiddleware(cmd.DesktopAPIHandler(desktopApp(t)))(http.NotFoundHandler())

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/parses", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /api/v1/parses = %d, want 405 (sub-mux semantics must survive the middleware)", rec.Code)
	}
	if rec.Header().Get("Allow") == "" {
		t.Errorf("405 response missing Allow header")
	}
}

func TestDesktopAPIHandler_AppliesServerMiddlewares(t *testing.T) {
	handler := cmd.DesktopAPIHandler(desktopApp(t))

	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/system/version", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("X-Content-Type-Options = %q, want nosniff (hardening parity with RunServer)", got)
	}
	if rec.Header().Get("X-Request-ID") == "" {
		t.Errorf("missing X-Request-ID (request-id parity with RunServer)")
	}
}

// ── A failed startup must not be a segfault ──────────────────────────────

// The route the modal reads. Spelled here rather than imported: the test is
// external, and this is the contract, so it should break if the path moves.
const startupErrorRoute = "/api/v1/system/startup-error"

// brokenApp is the state a real user hits: Startup could not stand the
// database up — an old file this build refuses, or a data dir it cannot
// create — so the failure was captured and a.store was left nil.
// Deliberately not a crash: the app is meant to come up and SHOW the reason.
//
// A real Startup against a data dir that is a FILE, which is the same
// blocker trick server_settings_test.go uses. Not a hand-set flag: the point
// is the state the app actually reaches.
func brokenApp(t *testing.T) *app.App {
	t.Helper()
	blocker := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatalf("write blocker file: %v", err)
	}
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", blocker)

	a := app.New()
	a.Startup(context.Background())
	if a.StartupError() == nil {
		t.Fatal("expected Startup to fail against a data dir that is a file")
	}
	return a
}

// The desktop asset server keeps serving after a failed startup, and the
// frontend boots and calls GET /matches like always. Every handler behind
// that reaches for a.store, which is nil — so the process died on a nil
// dereference inside the aggregate loader, taking the window with it and
// leaving the user a stack trace instead of the message the app captured
// precisely so they would not get one.
//
// Server mode never had this: RunServer checks StartupError and exits with
// the reason. Only the desktop path survives the failure, which is what put
// it one HTTP request away from a segfault.
func TestDesktopAPI_FailedStartupAnswersInsteadOfPanicking(t *testing.T) {
	handler := cmd.APIMiddleware(cmd.DesktopAPIHandler(brokenApp(t)))(http.NotFoundHandler())

	for _, path := range []string{
		"/api/v1/matches",
		"/api/v1/settings",
		"/api/v1/screenshots/ignored",
	} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			// A panic here is the bug: it crashed the process in the real app.
			handler.ServeHTTP(rec, httptest.NewRequestWithContext(
				t.Context(), http.MethodGet, path, nil))

			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503; body=%s", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "application/problem+json") {
				t.Errorf("content-type = %q, want problem+json", ct)
			}
			if !strings.Contains(rec.Body.String(), "not-a-dir") {
				t.Errorf("the reply should carry the reason startup failed, got %s", rec.Body.String())
			}
		})
	}
}

// The one endpoint that must still answer: the modal that tells the user
// what went wrong reads it. Refusing it too would leave a blank window.
func TestDesktopAPI_StartupErrorEndpointStillAnswers(t *testing.T) {
	handler := cmd.APIMiddleware(cmd.DesktopAPIHandler(brokenApp(t)))(http.NotFoundHandler())

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequestWithContext(
		t.Context(), http.MethodGet, startupErrorRoute, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "not-a-dir") {
		t.Errorf("the modal needs the reason, got %s", rec.Body.String())
	}
}
