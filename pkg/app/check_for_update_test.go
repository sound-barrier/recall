package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// CheckForUpdate is the one App method that makes an outbound network
// call (GitHub Releases). Tests must never touch the real API — they'd
// be slow, fragile, and would exhaust anonymous rate limits in a
// loop. Instead, each test stands up an httptest.NewServer with a
// canned handler and points `releasesURL` (the package-level seam) at
// it for the duration of the test.

// withReleasesURL swaps releasesURL for the duration of the test and
// restores it after — same shape as parser tests' runTesseractFunc
// swapping.
func withReleasesURL(t *testing.T, url string) {
	t.Helper()
	prev := releasesURL
	releasesURL = url
	t.Cleanup(func() { releasesURL = prev })
}

// withVersion swaps the package-level Version (set via ldflags in
// production) for the duration of the test. Needed because
// CheckForUpdate's branches depend on the running version string.
func withVersion(t *testing.T, v string) {
	t.Helper()
	prev := Version
	Version = v
	t.Cleanup(func() { Version = prev })
}

// fakeReleasesServer stands up a one-off httptest server whose single
// handler responds with the given status + body. Server closes via
// t.Cleanup so individual tests stay focused on assertions.
func fakeReleasesServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestCheckForUpdate_DevBuildReportsLatestAsInformational(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://github.com/sound-barrier/recall/releases/tag/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "dev")

	got := (&App{}).CheckForUpdate()

	if !got.Checked {
		t.Fatal("Checked: want true")
	}
	if !got.DevBuild {
		t.Error("DevBuild: want true for dev version")
	}
	if got.Available {
		t.Error("Available: want false — dev builds never prompt to upgrade")
	}
	if got.Latest != "0.2.0" {
		t.Errorf("Latest: got %q, want %q", got.Latest, "0.2.0")
	}
	if got.URL == "" {
		t.Error("URL: want release page URL, got empty")
	}
}

func TestCheckForUpdate_DevSuffixCountsAsDevBuild(t *testing.T) {
	// Suffix-based dev detection: a build with version "0.1.0-dev"
	// (set by ldflags on a non-tagged build) also gets the
	// informational treatment, not the upgrade prompt.
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.1.0-dev")

	got := (&App{}).CheckForUpdate()

	if !got.DevBuild {
		t.Error("DevBuild: want true for '0.1.0-dev'")
	}
}

func TestCheckForUpdate_CurrentVersionMatchesLatest(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&App{}).CheckForUpdate()

	if !got.Checked {
		t.Fatal("Checked: want true")
	}
	if got.Available {
		t.Error("Available: want false — running latest")
	}
	if got.DevBuild {
		t.Error("DevBuild: want false for tagged release version")
	}
}

func TestCheckForUpdate_NewerReleaseAvailable(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.3.0","html_url":"https://example/v0.3.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&App{}).CheckForUpdate()

	if !got.Available {
		t.Error("Available: want true — newer release published")
	}
	if got.Latest != "0.3.0" {
		t.Errorf("Latest: got %q, want %q", got.Latest, "0.3.0")
	}
	if got.URL == "" {
		t.Error("URL: want release page URL")
	}
}

func TestCheckForUpdate_NetworkErrorReturnsEmpty(t *testing.T) {
	// Point at a URL that resolves but refuses connection (immediately
	// closed httptest server gives us this). Simulates the user being
	// offline or GitHub being unreachable.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close() // close BEFORE the call so the GET fails
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&App{}).CheckForUpdate()

	if got != (UpdateInfo{}) {
		t.Errorf("network failure: want empty UpdateInfo, got %+v", got)
	}
}

func TestCheckForUpdate_MalformedJSONReturnsEmpty(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK, `not json at all`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&App{}).CheckForUpdate()

	if got != (UpdateInfo{}) {
		t.Errorf("malformed body: want empty UpdateInfo, got %+v", got)
	}
}

func TestCheckForUpdate_EmptyTagReturnsEmpty(t *testing.T) {
	// The 404 GitHub returns for a missing repo/release also lands
	// here — the response body has no tag_name, so latest == "" and
	// we return empty rather than letting the UI prompt to "update
	// to v".
	srv := fakeReleasesServer(t, http.StatusOK, `{"tag_name":"","html_url":""}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&App{}).CheckForUpdate()

	if got != (UpdateInfo{}) {
		t.Errorf("empty tag: want empty UpdateInfo, got %+v", got)
	}
}

func TestCheckForUpdate_StripsLeadingVFromTag(t *testing.T) {
	// GitHub release tags carry a leading 'v' by convention
	// ("v1.2.3"); the function strips it so the version comparison
	// against ldflags-injected Version (which is bare semver) works.
	// Verify via the available-update path because the "up to date"
	// branch returns only {Checked: true} and discards Latest.
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v1.2.3","html_url":"https://example/v1.2.3"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "1.0.0")

	got := (&App{}).CheckForUpdate()

	if !got.Available {
		t.Error("Available: want true — 1.0.0 < 1.2.3")
	}
	if got.Latest != "1.2.3" {
		t.Errorf("Latest: want 'v' stripped, got %q", got.Latest)
	}
}
