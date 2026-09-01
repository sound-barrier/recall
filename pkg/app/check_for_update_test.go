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

	"gopkg.in/yaml.v3"

	"recall/pkg/app"
	"recall/pkg/gamedata"
	"recall/pkg/parser"
	"recall/pkg/release"
)

// What is left here after the pkg/release carve is the SHELL's half:
// CheckForUpdate threading the running version and the install root into
// the leaf, stamping CanSelfUpdate on the way out, and the game-data /
// release-roster joins that share their fixtures with
// apply_data_update_test.go. The version-comparison matrix itself moved
// to pkg/release, where it needs no httptest server at all.

// The version threading. Version is what ldflags injects and GetVersion
// resolves; if the shell stopped passing it, this is the assertion that
// notices — nothing else here would.
func TestCheckForUpdate_DevBuildReportsLatestAsInformational(t *testing.T) {
	srv := fakeReleasesServer(t,
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

func TestCheckForUpdate_CanSelfUpdate_FalseWithoutUpdater(t *testing.T) {
	srv := fakeReleasesServer(t,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&app.App{}).CheckForUpdate()

	if got.CanSelfUpdate {
		t.Error("CanSelfUpdate: want false when no updater is wired (server mode / dev / macOS / unwritable)")
	}
}

func TestCheckForUpdate_CanSelfUpdate_TrueWithUpdater(t *testing.T) {
	srv := fakeReleasesServer(t,
		`{"tag_name":"v0.2.0","html_url":"https://example/v0.2.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&app.App{SelfUpdate: &fakeSelfUpdater{}}).CheckForUpdate()

	if !got.CanSelfUpdate {
		t.Error("CanSelfUpdate: want true when the updater seam is wired")
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
// error which collapses to gamedata.Status{} (empty CommitSHA, no diff)
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
	// seasons.yaml is a required data file (dataYAMLFiles) so Apply needs it
	// present; serve content identical to the embedded set so the season diff
	// is empty and doesn't perturb has_update assertions.
	stage("seasons.yaml", validSeasonsYAML())
	// ranks.yaml joined dataYAMLFiles with the tier-ladder single source, so
	// Apply needs it present too; serve the embedded set for a zero diff.
	stage("ranks.yaml", validRanksYAML())
	// patches.yaml joined dataYAMLFiles when the season starts stopped being
	// copied into it; empty is its shipped state and a zero diff.
	stage("patches.yaml", []byte("patches: []\n"))
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
	releaseSrv := fakeReleasesServer(t,
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
	releaseSrv := fakeReleasesServer(t,
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

// withReleasesURL swaps release.ReleasesURL for the duration of the test
// and restores it after — same shape as parser tests' runTesseractFunc
// swapping. The seam is the leaf's now; the shell only reaches it
// through CheckForUpdate.
//
// Also wires the main-channel URLs at a pre-closed httptest server
// so the parallel fetch in CheckForUpdate stays hermetic. Tests that
// want a LIVE main channel call withMainURLs(t, srv.URL) AFTER this
// to override — the LIFO Cleanup unwinds the override before this
// helper's restore fires.
func withReleasesURL(t *testing.T, url string) {
	t.Helper()
	prev := release.ReleasesURL
	release.ReleasesURL = url
	t.Cleanup(func() { release.ReleasesURL = prev })
	withMainURLs(t, closedServerURL(t))
	// Keep the release-roster walk-back hermetic: an unreachable list URL makes
	// FetchReleaseRosters fall back to trying only the latest tag (the behavior
	// these tests were written against). Tests exercising real walk-back set
	// gamedata.ReleaseListURL themselves.
	prevList := gamedata.ReleaseListURL
	gamedata.ReleaseListURL = closedServerURL(t)
	t.Cleanup(func() { gamedata.ReleaseListURL = prevList })
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

// fakeReleasesServer stands up a one-off httptest server answering 200
// with the given body. Server closes via t.Cleanup so individual tests
// stay focused on assertions. The non-200 arm moved to pkg/release with
// the rest of the fetch matrix, so nothing here needs a status knob.
func fakeReleasesServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// The install-root threading. The leaf writes the stamp wherever it is
// told to; this is the assertion that the shell tells it appBaseDir(),
// so the file lands in the install root and survives a restart. Passing
// "" would scatter check_state.json across working directories with
// nothing failing.
func TestCheckForUpdate_PopulatesLastCheckedAtAndPersists(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	srv := fakeReleasesServer(t,
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

	// And it must have been persisted UNDER THE INSTALL ROOT — the
	// zero-arg bridge resolves appBaseDir() exactly the way the shell
	// does, so a round-trip here proves the shell passed it through.
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
	srv := fakeReleasesServer(t, releaseJSON)
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
	srv := fakeReleasesServer(t,
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
	srv := fakeReleasesServer(t,
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
	srv := fakeReleasesServer(t,
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

// GameData.has_update is content-based, not commit-based: CheckForUpdate reports
// NO game-data update when the live-channel rosters match the app's loaded
// rosters, even though the published main commit differs from the applied one.
// pages.yml republishes version.json (a fresh commit + date) on
// testdata/openapi/docs changes too, so a commit-SHA comparison flagged a
// phantom update — and the UI then showed "your roster data is N days old" — with
// byte-identical heroes & maps. The applied commit is still surfaced for display.
func TestCheckForUpdate_NoGameDataUpdate_WhenRostersMatchDespiteNewCommit(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	if err := app.SaveManifest(app.DataManifest{
		AppliedSource:     "main",
		AppliedMainCommit: "old0000", // deliberately != the published commit below
		AppliedAt:         time.Now().UTC().Add(-16 * 24 * time.Hour),
		Files:             map[string]app.ManifestFile{},
	}); err != nil {
		t.Fatalf("SaveManifest: %v", err)
	}
	srv := fakeReleasesServer(t,
		`{"tag_name":"v0.3.0","html_url":"https://example/v0.3.0"}`)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.3.0")
	// Publish the app's OWN loaded rosters on the live channel → zero diff.
	heroes, maps, sources := loadedRostersYAML(t)
	mainSrv := fakeMainServer(t, "abc1234567890def", heroes, maps, sources)
	withMainURLs(t, mainSrv.URL)

	got := (&app.App{}).CheckForUpdate()

	if got.GameData.AppliedCommit != "old0000" {
		t.Errorf("GameData.AppliedCommit: want 'old0000', got %q", got.GameData.AppliedCommit)
	}
	if got.GameData.HasUpdate {
		t.Errorf("GameData.HasUpdate: want false — rosters match, so a differing published commit must NOT flag an update (added heroes %v, added maps %v)",
			got.GameData.AddedHeroes, got.GameData.AddedMaps)
	}
}

// loadedRostersYAML serializes the app's currently-loaded parser rosters into the
// YAML shapes the live channel publishes, so a fake main server can echo them
// back for a guaranteed zero-diff.
func loadedRostersYAML(t *testing.T) (heroes, maps, sources []byte) {
	t.Helper()
	var err error
	if heroes, err = yaml.Marshal(parser.HeroesByRole()); err != nil {
		t.Fatalf("marshal heroes: %v", err)
	}
	if maps, err = yaml.Marshal(parser.MapsByGameMode()); err != nil {
		t.Fatalf("marshal maps: %v", err)
	}
	type namedSource struct {
		Name string `yaml:"name"`
	}
	wrapper := struct {
		Sources []namedSource `yaml:"sources"`
	}{}
	for _, s := range parser.Sources() {
		wrapper.Sources = append(wrapper.Sources, namedSource{Name: s.Name})
	}
	if sources, err = yaml.Marshal(wrapper); err != nil {
		t.Fatalf("marshal sources: %v", err)
	}
	return heroes, maps, sources
}

// Both cases above use a 200. The carve introduced a third: when the release
// fetch FAILS, pkg/release returns a zero Info meaning "checked nothing, show
// nothing" — and the shell used to return before stamping anything onto it.
// Stamping unconditionally makes the response advertise a capability on a
// payload whose entire meaning is that there is nothing to act on:
// {"checked":false,"available":false,"can_self_update":true}.
//
// Harmless today only because AboutModal gates its CTA on `available &&
// canSelfUpdate` and the installer re-checks server-side. That is two
// coincidences holding up a contradiction, so pin the field instead.
func TestCheckForUpdate_CanSelfUpdate_FalseWhenTheCheckItselfFailed(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	withReleasesURL(t, srv.URL)
	withVersion(t, "0.2.0")

	got := (&app.App{SelfUpdate: &fakeSelfUpdater{}}).CheckForUpdate()

	if got.Checked {
		t.Fatalf("Checked: want false when the release fetch failed, got true")
	}
	if got.CanSelfUpdate {
		t.Error("CanSelfUpdate: want false on a failed check — a response that " +
			"checked nothing must not advertise that it could install something")
	}
}
