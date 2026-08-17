package release_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"recall/pkg/gamedata"
	"recall/pkg/release"
)

// The release-channel matrix: what Check makes of the latest published
// tag against the running version. Every case here needs only the
// releases endpoint — the main channel and the release-asset walk are
// wired at pre-closed servers so nothing leaves the process.

func TestCheck_DevSuffixCountsAsDevBuild(t *testing.T) {
	// Suffix-based dev detection: a build with version "0.1.0-dev"
	// (set by ldflags on a non-tagged build) gets the informational
	// treatment, not the upgrade prompt.
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)

	got := release.Check(t.TempDir(), "0.1.0-dev")

	if !got.DevBuild {
		t.Error("DevBuild: want true for '0.1.0-dev'")
	}
	if got.Available {
		t.Error("Available: want false — dev builds never prompt to upgrade")
	}
	if got.Latest != "0.2.0" {
		t.Errorf("Latest: got %q, want %q", got.Latest, "0.2.0")
	}
}

func TestCheck_CurrentVersionMatchesLatest(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)

	got := release.Check(t.TempDir(), "0.2.0")

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

func TestCheck_NewerReleaseAvailable(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.3.0","html_url":"https://example/v0.3.0"}`)
	withReleasesURL(t, srv.URL)

	got := release.Check(t.TempDir(), "0.2.0")

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

func TestCheck_NetworkErrorReturnsEmpty(t *testing.T) {
	// Point at a URL that resolves but refuses connection (immediately
	// closed httptest server gives us this). Simulates the user being
	// offline or GitHub being unreachable.
	withReleasesURL(t, closedServerURL(t))

	got := release.Check(t.TempDir(), "0.2.0")

	if !isEmptyUpdate(got) {
		t.Errorf("network failure: want empty Info, got %+v", got)
	}
}

func TestCheck_MalformedJSONReturnsEmpty(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK, `not json at all`)
	withReleasesURL(t, srv.URL)

	got := release.Check(t.TempDir(), "0.2.0")

	if !isEmptyUpdate(got) {
		t.Errorf("malformed body: want empty Info, got %+v", got)
	}
}

func TestCheck_EmptyTagReturnsEmpty(t *testing.T) {
	// The 404 GitHub returns for a missing repo/release also lands
	// here — the response body has no tag_name, so latest == "" and
	// we return empty rather than letting the UI prompt to "update
	// to v".
	srv := fakeReleasesServer(t, http.StatusOK, `{"tag_name":"","html_url":""}`)
	withReleasesURL(t, srv.URL)

	got := release.Check(t.TempDir(), "0.2.0")

	if !isEmptyUpdate(got) {
		t.Errorf("empty tag: want empty Info, got %+v", got)
	}
}

func TestCheck_StripsLeadingVFromTag(t *testing.T) {
	// GitHub release tags carry a leading 'v' by convention
	// ("v1.2.3"); the fetch strips it so the version comparison
	// against the ldflags-injected version (which is bare semver)
	// works. Verify via the available-update path because the "up to
	// date" branch returns only {Checked: true} and discards Latest.
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v1.2.3","html_url":"https://example/v1.2.3"}`)
	withReleasesURL(t, srv.URL)

	got := release.Check(t.TempDir(), "1.0.0")

	if !got.Available {
		t.Error("Available: want true — 1.0.0 < 1.2.3")
	}
	if got.Latest != "1.2.3" {
		t.Errorf("Latest: want 'v' stripped, got %q", got.Latest)
	}
}

// Regression: production binaries built via release.yml have
// `Version="v0.2.5"` because release.yml passes `${{ github.ref_name }}`
// (the tag name, WITH the leading `v`) into the Dockerfile's
// `-ldflags "-X recall/pkg/app.Version=${VERSION}"`. Local Taskfile
// builds get `"0.2.5"` (no v) from `jq -r '."."'
// .release-please-manifest.json`. Pre-fix, the up-to-date check
// stripped only the GitHub tag's `v` and string-compared against the
// running version verbatim — so a user running the OFFICIAL v0.2.5
// release always saw "upgrade available" prompting them to 0.2.5 (the
// version they already had). User report:
// "I installed the official release for v0.2.5 and yet it still
// says that an upgrade is available."
func TestCheck_TaggedReleaseWithVPrefixIsNotAnUpgrade(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.5","html_url":"https://example/v0.2.5"}`)
	withReleasesURL(t, srv.URL)

	// Production binaries have the `v` prefix in Version because
	// of how release.yml passes `github.ref_name` to ldflags.
	got := release.Check(t.TempDir(), "v0.2.5")

	if !got.Checked {
		t.Fatal("Checked: want true")
	}
	if got.Available {
		t.Errorf("Available: want false — installed v0.2.5 matches latest v0.2.5, got %+v", got)
	}
	if got.DevBuild {
		t.Error("DevBuild: want false for tagged release version")
	}
}

// Belt-and-suspenders: prove semver ordering is used (not raw string
// equality). Without semver, "0.2.10" < "0.2.9" in lexicographic
// order — a user on 0.2.10 would be prompted to "upgrade" to 0.2.9
// because string compare flags them as different and the old `latest
// != v` branch fires.
func TestCheck_DoubleDigitPatchIsNotOlderThanSingleDigit(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.9","html_url":"https://example/v0.2.9"}`)
	withReleasesURL(t, srv.URL)

	got := release.Check(t.TempDir(), "0.2.10")

	if got.Available {
		t.Errorf("Available: want false — 0.2.10 > 0.2.9 by semver, got %+v", got)
	}
}

// Belt-and-suspenders: prerelease ordering. If a user is on
// 0.3.0-beta.0 and the latest stable is 0.2.5, semver says
// 0.2.5 < 0.3.0-beta.0, so no upgrade prompt. Raw string compare
// would have flagged them as different and prompted to "downgrade"
// to 0.2.5.
func TestCheck_PrereleaseInstallNeverPromptsDowngrade(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.5","html_url":"https://example/v0.2.5"}`)
	withReleasesURL(t, srv.URL)

	got := release.Check(t.TempDir(), "0.3.0-beta.0")

	if got.Available {
		t.Errorf("Available: want false — 0.2.5 < 0.3.0-beta.0 by semver, got %+v", got)
	}
}

// A non-200 response must never surface as an available update, even
// when its body happens to decode as a plausible release — intercepting
// proxies and CDN error pages can return 5xx with a JSON body, and
// before the status check landed such a body walked straight through
// the decoder and produced a phantom "update available".
func TestCheck_Non200IsNotAnUpdate(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusInternalServerError,
		`{"tag_name":"v99.0.0","html_url":"https://example/v99.0.0"}`)
	withReleasesURL(t, srv.URL)

	got := release.Check(t.TempDir(), "0.2.0")

	if got.Available {
		t.Errorf("Available = true from a 500 response; a non-200 must not report an update (latest=%q)", got.Latest)
	}
}

// The stamp is written on the way through the fetch, so it lands on the
// "up to date" branch too — the banner asks "have I checked recently?",
// not "did I find something?".
func TestCheck_PersistsLastCheckedUnderBaseDir(t *testing.T) {
	dir := t.TempDir()
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)

	got := release.Check(dir, "0.2.0")

	if got.LastCheckedAt == "" {
		t.Error("LastCheckedAt: want a non-empty RFC3339 stamp on the up-to-date branch")
	}
	s, err := release.LoadCheckState(dir)
	if err != nil {
		t.Fatalf("LoadCheckState: %v", err)
	}
	if s.LastCheckedAt.IsZero() {
		t.Error("LoadCheckState: LastCheckedAt is zero — the stamp never reached baseDir")
	}
}

// A failed release fetch must not stamp the install as "checked" — the
// banner would then go quiet for a fortnight on an install that has
// reached nothing.
func TestCheck_DoesNotPersistWhenTheFetchFails(t *testing.T) {
	dir := t.TempDir()
	withReleasesURL(t, closedServerURL(t))

	release.Check(dir, "0.2.0")

	s, err := release.LoadCheckState(dir)
	if err != nil {
		t.Fatalf("LoadCheckState: %v", err)
	}
	if !s.LastCheckedAt.IsZero() {
		t.Errorf("LastCheckedAt: want zero after a failed fetch, got %v", s.LastCheckedAt)
	}
}

// ─── helpers ──────────────────────────────────────────────────────

// isEmptyUpdate returns true when no useful fields landed — equivalent
// to `got == Info{}` before LatestHeroes/LatestMaps moved the struct
// out of comparable territory.
func isEmptyUpdate(u release.Info) bool {
	return !u.Checked && !u.DevBuild && !u.Available && u.Latest == "" && u.URL == "" &&
		u.LastCheckedAt == "" && u.ReleaseNotes == "" &&
		hasNoRosters(u) && isEmptyGameData(u.GameData)
}

// hasNoRosters reports that no latest-roster list landed.
func hasNoRosters(u release.Info) bool {
	return len(u.LatestHeroes) == 0 && len(u.LatestMaps) == 0 && len(u.LatestSources) == 0
}

// isEmptyGameData reports that the main-channel game-data probe landed nothing.
func isEmptyGameData(gd gamedata.Status) bool {
	return gd.AppliedCommit == "" && !gd.HasUpdate
}

// withReleasesURL swaps release.ReleasesURL for the duration of the test
// and restores it after — same shape as the parser tests' runTesseractFunc
// swapping.
//
// It also wires the main-channel URLs and the release-list walk-back at
// pre-closed httptest servers so the parallel fetches in Check stay
// hermetic: every one fails fast and collapses to the documented
// "channel unavailable" branch.
func withReleasesURL(t *testing.T, url string) {
	t.Helper()
	prev := release.ReleasesURL
	release.ReleasesURL = url
	t.Cleanup(func() { release.ReleasesURL = prev })

	dead := closedServerURL(t)
	prevAsset, prevVersion, prevList := gamedata.MainAssetURL, gamedata.MainVersionURL, gamedata.ReleaseListURL
	gamedata.MainAssetURL = func(name string) string { return dead + "/" + name }
	gamedata.MainVersionURL = dead + "/version.json"
	gamedata.ReleaseListURL = dead
	t.Cleanup(func() {
		gamedata.MainAssetURL = prevAsset
		gamedata.MainVersionURL = prevVersion
		gamedata.ReleaseListURL = prevList
	})
}

// closedServerURL stands up an httptest server and closes it
// immediately so every request fails with a connection error.
func closedServerURL(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close()
	return srv.URL
}

// fakeReleasesServer stands up a one-off httptest server whose single
// handler responds with the given status + body. Server closes via
// t.Cleanup so individual tests stay focused on assertions.
func fakeReleasesServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}
