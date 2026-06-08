package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// CheckForUpdate is the one App method that makes an outbound network
// call (GitHub Releases). Tests must never touch the real API — they'd
// be slow, fragile, and would exhaust anonymous rate limits in a
// loop. Instead, each test stands up an httptest.NewServer with a
// canned handler and points `releasesURL` (the package-level seam) at
// it for the duration of the test.

// isEmptyUpdate returns true when no useful fields landed — equivalent
// to `got == UpdateInfo{}` before LatestHeroes/LatestMaps moved the
// struct out of comparable territory.
func isEmptyUpdate(u UpdateInfo) bool {
	return !u.Checked && !u.DevBuild && !u.Available && u.Latest == "" && u.URL == "" &&
		len(u.LatestHeroes) == 0 && len(u.LatestMaps) == 0
}

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

	if !isEmptyUpdate(got) {
		t.Errorf("network failure: want empty UpdateInfo, got %+v", got)
	}
}

func TestCheckForUpdate_MalformedJSONReturnsEmpty(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK, `not json at all`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&App{}).CheckForUpdate()

	if !isEmptyUpdate(got) {
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

	if !isEmptyUpdate(got) {
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

// Regression: production binaries built via release.yml have
// `Version="v0.2.5"` because release.yml passes `${{ github.ref_name }}`
// (the tag name, WITH the leading `v`) into the Dockerfile's
// `-ldflags "-X recall/pkg/app.Version=${VERSION}"`. Local Makefile
// builds get `"0.2.5"` (no v) from `jq -r '."."'
// .release-please-manifest.json`. Pre-fix, the up-to-date check
// stripped only the GitHub tag's `v` and string-compared against
// Version verbatim — so a user running the OFFICIAL v0.2.5 release
// always saw "upgrade available" prompting them to 0.2.5 (the
// version they already had). User report:
// "I installed the official release for v0.2.5 and yet it still
// says that an upgrade is available."
func TestCheckForUpdate_TaggedReleaseWithVPrefixIsNotAnUpgrade(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.5","html_url":"https://example/v0.2.5"}`)
	withReleasesURL(t, srv.URL)
	// Production binaries have the `v` prefix in Version because
	// of how release.yml passes `github.ref_name` to ldflags.
	withVersion(t, "v0.2.5")

	got := (&App{}).CheckForUpdate()

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
func TestCheckForUpdate_DoubleDigitPatchIsNotOlderThanSingleDigit(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.9","html_url":"https://example/v0.2.9"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.10")

	got := (&App{}).CheckForUpdate()

	if got.Available {
		t.Errorf("Available: want false — 0.2.10 > 0.2.9 by semver, got %+v", got)
	}
}

// Belt-and-suspenders: prerelease ordering. If a user is on
// 0.3.0-beta.0 and the latest stable is 0.2.5, semver says
// 0.2.5 < 0.3.0-beta.0, so no upgrade prompt. Raw string compare
// would have flagged them as different and prompted to "downgrade"
// to 0.2.5.
func TestCheckForUpdate_PrereleaseInstallNeverPromptsDowngrade(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.5","html_url":"https://example/v0.2.5"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.3.0-beta.0")

	got := (&App{}).CheckForUpdate()

	if got.Available {
		t.Errorf("Available: want false — 0.2.5 < 0.3.0-beta.0 by semver, got %+v", got)
	}
}

// withReleaseAssetURL swaps releaseAssetURL for the duration of the
// test and restores it after — needed because the release-roster
// fetches go through this function. Tests can route the asset URLs
// at an httptest server.
func withReleaseAssetURL(t *testing.T, builder func(version, name string) string) {
	t.Helper()
	prev := releaseAssetURL
	releaseAssetURL = builder
	t.Cleanup(func() { releaseAssetURL = prev })
}

// sha256hex computes a hex-encoded SHA-256 of the input — convenience
// for crafting test sidecars.
func sha256hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// fakeAssetServer responds with a small static set of routes:
//   - /heroes.yaml          → heroesBody
//   - /heroes.yaml.sha256   → "<hash>  recall-1.2.3-heroes.yaml"
//   - /maps.yaml            → mapsBody
//   - /maps.yaml.sha256     → "<hash>  recall-1.2.3-maps.yaml"
//
// Callers point releaseAssetURL at this server's URL.
func fakeAssetServer(t *testing.T, heroesBody, mapsBody []byte) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/heroes.yaml", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(heroesBody) })
	mux.HandleFunc("/heroes.yaml.sha256", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, "%s  recall-1.2.3-heroes.yaml\n", sha256hex(heroesBody))
	})
	mux.HandleFunc("/maps.yaml", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(mapsBody) })
	mux.HandleFunc("/maps.yaml.sha256", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, "%s  recall-1.2.3-maps.yaml\n", sha256hex(mapsBody))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestCheckForUpdate_AvailableSurfacesLatestRosters(t *testing.T) {
	releaseSrv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v1.2.3","html_url":"https://example/v1.2.3"}`)
	withReleasesURL(t, releaseSrv.URL)
	withVersion(t, "1.0.0")

	heroes := []byte("tank:\n  - Miyazaki\n  - Reinhardt\nsupport:\n  - Lúcio\n")
	maps := []byte("control:\n  - Ilios\n  - Nepal\nclash:\n  - Hanaoka\n")
	assetSrv := fakeAssetServer(t, heroes, maps)
	withReleaseAssetURL(t, func(_, name string) string {
		return assetSrv.URL + "/" + name
	})

	got := (&App{}).CheckForUpdate()

	if !got.Available || got.Latest != "1.2.3" {
		t.Fatalf("Available/Latest: want true / 1.2.3, got %+v", got)
	}
	if len(got.LatestHeroes) != 3 {
		t.Errorf("LatestHeroes: want 3 entries, got %v", got.LatestHeroes)
	}
	if !contains(got.LatestHeroes, "Miyazaki") {
		t.Errorf("LatestHeroes missing 'Miyazaki': %v", got.LatestHeroes)
	}
	if len(got.LatestMaps) != 3 {
		t.Errorf("LatestMaps: want 3 entries, got %v", got.LatestMaps)
	}
	if !contains(got.LatestMaps, "Hanaoka") {
		t.Errorf("LatestMaps missing 'Hanaoka': %v", got.LatestMaps)
	}
}

func TestCheckForUpdate_MismatchedSidecarRejectsRosters(t *testing.T) {
	// Bad sidecar (wrong hash) MUST drop the roster — silently
	// trusting it would let a tampered YAML reach the UI. The
	// rest of the UpdateInfo (Available, Latest, URL) still
	// surfaces — only the roster arrays empty out.
	releaseSrv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v1.2.3","html_url":"https://example/v1.2.3"}`)
	withReleasesURL(t, releaseSrv.URL)
	withVersion(t, "1.0.0")

	heroes := []byte("tank:\n  - Miyazaki\n")
	mux := http.NewServeMux()
	mux.HandleFunc("/heroes.yaml", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(heroes) })
	mux.HandleFunc("/heroes.yaml.sha256", func(w http.ResponseWriter, _ *http.Request) {
		// Intentional hash mismatch (all-zeros where the real
		// hash should be) — verifySha256 must reject.
		_, _ = fmt.Fprintf(w, "%s  recall-1.2.3-heroes.yaml\n", strings.Repeat("0", 64))
	})
	mux.HandleFunc("/maps.yaml", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(heroes) })
	mux.HandleFunc("/maps.yaml.sha256", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, "%s  recall-1.2.3-maps.yaml\n", strings.Repeat("0", 64))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	withReleaseAssetURL(t, func(_, name string) string {
		return srv.URL + "/" + name
	})

	got := (&App{}).CheckForUpdate()

	if !got.Available || got.Latest != "1.2.3" {
		t.Fatalf("Available/Latest: want true / 1.2.3, got %+v", got)
	}
	if len(got.LatestHeroes) != 0 || len(got.LatestMaps) != 0 {
		t.Errorf("rosters: want empty (sidecar mismatch), got heroes=%v maps=%v",
			got.LatestHeroes, got.LatestMaps)
	}
}

func TestVerifySha256_RejectsMalformedSidecar(t *testing.T) {
	payload := []byte("hello")
	cases := []struct {
		name    string
		sidecar []byte
		want    bool
	}{
		{"empty sidecar", []byte(""), false},
		{"truncated hash (only 10 chars)", []byte("abcdef0123  file.yaml"), false},
		{"correct hash + filename", []byte(sha256hex(payload) + "  file.yaml"), true},
		{
			"upper-case hash (sidecars sometimes ship hex like this)",
			[]byte(strings.ToUpper(sha256hex(payload)) + "  file.yaml"), true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := verifySha256(payload, tc.sidecar); got != tc.want {
				t.Errorf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestParseRosterNames_DedupsAcrossGroups(t *testing.T) {
	// If a hero appears under two role-groups (the YAML schema
	// doesn't forbid it), parseRosterNames must dedup so the FE
	// doesn't render the same CTA twice.
	yaml := []byte("tank:\n  - Doomfist\n  - Reinhardt\ndps:\n  - Doomfist\n")
	names := parseRosterNames(yaml)
	if len(names) != 2 {
		t.Errorf("want 2 unique names (Doomfist dedup), got %v", names)
	}
}

func TestParseRosterNames_DropsBlankEntries(t *testing.T) {
	// A blank string in the YAML is filtered — the parser's
	// reference data never carries one but defending against it
	// keeps the FE from rendering a CTA with an empty backtick'd
	// label.
	yaml := []byte("tank:\n  - \"\"\n  - Reinhardt\n")
	names := parseRosterNames(yaml)
	if len(names) != 1 || names[0] != "Reinhardt" {
		t.Errorf("want [Reinhardt], got %v", names)
	}
}
