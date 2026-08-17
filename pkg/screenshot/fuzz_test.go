package screenshot_test

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/screenshot"
)

// Fuzz harnesses for the /_screenshot/ codepath — what CodeQL flags as a
// path-injection sink, plus the two guards that make it safe.
//
// The handler harness feeds random URL strings through a real Handler and
// asserts the safety invariants survive; the guard harnesses fuzz
// ValidBasename and WithinDir directly, against oracles that do not share
// their implementation. Nothing here constructs a store or an app: the
// DirResolver seam means one closure over a temp dir is the entire world the
// handler needs, so a mutator run spends its budget on the parser and the
// guards instead of on setup.

const fuzzCanaryContent = "fuzz-canary-content"

// fuzzSeedPaths covers the rejection vectors the unit tests already pin
// (legacy URL shape, non-int dir-id, malformed escapes, path-traversal
// attempts, empty/double slashes) plus a handful of obviously-malicious
// shapes.
var fuzzSeedPaths = []string{
	"/_screenshot/0/canary.png",
	"/_screenshot/1/canary.png",
	"/_screenshot/canary.png",
	"/_screenshot/",
	"/_screenshot/0/",
	"/_screenshot//canary.png",
	"/_screenshot/-1/canary.png",
	"/_screenshot/abc/canary.png",
	"/_screenshot/0/..%2Fetc%2Fpasswd",
	"/_screenshot/0/../etc/passwd",
	"/_screenshot/0/foo%2Fbar.png",
	"/_screenshot/0/foo bar.png",
	"/_screenshot/0/" + strings.Repeat("A", 1024),
	"/_screenshot/0/canary.png?query=evil",
	"/_screenshot/0/canary.png#frag",
	"/something-else/canary.png",
	"",
	"/",
}

// Invariants asserted:
//
//   - The handler never panics.
//   - The response body never contains bytes from a file outside the
//     resolved screenshots dir. (Path-traversal probe: a successful 200
//     must carry the canary content; anything else is a 4xx.)
//   - Status code is one of {200, 301, 400, 404, 405} — no surprises.
//
// Mutator runs (`go test -fuzz=FuzzHandler_URL`) explore the neighborhood;
// the seed-only run on every push catches regressions in the rejection gates.
func FuzzHandler_URL(f *testing.F) {
	for _, s := range fuzzSeedPaths {
		f.Add(s)
	}

	dir := f.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "canary.png"), []byte(fuzzCanaryContent), 0o600); err != nil {
		f.Fatalf("seed canary: %v", err)
	}
	h := screenshot.Handler(fixedDir(dir))

	f.Fuzz(func(t *testing.T, path string) {
		// Skip control chars httptest.NewRequest panics on. We're
		// testing the handler's safety, not httptest's parser.
		if strings.ContainsAny(path, "\x00\r\n") {
			t.Skip()
		}
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("handler panicked on path %q: %v", path, r)
			}
		}()

		rec := httptest.NewRecorder()
		// httptest.NewRequest panics on URL-parse failures (spaces,
		// some control byte sequences). Build the request via
		// http.NewRequest with a pre-parsed URL so fuzz inputs that
		// look like "URLs the parser can't construct from a literal
		// string" still hit the handler. Mutate req.URL.Path directly
		// to preserve the original raw byte sequence — this matches
		// the existing TestHandler_RejectsMalformedURLEscape pattern.
		req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://localhost/", nil)
		if err != nil {
			t.Skipf("could not construct base request: %v", err)
		}
		req.URL = &url.URL{Path: normalizeFuzzPath(path)}
		h.ServeHTTP(rec, req)

		switch rec.Code {
		case 200:
			if body := rec.Body.String(); body != fuzzCanaryContent {
				t.Errorf("200 OK served unexpected bytes for path %q: %q (path-traversal escape?)", path, body)
			}
		case 301, 400, 404, 405:
			// Expected rejection / redirect codes. 301 fires from
			// http.ServeFile when the filename resolves to `.` or a
			// directory — the redirect is to a path that fails the
			// containment gate, so it's not a security concern.
		default:
			t.Errorf("unexpected status %d for path %q", rec.Code, path)
		}
	})
}

// normalizeFuzzPath ensures the input string can be embedded in a
// URL. httptest.NewRequest is strict about the URL parse step;
// the handler itself runs against r.URL.Path which is fine with
// most byte content, but the constructor would fail on certain
// shapes. We prefix `/` if missing so the URL is at least a path,
// not a scheme.
func normalizeFuzzPath(p string) string {
	if !strings.HasPrefix(p, "/") {
		return "/" + p
	}
	return p
}

// The first guard, against two oracles that share none of its code: a name it
// accepts must be what filepath.Base makes of it, and joining it under a
// directory must land inside that directory. Either one fails the moment a
// tidy-up drops one of the three checks — deleting the `..` test alone makes
// the seed ".." escape to the parent directory.
//
// The directory is fixed because the claim is about names. WithinDir gets its
// own harness below.
func FuzzValidBasename_AcceptedNameStaysInsideDir(f *testing.F) {
	for _, s := range []string{
		"canary.png", "", ".", "..", "../escape.png", "a..b.png",
		"sub/shot.png", `sub\shot.png`, " ", "shot.png ", ".hidden",
		strings.Repeat("a", 255), strings.Repeat("a", 256), "☃.png",
	} {
		f.Add(s)
	}

	dir := f.TempDir()

	f.Fuzz(func(t *testing.T, name string) {
		if !screenshot.ValidBasename(name) {
			return
		}
		if base := filepath.Base(name); base != name {
			t.Errorf("ValidBasename accepted %q, but filepath.Base makes it %q — that is not a basename", name, base)
		}
		if full := filepath.Join(dir, name); !screenshot.WithinDir(dir, full) {
			t.Errorf("ValidBasename accepted %q, which joins to %q outside %q", name, full, dir)
		}
	})
}

// The containment gate, against filepath.Rel as the oracle. Rel is the
// standard library's own answer to "where is B relative to A", and it does not
// share an implementation with the prefix comparison WithinDir uses — so it
// catches the classic weakening of that comparison, `HasPrefix(fullAbs,
// dirAbs)` without the separator, which admits /srv/shots-evil under /srv/shots.
//
// Only the safety direction is asserted: nothing WithinDir admits may sit
// outside dir. The opposite direction (a rejection that should have been
// allowed) costs a preview, not a file, and there is one known such case: a dir
// that IS the filesystem root compares against "//", so WithinDir("/", "/a.png")
// is false. Asserting the reverse direction would fail on it, and widening the
// gate is a behavior change, not a move.
func FuzzWithinDir_NeverAdmitsAnEscape(f *testing.F) {
	for _, seed := range [][2]string{
		{"/srv/shots", "/srv/shots/a.png"},
		{"/srv/shots", "/srv/shots"},
		{"/srv/shots", "/srv/shots-evil/a.png"},
		{"/srv/shots", "/srv/shots/../a.png"},
		{"/srv/shots", "/srv/shotsa.png"},
		{"/srv/shots", "/etc/passwd"},
		{"/srv/shots", ""},
		{"", "a.png"},
		{"", ""},
		{"/", "/a.png"},
		{"shots", "shots/a.png"},
		{"shots/", "shots/sub/a.png"},
		{"/srv/shots/.", "/srv/shots/a.png"},
	} {
		f.Add(seed[0], seed[1])
	}

	f.Fuzz(func(t *testing.T, dir, full string) {
		if !screenshot.WithinDir(dir, full) {
			return
		}
		dirAbs, err1 := filepath.Abs(dir)
		fullAbs, err2 := filepath.Abs(full)
		if err1 != nil || err2 != nil {
			t.Fatalf("WithinDir(%q, %q) said yes but Abs failed: %v / %v", dir, full, err1, err2)
		}
		rel, err := filepath.Rel(dirAbs, fullAbs)
		if err != nil {
			t.Errorf("WithinDir admitted %q under %q, but Rel cannot express it: %v", full, dir, err)
			return
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			t.Errorf("WithinDir admitted %q under %q, which is %q — outside the directory", full, dir, rel)
		}
	})
}
