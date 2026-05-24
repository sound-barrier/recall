package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// ScreenshotHandler is a CodeQL-flagged path-injection sink. The five
// rejection branches and the happy path are exercised here in isolation
// — no real HTTP server, just httptest.NewRecorder against the handler
// the App returns. Tests in this file set a.settings.ScreenshotsDir
// directly (the test is in package app) to avoid touching real on-disk
// settings via SetScreenshotsDir/saveSettings.

// setupDirWithFile returns a tempdir containing one file (`name`,
// with the given contents). t.TempDir() handles cleanup.
func setupDirWithFile(t *testing.T, name, contents string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return dir
}

// fire dispatches a GET to handler and returns the recorder.
func fire(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	h.ServeHTTP(rec, req)
	return rec
}

func TestScreenshotHandler_HappyPath_ServesConfiguredFile(t *testing.T) {
	dir := setupDirWithFile(t, "shot.png", "fake-png-bytes")
	a := &App{}
	a.settings.ScreenshotsDir = dir

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/shot.png")

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "fake-png-bytes" {
		t.Errorf("body: got %q, want %q", got, "fake-png-bytes")
	}
}

func TestScreenshotHandler_RejectsPathOutsidePrefix(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	// Anything not under /_screenshot/ should 404 — the handler shouldn't
	// pretend to know about other paths.
	rec := fire(t, a.ScreenshotHandler(), "/totally/unrelated/path.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsMalformedURLEscape(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	// %ZZ is not a valid URL escape sequence. httptest.NewRequest itself
	// rejects such a URL at parse time, so build a syntactically-valid
	// request and then plant the bad escape on URL.Path directly — that
	// reproduces what an attacker could send by hand.
	req := httptest.NewRequest(http.MethodGet, "/_screenshot/placeholder.png", nil)
	req.URL.Path = "/_screenshot/%ZZ.png"
	rec := httptest.NewRecorder()
	a.ScreenshotHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", rec.Code)
	}
}

func TestScreenshotHandler_RejectsPathTraversalDotDot(t *testing.T) {
	// Even with a fixture file present elsewhere on disk, ".." in the
	// requested name must short-circuit to 404 before any filesystem
	// resolution happens.
	dir := setupDirWithFile(t, "shot.png", "fake-png-bytes")
	a := &App{}
	a.settings.ScreenshotsDir = dir

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/..")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404 (got body %q)", rec.Code, rec.Body.String())
	}
}

func TestScreenshotHandler_RejectsForwardSlashInName(t *testing.T) {
	// A URL-encoded / would unescape to a separator inside the name —
	// the explicit ContainsAny('/\\') guard blocks both directions
	// before filepath.Join can be tricked into resolving elsewhere.
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/foo%2Fbar.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsBackslashInName(t *testing.T) {
	// Same guard as the forward-slash test, for Windows separators.
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/foo%5Cbar.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsEmptyName(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsWhenScreenshotsDirUnconfigured(t *testing.T) {
	// Fresh App on first launch — no directory chosen yet. The handler
	// must refuse to serve anything rather than fall through to a
	// filesystem root.
	a := &App{}

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/anything.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_ReturnsNotFoundForMissingFile(t *testing.T) {
	// Directory exists but the requested file doesn't — http.ServeFile
	// handles this and returns 404. Just confirms the handler doesn't
	// blow up.
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/missing.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}
