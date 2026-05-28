package app

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
)

// Version is injected at build time via -ldflags "-X recall/pkg/app.Version=<tag>".
// Falls back to "dev" when building outside the release pipeline.
var Version = "dev"

// UpdateInfo is returned by CheckForUpdate.
//
//   - Checked=false: dev build skipped, or network failure — show nothing.
//   - Checked=true, DevBuild=true: show "Latest: vX" link (informational).
//   - Checked=true, DevBuild=false, Available=true: show "↑ vX available" link.
//   - Checked=true, DevBuild=false, Available=false: show "✓ most recent".
type UpdateInfo struct {
	Checked   bool   `json:"checked"`
	DevBuild  bool   `json:"dev_build"`
	Available bool   `json:"available"`
	Latest    string `json:"latest"`
	URL       string `json:"url"`
}

// releasesURL is the GitHub Releases API endpoint CheckForUpdate
// queries. Exposed as a package-level var so tests can substitute an
// httptest.NewServer URL — production code never reassigns it.
// Pattern matches parser.runTesseractFunc / parseSingleFunc per
// CLAUDE.md's function-variable-seam guidance for single-method
// dependencies.
var releasesURL = "https://api.github.com/repos/sound-barrier/recall/releases/latest"

func (a *App) GetVersion() string {
	if Version != "dev" {
		return Version
	}
	// No ldflags injection (direct `wails dev` or similar): read the manifest
	// so the UI shows "<version>-dev" rather than a bare "dev".
	data, err := os.ReadFile(".release-please-manifest.json")
	if err != nil {
		return "dev"
	}
	var manifest map[string]string
	if err := json.Unmarshal(data, &manifest); err != nil {
		return "dev"
	}
	if v := manifest["."]; v != "" {
		return v + "-dev"
	}
	return "dev"
}

// CheckForUpdate hits the GitHub releases API and compares the latest stable
// release against the running version. The caller should invoke this off the
// hot path — it makes a network request with a 5 s timeout.
//
// Dev builds (version ending in "-dev" or bare "dev") always report the
// latest release as informational context (DevBuild=true) rather than an
// upgrade prompt. Network failures return an empty UpdateInfo.
func (a *App) CheckForUpdate() UpdateInfo {
	v := a.GetVersion()
	isDev := v == "dev" || strings.HasSuffix(v, "-dev")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(releasesURL)
	if err != nil {
		return UpdateInfo{}
	}
	defer func() { _ = resp.Body.Close() }()

	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return UpdateInfo{}
	}

	latest := strings.TrimPrefix(release.TagName, "v")
	if latest == "" {
		return UpdateInfo{}
	}

	if isDev {
		return UpdateInfo{Checked: true, DevBuild: true, Latest: latest, URL: release.HTMLURL}
	}

	// Semver compare instead of raw string equality. Two reasons:
	//   1. The production binary's `Version` carries a leading `v`
	//      (release.yml passes `${{ github.ref_name }}` — the tag
	//      name — to the Dockerfile's ldflags), but local Makefile
	//      builds get bare semver from the manifest. semver.NewVersion
	//      accepts both forms, so the comparison stops caring about
	//      the prefix-mismatch that pre-fix made every official
	//      install show a perpetual "upgrade to <your-own-version>"
	//      prompt.
	//   2. Lexicographic compare flags 0.2.10 != 0.2.9 and would
	//      prompt the user to "upgrade" from 10 to 9. semver.LessThan
	//      orders them correctly.
	// Parse failures fall back to raw string equality so a malformed
	// release tag on GitHub's side (or a hand-built binary with a
	// non-semver Version string) doesn't trip the "Available" flag
	// any more aggressively than the old code did.
	current, errCurrent := semver.NewVersion(v)
	upstream, errUpstream := semver.NewVersion(latest)
	if errCurrent != nil || errUpstream != nil {
		if latest == v {
			return UpdateInfo{Checked: true}
		}
		return UpdateInfo{Checked: true, Available: true, Latest: latest, URL: release.HTMLURL}
	}

	if !current.LessThan(upstream) {
		return UpdateInfo{Checked: true}
	}
	return UpdateInfo{Checked: true, Available: true, Latest: latest, URL: release.HTMLURL}
}
