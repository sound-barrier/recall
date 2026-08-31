package cmd_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"recall/pkg/db/dbtest"
)

// Handler-level coverage for the suppress-list routes.
//
//   - PUT    /api/v1/screenshots/{filename}/ignore  → 204; row in set
//   - DELETE /api/v1/screenshots/{filename}/ignore  → 204; idempotent
//   - GET    /api/v1/screenshots/ignored            → 200; sorted list
//
// Mirrors the pattern from server_matches_test.go.

func TestPostScreenshotsIgnore_AddsAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := fire(t, mux, http.MethodPut, "/api/v1/screenshots/foo.png/ignore", nil)
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
	rec := fire(t, mux, http.MethodPut,
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

func TestPostScreenshotsIgnore_FilenameWithLiteralPercent(t *testing.T) {
	// Go 1.22's ServeMux URL-decodes path wildcards before
	// `r.PathValue`, so a request URL of `%25` arrives at the
	// handler as a literal `%`. The handler must NOT decode again
	// — schemathesis caught a regression where the inner
	// PathUnescape tried to interpret `%1` (literal percent +
	// digit) as a percent-escape and 400'd a perfectly valid
	// filename. Schema regex `^[^/\\\x00]{1,200}$` admits `%`.
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := fire(t, mux, http.MethodPut,
		"/api/v1/screenshots/odd-%251file.png/ignore", nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body = %q", rec.Code, rec.Body.String())
	}
	got, _ := fs.LoadIgnoredFilenames()
	want := "odd-%1file.png"
	if !got[want] {
		t.Errorf("filename not stored; got=%v want key %q", got, want)
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

func TestGetScreenshotsIgnored_ReturnsRichRows(t *testing.T) {
	fs := dbtest.New()
	for _, f := range []string{"zoo.png", "alpha.png", "middle.png"} {
		_ = fs.AddIgnoredScreenshot(f)
	}
	_, mux := newTestApp(t, fs)
	rec := get(t, mux, "/api/v1/screenshots/ignored")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	type ignoredScreenshot struct {
		Filename  string `json:"filename"`
		IgnoredAt string `json:"ignored_at"`
	}
	var got []ignoredScreenshot
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Three rapid Adds share an RFC3339-second timestamp; tie-break
	// is filename ASC.
	want := []string{"alpha.png", "middle.png", "zoo.png"}
	if len(got) != len(want) {
		t.Fatalf("got %d rows, want %d", len(got), len(want))
	}
	for i, w := range want {
		if got[i].Filename != w {
			t.Errorf("got[%d].Filename = %q, want %q", i, got[i].Filename, w)
		}
		if got[i].IgnoredAt == "" {
			t.Errorf("got[%d].IgnoredAt empty; expected timestamp", i)
		}
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

// DELETE /api/v1/screenshots/ignored — bulk truncate (Settings →
// Advanced → Manage ignored files → Re-enable all action).
func TestDeleteScreenshotsIgnored_BulkTruncate(t *testing.T) {
	fs := dbtest.New()
	for _, f := range []string{"a.png", "b.png", "c.png"} {
		_ = fs.AddIgnoredScreenshot(f)
	}
	_, mux := newTestApp(t, fs)
	rec := del(t, mux, "/api/v1/screenshots/ignored")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	got, _ := fs.LoadIgnoredFilenames()
	if len(got) != 0 {
		t.Errorf("expected suppress-list empty after bulk DELETE; got %v", got)
	}
}

func TestDeleteScreenshotsIgnored_EmptyStillReturns204(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	rec := del(t, mux, "/api/v1/screenshots/ignored")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (idempotent)", rec.Code)
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
		rec := fire(t, mux, http.MethodPut, "/api/v1/screenshots/"+encoded+"/ignore", nil)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("encoded=%q: status = %d, want 400 (schema-violating filename must reject)", encoded, rec.Code)
		}
	}
}

func TestGetScreenshotsFailed_ReturnsLedgerRows(t *testing.T) {
	fs := dbtest.New()
	_ = fs.RecordFailedFile("corrupt.png", 1, "decoding image: png: invalid format")
	_ = fs.RecordFailedFile("corrupt.png", 1, "tesseract failed: exit status 1")
	_, mux := newTestApp(t, fs)
	rec := get(t, mux, "/api/v1/screenshots/failed")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	type failedFile struct {
		Filename      string `json:"filename"`
		Error         string `json:"error"`
		Attempts      int    `json:"attempts"`
		FirstFailedAt string `json:"first_failed_at"`
		LastFailedAt  string `json:"last_failed_at"`
	}
	var got []failedFile
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d rows, want 1", len(got))
	}
	r := got[0]
	if r.Filename != "corrupt.png" || r.Attempts != 2 || r.Error != "tesseract failed: exit status 1" {
		t.Errorf("row = %+v", r)
	}
	if r.FirstFailedAt == "" || r.LastFailedAt == "" {
		t.Errorf("timestamps must be set: %+v", r)
	}
}

// DELETE /api/v1/screenshots/{filename}/failure — Retry: deleting the
// failure row resets attempts and restores the file to the pending set.
func TestDeleteScreenshotsFailed_RemovesRowAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_ = fs.RecordFailedFile("stuck.png", 1, "boom")
	_, mux := newTestApp(t, fs)

	rec := del(t, mux, "/api/v1/screenshots/stuck.png/failure")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if _, still := fs.FailedFiles["stuck.png"]; still {
		t.Errorf("failure row survived DELETE; got=%v", fs.FailedFiles)
	}
}

func TestDeleteScreenshotsFailed_NotPresent_StillReturns204(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	rec := del(t, mux, "/api/v1/screenshots/never-failed.png/failure")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204 (idempotent)", rec.Code)
	}
}

func TestDeleteScreenshotsFailed_RejectsPathSeparators(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	for _, encoded := range []string{"foo%2Fbar.png", "foo%5Cbar.png", "foo%00bar.png"} {
		rec := del(t, mux, "/api/v1/screenshots/"+encoded+"/failure")
		if rec.Code != http.StatusBadRequest {
			t.Errorf("encoded=%q: status = %d, want 400", encoded, rec.Code)
		}
	}
}

func TestGetScreenshotsFailed_EmptyIsEmptyArray(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	rec := get(t, mux, "/api/v1/screenshots/failed")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "[]\n" && body != "[]" {
		t.Errorf("empty ledger must serialize as [], got %q", body)
	}
}
