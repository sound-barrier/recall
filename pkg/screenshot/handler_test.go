package screenshot_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/screenshot"
)

// Handler is a CodeQL-flagged path-injection sink. Every rejection branch and
// both happy paths are exercised here in isolation — no real HTTP server, no
// store, just httptest.NewRecorder against the handler a DirResolver returns.
//
// The URL shape is `/_screenshot/<dir-id>/<filename>`. What a dir-id resolves
// to is the caller's business (pkg/app resolves it from screenshots_dirs, then
// the configured folder); everything below fixes the answer and tests the
// parsing, the guards, and the sink.

// dirWithShot returns a tempdir containing one file, shot.png, with the given
// contents — the only fixture the handler tests need, since what varies here
// is the URL rather than the directory. t.TempDir() handles cleanup.
func dirWithShot(t *testing.T, contents string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "shot.png"), []byte(contents), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return dir
}

// fixedDir is the resolver that answers every dir-id with the same directory.
func fixedDir(dir string) screenshot.DirResolver {
	return func(int64) string { return dir }
}

// fire dispatches a GET to handler and returns the recorder.
func fire(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	h.ServeHTTP(rec, req)
	return rec
}

// ── Happy paths ───────────────────────────────────────────────────

func TestHandler_ServesFileFromResolvedDir(t *testing.T) {
	dir := dirWithShot(t, "fake-png-bytes")

	rec := fire(t, screenshot.Handler(fixedDir(dir)), "/_screenshot/0/shot.png")

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "fake-png-bytes" {
		t.Errorf("body: got %q, want %q", got, "fake-png-bytes")
	}
}

func TestHandler_PassesTheURLDirIDToTheResolver(t *testing.T) {
	// The dir-id segment is the whole reason this seam exists: the shell
	// decides what it means, so the handler must hand over exactly what the
	// URL carried.
	dir := dirWithShot(t, "bytes")
	var got []int64
	h := screenshot.Handler(func(dirID int64) string {
		got = append(got, dirID)
		return dir
	})

	for _, path := range []string{"/_screenshot/0/shot.png", "/_screenshot/42/shot.png"} {
		if rec := fire(t, h, path); rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d, want 200", path, rec.Code)
		}
	}

	if len(got) != 2 || got[0] != 0 || got[1] != 42 {
		t.Errorf("resolver saw dir-ids %v, want [0 42]", got)
	}
}

// ── URL-shape rejection branches ──────────────────────────────────

func TestHandler_RejectsLegacyURLShape(t *testing.T) {
	// Pre-1.0 break: `/_screenshot/<filename>` (no dir-id segment)
	// is no longer valid. Old clients return 404.
	rec := fire(t, screenshot.Handler(fixedDir(t.TempDir())), "/_screenshot/legacy.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestHandler_RejectsNonIntegerDirID(t *testing.T) {
	rec := fire(t, screenshot.Handler(fixedDir(t.TempDir())), "/_screenshot/abc/shot.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestHandler_RejectsNegativeDirID(t *testing.T) {
	rec := fire(t, screenshot.Handler(fixedDir(t.TempDir())), "/_screenshot/-1/shot.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestHandler_RejectsPathOutsidePrefix(t *testing.T) {
	rec := fire(t, screenshot.Handler(fixedDir(t.TempDir())), "/totally/unrelated/path.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestHandler_RejectsMalformedURLEscape(t *testing.T) {
	// httptest.NewRequest panics on a malformed escape, so build a valid
	// request and mutate req.URL.Path — that skips re-validation.
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/_screenshot/0/placeholder.png", nil)
	req.URL.Path = "/_screenshot/0/%ZZ.png"
	rec := httptest.NewRecorder()
	screenshot.Handler(fixedDir(t.TempDir())).ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", rec.Code)
	}
}

func TestHandler_RejectsNonReadMethods(t *testing.T) {
	// RFC 9110: 405 carries Allow. Pinned by the schemathesis
	// `unsupported_method` check as well, which never sees this package.
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/_screenshot/0/shot.png", nil)
	rec := httptest.NewRecorder()
	screenshot.Handler(fixedDir(t.TempDir())).ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status: got %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != "GET, HEAD" {
		t.Errorf("Allow: got %q, want %q", got, "GET, HEAD")
	}
}

// ── Path-traversal rejection branches ─────────────────────────────

func TestHandler_RejectsPathTraversalDotDot(t *testing.T) {
	dir := dirWithShot(t, "fake-png-bytes")

	rec := fire(t, screenshot.Handler(fixedDir(dir)), "/_screenshot/0/..")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404 (got body %q)", rec.Code, rec.Body.String())
	}
}

func TestHandler_RejectsForwardSlashInName(t *testing.T) {
	rec := fire(t, screenshot.Handler(fixedDir(t.TempDir())), "/_screenshot/0/foo%2Fbar.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestHandler_RejectsBackslashInName(t *testing.T) {
	rec := fire(t, screenshot.Handler(fixedDir(t.TempDir())), "/_screenshot/0/foo%5Cbar.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestHandler_RejectsEmptyName(t *testing.T) {
	rec := fire(t, screenshot.Handler(fixedDir(t.TempDir())), "/_screenshot/0/")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestHandler_EscapingNameNeverReachesTheResolvedDir(t *testing.T) {
	// Even with a resolver handing back a real directory, the basename
	// guard (no /, no \, no ..) must fire BEFORE anything is served.
	dir := dirWithShot(t, "fake-bytes")

	rec := fire(t, screenshot.Handler(fixedDir(dir)), "/_screenshot/7/..%2Fescape.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404 (basename guard must clear)", rec.Code)
	}
}

// ── Resolver + filesystem outcomes ────────────────────────────────

func TestHandler_RejectsWhenDirDoesNotResolve(t *testing.T) {
	// "" is the resolver's "no directory" answer — no configured
	// screenshots folder, and no row for the id.
	rec := fire(t, screenshot.Handler(fixedDir("")), "/_screenshot/0/anything.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestHandler_ReturnsNotFoundForMissingFile(t *testing.T) {
	rec := fire(t, screenshot.Handler(fixedDir(t.TempDir())), "/_screenshot/0/missing.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

// ── The guards, directly ──────────────────────────────────────────

func TestValidBasename(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want bool
	}{
		{"plain basename", "shot.png", true},
		{"empty", "", false},
		{"forward slash", "sub/shot.png", false},
		{"backslash", `sub\shot.png`, false},
		{"parent traversal", "../shot.png", false},
		{"bare dot-dot", "..", false},
		{"dot-dot mid-name", "a..b.png", false},
		{"at the 255-byte cap", strings.Repeat("a", 255), true},
		{"one byte over the cap", strings.Repeat("a", 256), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := screenshot.ValidBasename(tc.in); got != tc.want {
				t.Errorf("ValidBasename(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestWithinDir(t *testing.T) {
	tests := []struct {
		name string
		dir  string
		full string
		want bool
	}{
		{name: "child", dir: "/srv/shots", full: "/srv/shots/a.png", want: true},
		{name: "the dir itself", dir: "/srv/shots", full: "/srv/shots", want: true},
		{name: "sibling with a shared prefix", dir: "/srv/shots", full: "/srv/shots-evil/a.png"},
		{name: "parent", dir: "/srv/shots", full: "/srv/a.png"},
		{name: "escaped by dot-dot", dir: "/srv/shots", full: "/srv/shots/../a.png"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := screenshot.WithinDir(tc.dir, tc.full); got != tc.want {
				t.Errorf("WithinDir(%q, %q) = %v, want %v", tc.dir, tc.full, got, tc.want)
			}
		})
	}
}
