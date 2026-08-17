// Package release is the app-release update check: it asks the GitHub
// releases channel for the latest published tag, compares it against the
// running version, joins the live game-data status fetched in parallel,
// and records when the install last heard back.
//
// The running version is NOT owned here. It stays in pkg/app as
// `var Version` because `-X recall/pkg/app.Version` is baked into
// Taskfile.yml, build/darwin/Taskfile.yml and build/windows/Taskfile.yml —
// the linker symbol must keep that package path — so the shell passes the
// version in as a parameter. Same for the install root: this package takes
// baseDir rather than resolving it.
package release

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"recall/pkg/applog"
	"recall/pkg/gamedata"
)

// ReleasesURL is the GitHub Releases API endpoint Check queries.
// Exposed as a package-level var so tests can substitute an
// httptest.NewServer URL — production code never reassigns it.
// Pattern matches parser.runTesseractFunc / parseSingleFunc per
// CLAUDE.md's function-variable-seam guidance for single-method
// dependencies.
var ReleasesURL = "https://api.github.com/repos/sound-barrier/recall/releases/latest"

// Meta is the slice of the GitHub release the update check needs.
type Meta struct {
	Latest      string
	URL         string
	Notes       string
	LastChecked string
}

// Check hits the GitHub releases API and compares the latest stable
// release against version. The caller should invoke this off the hot
// path — it makes a network request with a 5 s timeout. baseDir is the
// install root holding the last-checked stamp and the applied game-data
// manifest.
//
// Dev builds (version ending in "-dev" or bare "dev") always report the
// latest release as informational context (DevBuild=true) rather than an
// upgrade prompt. Network failures return an empty Info.
//
// On every successful API response (including "up to date" + dev-build
// branches), the install's last-checked timestamp is persisted via
// TouchLastChecked so the "haven't checked in a while" banner has a
// canonical source of truth.
//
// CanSelfUpdate is left false — only the shell knows whether this install
// can swap its own binary.
func Check(baseDir, version string) Info {
	isDev := version == "dev" || strings.HasSuffix(version, "-dev")

	// Fire the game-data (main-channel) fetch in parallel with the
	// release-channel binary-version fetch — they hit independent
	// hosts (api.github.com vs sound-barrier.github.io) so serial
	// would double the latency for no benefit. Joined at the end on
	// success, or drained on the failure path so the goroutine never
	// leaks; failures collapse to gamedata.Status{} which the FE
	// renders as "main channel unavailable".
	gameDataChan := startGameDataFetch(baseDir)

	meta, ok := fetchLatestMeta(baseDir)
	if !ok {
		<-gameDataChan
		return Info{}
	}
	u := InfoFor(version, isDev, meta)
	u.GameData = <-gameDataChan
	return u
}

// fetchGameDataStatus is a function-variable seam (the codebase's DI
// convention, cf. ReleasesURL / RunTesseractFunc) so the panic path below can
// be driven from a test without a live main-channel host.
var fetchGameDataStatus = gamedata.FetchStatus

// startGameDataFetch kicks off the main-channel roster/version probe on a
// background goroutine, returning the channel its single result lands on.
func startGameDataFetch(baseDir string) chan gamedata.Status {
	ch := make(chan gamedata.Status, 1)
	go func() {
		// The send is DEFERRED so that a panic still delivers a value.
		// RecoverPanic swallows the panic and returns normally, so a send
		// written after the call would simply never run — and both of Check's
		// receives (the success join and the failure drain) would block
		// forever. That turns a recovered panic into a permanently hung
		// request, which is strictly worse than the loud crash the recover
		// was added to prevent. Defers run LIFO, so RecoverPanic runs first
		// and this send second, carrying the zero Status the frontend already
		// renders as "main channel unavailable".
		status := gamedata.Status{}
		defer func() { ch <- status }()
		defer applog.RecoverPanic("update")
		status = fetchGameDataStatus(baseDir)
	}()
	return ch
}

// fetchLatestMeta GETs the latest release, decodes it, and records the
// last-checked timestamp under baseDir. ok=false on any network/decode
// failure or an empty tag — the caller collapses that to an empty Info.
func fetchLatestMeta(baseDir string) (Meta, bool) {
	client := gamedata.NewUpdateClient()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, ReleasesURL, nil)
	if err != nil {
		return Meta{}, false
	}
	resp, err := client.Do(req)
	if err != nil {
		return Meta{}, false
	}
	defer func() { _ = resp.Body.Close() }()
	// An intercepting proxy or CDN error page can answer 5xx with a JSON
	// body; without this gate a plausible tag_name in that body walked
	// through the decoder and produced a phantom "update available".
	if resp.StatusCode != http.StatusOK {
		return Meta{}, false
	}

	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
		Body    string `json:"body"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return Meta{}, false
	}
	latest := strings.TrimPrefix(release.TagName, "v")
	if latest == "" {
		return Meta{}, false
	}

	now := time.Now().UTC()
	if err := TouchLastChecked(baseDir, now); err != nil {
		applog.Subsystem("update").Warn("persist last-checked timestamp failed", "err", err)
	}
	return Meta{
		Latest:      latest,
		URL:         release.HTMLURL,
		Notes:       ExcerptNotes(release.Body),
		LastChecked: now.Format(time.RFC3339),
	}, true
}
