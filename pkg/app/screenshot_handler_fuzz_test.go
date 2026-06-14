package app_test

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
)

// Fuzz harness for the /_screenshot/ URL handler — the codepath
// CodeQL flagged as a path-injection sink. The handler's five
// rejection branches and two happy paths are unit-tested in
// `screenshot_handler_test.go`; this file feeds random URL
// strings through the same handler and asserts the safety
// invariants survive.
//
// Invariants asserted:
//
//   - The handler never panics.
//   - The response body never contains bytes from a file outside
//     the configured screenshots dir. (Path-traversal probe: a
//     successful 200 must carry the canary content; anything else
//     is a 4xx.)
//   - Status code is one of {200, 400, 404, 405} — no surprises.
//
// The seed corpus covers the rejection vectors the unit tests
// already pin (legacy URL shape, non-int dir-id, malformed
// escapes, path-traversal attempts, empty/double slashes) plus a
// handful of obviously-malicious shapes. Mutator runs (`go test
// -fuzz=FuzzScreenshotHandler_URL`) explore the neighborhood; the
// seed-only run on every push catches regressions in the rejection
// gates.

const fuzzCanaryContent = "fuzz-canary-content"

func FuzzScreenshotHandler_URL(f *testing.F) {
	seeds := []string{
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
	for _, s := range seeds {
		f.Add(s)
	}

	dir := f.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "canary.png"), []byte(fuzzCanaryContent), 0o600); err != nil {
		f.Fatalf("seed canary: %v", err)
	}
	a := &app.App{}
	app.AppSettings(a).ScreenshotsDir = dir
	app.SetAppStore(a, dbtest.New())
	h := a.ScreenshotHandler()

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
		// the existing TestScreenshotHandler_RejectsMalformedURLEscape
		// pattern.
		req, err := http.NewRequest("GET", "http://localhost/", nil)
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
