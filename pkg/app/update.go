package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
	"gopkg.in/yaml.v3"
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
//
// LatestHeroes / LatestMaps carry the canonical display-name lists
// extracted from the release's `recall-<version>-heroes.yaml` and
// `recall-<version>-maps.yaml` assets. The frontend pivots these into
// a "Update to v<X> to recognise <name>" CTA on the Reference data
// gaps section so the user knows which OCR-captured names are about
// to be recognised once they update. Empty when the YAML fetch fails
// or the sidecar SHA-256 check rejects the asset — Recall keeps
// showing the generic "wait for the next release" copy in that case.
type UpdateInfo struct {
	Checked      bool     `json:"checked"`
	DevBuild     bool     `json:"dev_build"`
	Available    bool     `json:"available"`
	Latest       string   `json:"latest"`
	URL          string   `json:"url"`
	LatestHeroes []string `json:"latest_heroes,omitempty"`
	LatestMaps   []string `json:"latest_maps,omitempty"`
}

// releasesURL is the GitHub Releases API endpoint CheckForUpdate
// queries. Exposed as a package-level var so tests can substitute an
// httptest.NewServer URL — production code never reassigns it.
// Pattern matches parser.runTesseractFunc / parseSingleFunc per
// CLAUDE.md's function-variable-seam guidance for single-method
// dependencies.
var releasesURL = "https://api.github.com/repos/sound-barrier/recall/releases/latest"

// releaseAssetURL builds the public-asset URL for a release file.
// Exposed as a package var so tests can swap it for an
// httptest.NewServer-routed builder. The released-asset attestation
// PR (#220) ships `recall-<version>-heroes.yaml`,
// `recall-<version>-maps.yaml`, and `<file>.sha256` sidecars for both
// at this prefix.
var releaseAssetURL = func(version, name string) string {
	return fmt.Sprintf(
		"https://github.com/sound-barrier/recall/releases/download/v%s/recall-%s-%s",
		version, version, name,
	)
}

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
	heroes, maps := fetchReleaseRosters(latest)
	return UpdateInfo{
		Checked:      true,
		Available:    true,
		Latest:       latest,
		URL:          release.HTMLURL,
		LatestHeroes: heroes,
		LatestMaps:   maps,
	}
}

// fetchReleaseRosters downloads the release's `heroes.yaml` +
// `maps.yaml` assets, verifies each against its published `.sha256`
// sidecar, parses the YAML, and returns the flat display-name lists.
//
// Trust model: TLS protects the HTTPS fetch against MITM. The .sha256
// sidecar is fetched from the same release; verifying the YAML
// against it defends against asset corruption on GitHub's side AND
// against a fetcher that confused itself by mid-stream truncation.
// Stronger SLSA/in-toto verification could go on top later (the
// release pipeline already publishes attestations); the sidecar
// check is the floor.
//
// Returns (nil, nil) on any failure — caller treats empty arrays as
// "no upgrade hint available," falls back to the generic copy.
func fetchReleaseRosters(version string) (heroes, maps []string) {
	heroes = fetchRoster(version, "heroes.yaml")
	maps = fetchRoster(version, "maps.yaml")
	return heroes, maps
}

// fetchRoster downloads <release>/recall-<v>-<name> + its .sha256
// sidecar, verifies the SHA, and returns the flat name list extracted
// from the YAML's role/type-grouped map. Empty slice on any failure.
func fetchRoster(version, name string) []string {
	client := &http.Client{Timeout: 5 * time.Second}

	yamlBytes, err := getBytes(client, releaseAssetURL(version, name))
	if err != nil {
		return nil
	}

	sumBytes, err := getBytes(client, releaseAssetURL(version, name)+".sha256")
	if err != nil {
		return nil
	}

	if !verifySha256(yamlBytes, sumBytes) {
		return nil
	}

	return parseRosterNames(yamlBytes)
}

// getBytes runs a GET and returns the response body, capped at 1 MB
// to bound memory if a malicious or misconfigured host returns a
// stream-without-end. The released YAML files are ~10 KB each, so
// 1 MB is two orders of magnitude of headroom.
func getBytes(client *http.Client, url string) ([]byte, error) {
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

// verifySha256 compares the SHA-256 of `payload` against the hash
// claimed in `sidecar`. The sidecar follows the sha256sum format:
// `<64-char hex hash>  <filename>` — we read the first whitespace-
// separated token and treat it as the expected hash.
func verifySha256(payload, sidecar []byte) bool {
	fields := strings.Fields(string(sidecar))
	if len(fields) == 0 {
		return false
	}
	want := strings.ToLower(fields[0])
	if len(want) != 64 {
		return false
	}
	got := sha256.Sum256(payload)
	return hex.EncodeToString(got[:]) == want
}

// parseRosterNames reads the role/type-grouped YAML structure the
// parser uses (see pkg/parser/{heroes,maps}.yaml) and returns the
// flat list of display names across every group, deduplicated.
func parseRosterNames(yamlBytes []byte) []string {
	// The YAML shape is `map[string][]string` (e.g.
	// `tank: [...]`, `dps: [...]`, `support: [...]` for heroes;
	// `control: [...]`, etc. for maps). Decoding straight into that
	// shape rejects unexpected nesting silently — we return an
	// empty slice rather than partial data so the FE empty-state
	// gate is binary.
	var grouped map[string][]string
	if err := yaml.Unmarshal(yamlBytes, &grouped); err != nil {
		return nil
	}
	seen := make(map[string]struct{})
	out := make([]string, 0, 64)
	for _, names := range grouped {
		for _, n := range names {
			if n == "" {
				continue
			}
			if _, dup := seen[n]; dup {
				continue
			}
			seen[n] = struct{}{}
			out = append(out, n)
		}
	}
	return out
}
