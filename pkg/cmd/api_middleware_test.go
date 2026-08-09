//go:build !serveronly

// Package-external tests for the desktop asset-server API middleware: the
// REST mux must short-circuit ahead of the asset pipeline, and the SSE
// route must NOT be mounted on the desktop path — the Windows asset server
// buffers whole responses and never cancels request contexts, so a
// streaming handler would hang the webview request and leak its goroutine.
package cmd_test

import (
	"net/http"
	"net/http/httptest"
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
