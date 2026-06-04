package cmd

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"recall/pkg/db/dbtest"
)

// Handler-level coverage for the suppress-list routes.
//
//   - POST   /api/v1/screenshots/{filename}/ignore  → 204; row in set
//   - DELETE /api/v1/screenshots/{filename}/ignore  → 204; idempotent
//   - GET    /api/v1/screenshots/ignored            → 200; sorted list
//
// Mirrors the pattern from server_matches_test.go.

func TestPostScreenshotsIgnore_AddsAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := fire(t, mux, http.MethodPost, "/api/v1/screenshots/foo.png/ignore", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	got, _ := fs.LoadIgnoredFilenames()
	if !got["foo.png"] {
		t.Errorf("filename not added to suppress-list; got=%v", got)
	}
}

func TestPostScreenshotsIgnore_URLEncodedFilename(t *testing.T) {
	// OW capture filenames carry spaces and dots — confirm the
	// path-unescape branch handles them.
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := fire(t, mux, http.MethodPost,
		"/api/v1/screenshots/Overwatch%202026.05.10%20-%2021.29.28.01_summary.png/ignore", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	got, _ := fs.LoadIgnoredFilenames()
	want := "Overwatch 2026.05.10 - 21.29.28.01_summary.png"
	if !got[want] {
		t.Errorf("filename not decoded; got=%v", got)
	}
}

func TestDeleteScreenshotsIgnore_RemovesAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_ = fs.AddIgnoredScreenshot("toggle.png")
	_, mux := newTestApp(t, fs)

	rec := del(t, mux, "/api/v1/screenshots/toggle.png/ignore")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	got, _ := fs.LoadIgnoredFilenames()
	if got["toggle.png"] {
		t.Errorf("filename still present after DELETE; got=%v", got)
	}
}

func TestDeleteScreenshotsIgnore_NotPresent_StillReturns204(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := del(t, mux, "/api/v1/screenshots/never-was-here.png/ignore")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (idempotent)", rec.Code)
	}
}

func TestGetScreenshotsIgnored_ReturnsSortedList(t *testing.T) {
	fs := dbtest.New()
	for _, f := range []string{"zoo.png", "alpha.png", "middle.png"} {
		_ = fs.AddIgnoredScreenshot(f)
	}
	_, mux := newTestApp(t, fs)
	rec := get(t, mux, "/api/v1/screenshots/ignored")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got []string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := []string{"alpha.png", "middle.png", "zoo.png"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestGetScreenshotsIgnored_EmptyIsEmptyArray(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	rec := get(t, mux, "/api/v1/screenshots/ignored")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// Empty slice must marshal as [] not null per the API arrays-
	// are-not-null rule.
	if body := strings.TrimSpace(rec.Body.String()); body != "[]" {
		t.Errorf("got body %q, want []", body)
	}
}

// Defense-in-depth: schema-violating filenames must be rejected at
// the handler boundary, not silently 204'd. The ignored_screenshots
// row is currently a SQL identifier (no FS access), but future code
// paths that paste the filename into a path inherit the safe
// constraint by default.
func TestPostScreenshotsIgnore_RejectsPathSeparators(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	// "%2F" decodes to "/", "%5C" to "\\". Both must be rejected.
	for _, encoded := range []string{
		"foo%2Fbar.png",       // forward slash
		"foo%5Cbar.png",       // backslash
		"foo%00bar.png",       // NUL byte
		"%2E%2E%2Fpasswd.png", // ../passwd via %2E + %2F
	} {
		rec := fire(t, mux, http.MethodPost, "/api/v1/screenshots/"+encoded+"/ignore", nil)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("encoded=%q: status = %d, want 400 (schema-violating filename must reject)", encoded, rec.Code)
		}
	}
}
