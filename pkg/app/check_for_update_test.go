package app_test

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"recall/pkg/app"
	"recall/pkg/gamedata"
)

func TestCheckForUpdate_DevBuildReportsLatestAsInformational(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://github.com/sound-barrier/recall/releases/tag/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "dev")

	got := (&app.App{}).CheckForUpdate()

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

	got := (&app.App{}).CheckForUpdate()

	if !got.DevBuild {
		t.Error("DevBuild: want true for '0.1.0-dev'")
	}
}

func TestCheckForUpdate_CurrentVersionMatchesLatest(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&app.App{}).CheckForUpdate()

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

func TestCheckForUpdate_CanSelfUpdate_FalseWithoutUpdater(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&app.App{}).CheckForUpdate()

	if got.CanSelfUpdate {
		t.Error("CanSelfUpdate: want false when no updater is wired (server mode / dev / macOS / unwritable)")
	}
}

func TestCheckForUpdate_CanSelfUpdate_TrueWithUpdater(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&app.App{SelfUpdate: &fakeSelfUpdater{}}).CheckForUpdate()

	if !got.CanSelfUpdate {
		t.Error("CanSelfUpdate: want true when the updater seam is wired")
	}
}

func TestCheckForUpdate_NewerReleaseAvailable(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.3.0","html_url":"https://example/v0.3.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&app.App{}).CheckForUpdate()

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

	got := (&app.App{}).CheckForUpdate()

	if !isEmptyUpdate(got) {
		t.Errorf("network failure: want empty UpdateInfo, got %+v", got)
	}
}

func TestCheckForUpdate_MalformedJSONReturnsEmpty(t *testing.T) {
	srv := fakeReleasesServer(t, http.StatusOK, `not json at all`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&app.App{}).CheckForUpdate()

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

	got := (&app.App{}).CheckForUpdate()

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

	got := (&app.App{}).CheckForUpdate()

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

	got := (&app.App{}).CheckForUpdate()

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

	got := (&app.App{}).CheckForUpdate()

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

	got := (&app.App{}).CheckForUpdate()

	if got.Available {
		t.Errorf("Available: want false — 0.2.5 < 0.3.0-beta.0 by semver, got %+v", got)
	}
}

// withReleaseAssetURL swaps gamedata.ReleaseAssetURL for the duration of the
// test and restores it after — needed because the release-roster
// fetches go through this function. Tests can route the asset URLs
// at an httptest server.
func withReleaseAssetURL(t *testing.T, builder func(version, name string) string) {
	t.Helper()
	prev := gamedata.ReleaseAssetURL
	gamedata.ReleaseAssetURL = builder
	t.Cleanup(func() { gamedata.ReleaseAssetURL = prev })
}

// withMainURLs swaps the main-channel URL seams (gamedata.MainAssetURL +
// gamedata.MainVersionURL) so tests stay hermetic. Tests that don't care
// about the main channel pass closedServerURL (a pre-closed
// httptest server) — every main-channel fetch returns a connection
// error which collapses to GameDataStatus{} (empty CommitSHA, no diff)
// — exactly the "Pages unreachable" branch.
//
// Tests that DO care about the main channel pass a builder routed
// at a running httptest server with /heroes.yaml + /version.json +
// `.sha256` sidecars staged.
func withMainURLs(t *testing.T, base string) {
	t.Helper()
	prevAsset := gamedata.MainAssetURL
	prevVersion := gamedata.MainVersionURL
	gamedata.MainAssetURL = func(name string) string { return base + "/" + name }
	gamedata.MainVersionURL = base + "/version.json"
	t.Cleanup(func() {
		gamedata.MainAssetURL = prevAsset
		gamedata.MainVersionURL = prevVersion
	})
}

// closedServerURL stands up an httptest server and closes it
// immediately so every request fails with a connection error. Use
// when a test only needs the main-channel fetch path to return
// quickly without hitting the live Pages URL.
func closedServerURL(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	srv.Close()
	return srv.URL
}

// fakeMainServer mirrors fakeAssetServer for the main channel. The
// commitSHA is staged into version.json; the three YAMLs + sidecars
// follow the same pattern as the release flow.
func fakeMainServer(t *testing.T, commitSHA string, heroesBody, mapsBody, sourcesBody []byte) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/version.json", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, `{"commit_sha":"%s","committed_at":"2026-06-09T00:00:00Z"}`, commitSHA)
	})
	stage := func(name string, body []byte) {
		if len(body) == 0 {
			return
		}
		mux.HandleFunc("/"+name, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) })
		mux.HandleFunc("/"+name+".sha256", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = fmt.Fprintf(w, "%s  %s\n", sha256hex(body), name)
		})
	}
	stage("heroes.yaml", heroesBody)
	stage("maps.yaml", mapsBody)
	stage("screenshot_sources.yaml", sourcesBody)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// sha256hex computes a hex-encoded SHA-256 of the input — convenience
// for crafting test sidecars.
func sha256hex(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// fakeAssetServer responds with a small static set of routes:
//   - /heroes.yaml                  → heroesBody
//   - /heroes.yaml.sha256           → "<hash>  recall-1.2.3-heroes.yaml"
//   - /maps.yaml                    → mapsBody
//   - /maps.yaml.sha256             → "<hash>  recall-1.2.3-maps.yaml"
//   - /screenshot_sources.yaml      → sourcesBody (empty body skips route)
//   - /screenshot_sources.yaml.sha256 → matching sidecar
//
// Callers point gamedata.ReleaseAssetURL at this server's URL.
func fakeAssetServer(t *testing.T, heroesBody, mapsBody, sourcesBody []byte) *httptest.Server {
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
	if len(sourcesBody) > 0 {
		mux.HandleFunc("/screenshot_sources.yaml", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write(sourcesBody)
		})
		mux.HandleFunc("/screenshot_sources.yaml.sha256", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = fmt.Fprintf(w, "%s  recall-1.2.3-screenshot_sources.yaml\n", sha256hex(sourcesBody))
		})
	}
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
	assetSrv := fakeAssetServer(t, heroes, maps, nil)
	withReleaseAssetURL(t, func(_, name string) string {
		return assetSrv.URL + "/" + name
	})

	got := (&app.App{}).CheckForUpdate()

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

	got := (&app.App{}).CheckForUpdate()

	if !got.Available || got.Latest != "1.2.3" {
		t.Fatalf("Available/Latest: want true / 1.2.3, got %+v", got)
	}
	if len(got.LatestHeroes) != 0 || len(got.LatestMaps) != 0 {
		t.Errorf("rosters: want empty (sidecar mismatch), got heroes=%v maps=%v",
			got.LatestHeroes, got.LatestMaps)
	}
}

// isEmptyUpdate returns true when no useful fields landed — equivalent
// to `got == UpdateInfo{}` before LatestHeroes/LatestMaps moved the
// struct out of comparable territory.
func isEmptyUpdate(u app.UpdateInfo) bool {
	return !u.Checked && !u.DevBuild && !u.Available && u.Latest == "" && u.URL == "" &&
		len(u.LatestHeroes) == 0 && len(u.LatestMaps) == 0 && len(u.LatestSources) == 0 &&
		u.LastCheckedAt == "" && u.ReleaseNotes == "" &&
		u.GameData.AppliedCommit == "" && !u.GameData.HasUpdate
}

// withReleasesURL swaps *app.ReleasesURL for the duration of the test and
// restores it after — same shape as parser tests' runTesseractFunc
// swapping.
//
// Also wires the main-channel URLs at a pre-closed httptest server
// so the parallel fetch in CheckForUpdate stays hermetic. Tests that
// want a LIVE main channel call withMainURLs(t, srv.URL) AFTER this
// to override — the LIFO Cleanup unwinds the override before this
// helper's restore fires.
func withReleasesURL(t *testing.T, url string) {
	t.Helper()
	prev := *app.ReleasesURL
	*app.ReleasesURL = url
	t.Cleanup(func() { *app.ReleasesURL = prev })
	withMainURLs(t, closedServerURL(t))
}

// withVersion swaps the package-level Version (set via ldflags in
// production) for the duration of the test. Needed because
// CheckForUpdate's branches depend on the running version string.
func withVersion(t *testing.T, v string) {
	t.Helper()
	prev := app.Version
	app.Version = v
	t.Cleanup(func() { app.Version = prev })
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

func TestCheckForUpdate_PopulatesLastCheckedAtAndPersists(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&app.App{}).CheckForUpdate()

	if got.LastCheckedAt == "" {
		t.Errorf("LastCheckedAt: want non-empty RFC3339 timestamp, got %q", got.LastCheckedAt)
	}
	if _, err := time.Parse(time.RFC3339, got.LastCheckedAt); err != nil {
		t.Errorf("LastCheckedAt: want RFC3339, got %q (%v)", got.LastCheckedAt, err)
	}

	// And it must have been persisted — a subsequent LoadCheckState
	// round-trips the same timestamp so the banner gate survives a
	// process restart.
	s, err := app.LoadCheckState()
	if err != nil {
		t.Fatalf("LoadCheckState: %v", err)
	}
	if s.LastCheckedAt.IsZero() {
		t.Error("LoadCheckState: LastCheckedAt is zero (persistence skipped)")
	}
}

func TestCheckForUpdate_PopulatesReleaseNotesExcerpt(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	body := "## 1.2.0 — Roster bump\n\n* Added: Sojourn (DPS), Mauga (Tank)\n* Map rotation: Antarctic Peninsula now a Control mode entry.\n* Bugfix: teams panel right-edge OCR\n"
	tagName := "v1.2.0"
	releaseJSON := fmt.Sprintf(`{"tag_name":%q,"html_url":"https://example/v1.2.0","body":%q}`, tagName, body)
	srv := fakeReleasesServer(t, http.StatusOK, releaseJSON)
	withReleasesURL(t, srv.URL)
	withVersion(t, "1.0.0")
	assetSrv := fakeAssetServer(t, []byte("tank: []\nsupport: []\ndps: []\n"), []byte("control: []\n"), validSourcesYAML())
	withReleaseAssetURL(t, func(_, name string) string { return assetSrv.URL + "/" + name })

	got := (&app.App{}).CheckForUpdate()

	if got.ReleaseNotes == "" {
		t.Fatal("ReleaseNotes: want excerpt, got empty")
	}
	if !strings.Contains(got.ReleaseNotes, "Sojourn") {
		t.Errorf("ReleaseNotes: want excerpt to include 'Sojourn', got %q", got.ReleaseNotes)
	}
	// Excerpt must be size-capped — ~500 chars is the published budget.
	if len(got.ReleaseNotes) > 600 {
		t.Errorf("ReleaseNotes: excerpt is %d chars, want <= 600 (size cap)", len(got.ReleaseNotes))
	}
}

func TestCheckForUpdate_LatestSourcesFetchedFromRelease(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v1.2.3","html_url":"https://example/v1.2.3"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "1.0.0")
	assetSrv := fakeAssetServer(t,
		[]byte("tank:\n  - Reinhardt\nsupport: []\ndps: []\n"),
		[]byte("control:\n  - Ilios\n"),
		validSourcesYAML())
	withReleaseAssetURL(t, func(_, name string) string { return assetSrv.URL + "/" + name })

	got := (&app.App{}).CheckForUpdate()

	if !contains(got.LatestSources, "testtool") {
		t.Errorf("LatestSources: want to contain 'testtool', got %v", got.LatestSources)
	}
}

// ─── Main-channel (Pages live data) ───────────────────────────────

func TestCheckForUpdate_GameDataStatusEmpty_WhenPagesUnreachable(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.3.0","html_url":"https://example/v0.3.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.3.0")
	// withReleasesURL already wires main to a closed httptest server,
	// so this test exercises the unreachable-Pages branch by default.

	got := (&app.App{}).CheckForUpdate()

	if got.GameData.CommitSHA != "" {
		t.Errorf("GameData.CommitSHA: want empty (Pages unreachable), got %q", got.GameData.CommitSHA)
	}
	if got.GameData.HasUpdate {
		t.Errorf("GameData.HasUpdate: want false (Pages unreachable), got true")
	}
}

func TestCheckForUpdate_GameDataStatusPopulatesCommitSHAAndDiff(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.3.0","html_url":"https://example/v0.3.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.3.0")

	// Main-channel YAMLs contain a hero not in the embedded roster.
	mainHeroes := []byte("tank:\n  - Reinhardt\nsupport: []\ndps:\n  - Phoenix\n")
	mainMaps := []byte("control:\n  - Ilios\n")
	mainSources := validSourcesYAML()
	mainSrv := fakeMainServer(t, "abc1234567890def", mainHeroes, mainMaps, mainSources)
	withMainURLs(t, mainSrv.URL)

	got := (&app.App{}).CheckForUpdate()

	if got.GameData.CommitSHA != "abc1234" {
		t.Errorf("GameData.CommitSHA: want 'abc1234' (7-char short), got %q", got.GameData.CommitSHA)
	}
	if !got.GameData.HasUpdate {
		t.Error("GameData.HasUpdate: want true (no manifest yet, main is ahead by definition)")
	}
	if !contains(got.GameData.AddedHeroes, "Phoenix") {
		t.Errorf("GameData.AddedHeroes: want to contain 'Phoenix', got %v", got.GameData.AddedHeroes)
	}
}

func TestCheckForUpdate_GameDataStatusReflectsAppliedCommit(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	// Pre-seed the manifest as if the user already synced from main
	// at the SAME commit we'll publish — HasUpdate should flip false.
	if err := app.SaveManifest(app.DataManifest{
		AppliedSource:     "main",
		AppliedMainCommit: "abc1234",
		AppliedAt:         time.Now().UTC().Add(-1 * time.Hour),
		Files:             map[string]app.ManifestFile{},
	}); err != nil {
		t.Fatalf("SaveManifest: %v", err)
	}
	srv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v0.3.0","html_url":"https://example/v0.3.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.3.0")
	mainSrv := fakeMainServer(t, "abc1234567890def",
		[]byte("tank:\n  - Reinhardt\n"), []byte("control:\n  - Ilios\n"), validSourcesYAML())
	withMainURLs(t, mainSrv.URL)

	got := (&app.App{}).CheckForUpdate()

	if got.GameData.AppliedCommit != "abc1234" {
		t.Errorf("GameData.AppliedCommit: want 'abc1234', got %q", got.GameData.AppliedCommit)
	}
	if got.GameData.HasUpdate {
		t.Error("GameData.HasUpdate: want false (applied commit matches published commit)")
	}
}
