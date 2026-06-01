//go:build !serveronly

package cmd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// screenshotsMiddleware is the only Wails-specific runtime shim that
// has its own dispatch logic — the rest of the file delegates to
// Wails. Coverage here protects against a regression where dev-mode
// `wails dev` lets `/_screenshot/...` requests fall through to the
// Vite proxy (which would resolve them to `index.html` and corrupt
// the image previews — TECHNICAL_DEBT.md item 13).

func TestScreenshotsMiddleware_ShortCircuitsToHandler(t *testing.T) {
	screenshots := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Source", "screenshots")
		_, _ = io.WriteString(w, "image-bytes")
	})
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		// In dev mode this would be the Vite proxy returning index.html.
		w.Header().Set("X-Source", "vite-fallback")
		_, _ = io.WriteString(w, "<!doctype html>")
	})

	mw := screenshotsMiddleware(screenshots)
	handler := mw(next)

	req := httptest.NewRequest(http.MethodGet, "/_screenshot/match_2026-05-10T22-21-11.png", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if got := rr.Header().Get("X-Source"); got != "screenshots" {
		t.Errorf("X-Source = %q, want %q — request should have short-circuited", got, "screenshots")
	}
	if body := rr.Body.String(); body != "image-bytes" {
		t.Errorf("body = %q, want %q", body, "image-bytes")
	}
}

func TestScreenshotsMiddleware_PassesThroughOtherPaths(t *testing.T) {
	screenshots := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatalf("screenshot handler should NOT have been called for non-/_screenshot/ paths")
	})
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Source", "vite-fallback")
	})

	handler := screenshotsMiddleware(screenshots)(next)
	for _, path := range []string{
		"/",
		"/index.html",
		"/assets/index-abc.js",
		"/api/v1/matches",
		"/_screenshot", // no trailing slash — must NOT match
	} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)
			if got := rr.Header().Get("X-Source"); got != "vite-fallback" {
				t.Errorf("path %q: X-Source = %q, want vite-fallback (request should pass through)", path, got)
			}
		})
	}
}

func TestScreenshotsMiddleware_PrefixMatchesNestedPaths(t *testing.T) {
	// `/_screenshot/<filename>` is the canonical shape but the
	// per-screenshot-dir URL form `/_screenshot/<dir-id>/<filename>`
	// (introduced when screenshots_dirs landed) MUST also short-
	// circuit. The middleware matches by prefix, so a regression
	// that switched to a fixed `r.URL.Path == "/_screenshot/"` check
	// would silently break per-dir URLs.
	var got string
	screenshots := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		got = r.URL.Path
	})
	next := http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		t.Fatalf("dir-scoped screenshot path leaked to next handler")
	})
	handler := screenshotsMiddleware(screenshots)(next)
	req := httptest.NewRequest(http.MethodGet, "/_screenshot/3/Overwatch_2026-05-10.png", nil)
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if !strings.HasSuffix(got, "/3/Overwatch_2026-05-10.png") {
		t.Errorf("screenshot handler saw path %q, want suffix /3/Overwatch_2026-05-10.png", got)
	}
}
