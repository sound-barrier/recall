package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"
	"gopkg.in/yaml.v3"

	"recall/pkg/parser"
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

	// LatestSources is the screenshot-source name list extracted from
	// the release's `recall-<version>-screenshot_sources.yaml` asset.
	// Empty when the fetch fails or the SHA-256 sidecar rejects.
	LatestSources []string `json:"latest_sources,omitempty"`

	// LastCheckedAt records when this install last received a
	// successful CheckForUpdate response, persisted to
	// <RECALL_DATA_DIR>/check_state.json. Drives the "haven't checked
	// in a while" banner. RFC3339 / UTC.
	LastCheckedAt string `json:"last_checked_at,omitempty"`

	// ReleaseNotes is the first ~500 chars of the release's `body`
	// field, surfaced in the update-check modal. Markdown is passed
	// through unchanged; the FE escapes it via Vue's default
	// interpolation (never v-html).
	ReleaseNotes string `json:"release_notes,omitempty"`

	// Data carries the comparison between the user's
	// currently-applied data (per <RECALL_DATA_DIR>/data/manifest.json,
	// or "embedded" if missing) and the latest release's data
	// assets — so the FE can show "Apply update" diffs without
	// re-fetching.
	Data DataStatus `json:"data"`
}

// DataStatus summarises what's different between the user's
// currently-loaded reference data and the latest published release.
// AppliedTag == "" + HasUpdate == true means the install is running
// on embedded data only.
type DataStatus struct {
	AppliedTag     string   `json:"applied_tag"`
	AppliedAt      string   `json:"applied_at,omitempty"`
	HasUpdate      bool     `json:"has_update"`
	AddedHeroes    []string `json:"added_heroes,omitempty"`
	RemovedHeroes  []string `json:"removed_heroes,omitempty"`
	AddedMaps      []string `json:"added_maps,omitempty"`
	RemovedMaps    []string `json:"removed_maps,omitempty"`
	AddedSources   []string `json:"added_sources,omitempty"`
	RemovedSources []string `json:"removed_sources,omitempty"`
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
//
// On every successful API response (including "up to date" + dev-build
// branches), the install's last-checked timestamp is persisted via
// TouchLastChecked so the "haven't checked in a while" banner has a
// canonical source of truth.
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
		Body    string `json:"body"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return UpdateInfo{}
	}

	latest := strings.TrimPrefix(release.TagName, "v")
	if latest == "" {
		return UpdateInfo{}
	}

	now := time.Now().UTC()
	_ = TouchLastChecked(now)
	lastChecked := now.Format(time.RFC3339)
	notes := excerptReleaseNotes(release.Body)

	if isDev {
		return UpdateInfo{
			Checked:       true,
			DevBuild:      true,
			Latest:        latest,
			URL:           release.HTMLURL,
			LastCheckedAt: lastChecked,
			ReleaseNotes:  notes,
			Data:          computeDataStatus(latest),
		}
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
			return UpdateInfo{
				Checked:       true,
				LastCheckedAt: lastChecked,
				ReleaseNotes:  notes,
				Data:          computeDataStatus(latest),
			}
		}
		return UpdateInfo{
			Checked:       true,
			Available:     true,
			Latest:        latest,
			URL:           release.HTMLURL,
			LastCheckedAt: lastChecked,
			ReleaseNotes:  notes,
			Data:          computeDataStatus(latest),
		}
	}

	if !current.LessThan(upstream) {
		return UpdateInfo{
			Checked:       true,
			LastCheckedAt: lastChecked,
			ReleaseNotes:  notes,
			Data:          computeDataStatus(latest),
		}
	}
	heroes, maps, sources := fetchReleaseRosters(latest)
	return UpdateInfo{
		Checked:       true,
		Available:     true,
		Latest:        latest,
		URL:           release.HTMLURL,
		LatestHeroes:  heroes,
		LatestMaps:    maps,
		LatestSources: sources,
		LastCheckedAt: lastChecked,
		ReleaseNotes:  notes,
		Data:          computeDataStatusWithFetched(latest, heroes, maps, sources),
	}
}

// releaseNotesMaxBytes caps the body excerpt surfaced into the modal.
// The release-notes section is interpolated into a Vue template
// (auto-escaped, never v-html) and rendered behind a "more on GitHub"
// link — 500 chars is enough headroom for one paragraph + a few
// bullet points without crowding out the diff section.
const releaseNotesMaxBytes = 500

// excerptReleaseNotes returns up to releaseNotesMaxBytes worth of the
// release body. Truncation breaks on a rune boundary so a multi-byte
// glyph can never split mid-codepoint. Trailing whitespace stripped.
func excerptReleaseNotes(body string) string {
	body = strings.TrimSpace(body)
	if len(body) <= releaseNotesMaxBytes {
		return body
	}
	cut := releaseNotesMaxBytes
	for cut > 0 && (body[cut]&0xC0) == 0x80 {
		cut-- // walk back into the rune
	}
	return strings.TrimRight(body[:cut], " \t\n") + "…"
}

// computeDataStatus reads the local manifest + currently-loaded
// rosters and returns a DataStatus showing the user's applied tag
// (or "" if running on embedded data). HasUpdate is true whenever
// the applied tag differs from the latest release — including the
// embedded-only case, since "embedded" is always considered behind.
//
// When the release rosters have NOT yet been fetched (up-to-date /
// dev-build branches), the diff fields stay empty.
func computeDataStatus(latestTag string) DataStatus {
	manifest, _ := LoadManifest()
	return dataStatusFrom(latestTag, manifest, nil, nil, nil)
}

// computeDataStatusWithFetched is the same shape as computeDataStatus
// but populates the diff using rosters fetched from the release.
func computeDataStatusWithFetched(latestTag string, heroes, maps, sources []string) DataStatus {
	manifest, _ := LoadManifest()
	return dataStatusFrom(latestTag, manifest, heroes, maps, sources)
}

func dataStatusFrom(latestTag string, m DataManifest, releaseHeroes, releaseMaps, releaseSources []string) DataStatus {
	ds := DataStatus{
		AppliedTag: m.AppliedReleaseTag,
		HasUpdate:  m.AppliedReleaseTag != latestTag,
	}
	if !m.AppliedAt.IsZero() {
		ds.AppliedAt = m.AppliedAt.UTC().Format(time.RFC3339)
	}
	if releaseHeroes != nil {
		ds.AddedHeroes, ds.RemovedHeroes = diffRosters(flattenRoster(parser.HeroesByRole()), releaseHeroes)
	}
	if releaseMaps != nil {
		ds.AddedMaps, ds.RemovedMaps = diffRosters(flattenRoster(parser.MapsByType()), releaseMaps)
	}
	if releaseSources != nil {
		ds.AddedSources, ds.RemovedSources = diffRosters(sourceNames(parser.Sources()), releaseSources)
	}
	return ds
}

// flattenRoster takes a role/type-grouped map of canonical display
// names (parser.HeroesByRole / parser.MapsByType output) and returns a
// flat slice for diffing.
func flattenRoster(grouped map[string][]string) []string {
	out := make([]string, 0, 32)
	for _, names := range grouped {
		out = append(out, names...)
	}
	return out
}

func sourceNames(sources []parser.ScreenshotSource) []string {
	out := make([]string, 0, len(sources))
	for _, s := range sources {
		out = append(out, s.Name)
	}
	return out
}

// diffRosters returns (added, removed) by comparing `applied` to
// `latest`. Both sides are deduplicated. Output is sorted for stable
// UI rendering.
func diffRosters(applied, latest []string) (added, removed []string) {
	appliedSet := make(map[string]struct{}, len(applied))
	for _, a := range applied {
		appliedSet[a] = struct{}{}
	}
	latestSet := make(map[string]struct{}, len(latest))
	for _, l := range latest {
		latestSet[l] = struct{}{}
	}
	for l := range latestSet {
		if _, ok := appliedSet[l]; !ok {
			added = append(added, l)
		}
	}
	for a := range appliedSet {
		if _, ok := latestSet[a]; !ok {
			removed = append(removed, a)
		}
	}
	sort.Strings(added)
	sort.Strings(removed)
	return
}

// fetchReleaseRosters downloads the release's `heroes.yaml`,
// `maps.yaml`, and `screenshot_sources.yaml` assets, verifies each
// against its published `.sha256` sidecar, parses the YAML, and
// returns the flat display-name lists.
//
// Trust model: TLS protects the HTTPS fetch against MITM. The .sha256
// sidecar is fetched from the same release; verifying the YAML
// against it defends against asset corruption on GitHub's side AND
// against a fetcher that confused itself by mid-stream truncation.
// Stronger SLSA/in-toto verification could go on top later (the
// release pipeline already publishes attestations); the sidecar
// check is the floor.
//
// Returns nil slices for any individual asset that fails — callers
// treat empty as "no upgrade hint available" + fall back to generic
// copy. heroes/maps share the parseRosterNames helper; sources uses
// its own parser since the YAML shape is `{sources: [{name, ...}]}`.
func fetchReleaseRosters(version string) (heroes, maps, sources []string) {
	heroes = fetchAsset(version, "heroes.yaml", parseRosterNames)
	maps = fetchAsset(version, "maps.yaml", parseRosterNames)
	sources = fetchAsset(version, "screenshot_sources.yaml", parseSourceNames)
	return heroes, maps, sources
}

// fetchAsset downloads <release>/recall-<v>-<name> + its .sha256
// sidecar, verifies the SHA, and returns the flat name list extracted
// by `decode`. Empty slice on any failure (network / status / SHA
// mismatch / decode error).
func fetchAsset(version, name string, decode func([]byte) []string) []string {
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

	return decode(yamlBytes)
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

// parseSourceNames reads the screenshot_sources.yaml structure
// (`sources: [{name, prefix, regex, ...}]`) and returns the flat
// list of source names, deduplicated. Blank entries dropped.
func parseSourceNames(yamlBytes []byte) []string {
	var wrapped struct {
		Sources []struct {
			Name string `yaml:"name"`
		} `yaml:"sources"`
	}
	if err := yaml.Unmarshal(yamlBytes, &wrapped); err != nil {
		return nil
	}
	seen := make(map[string]struct{}, len(wrapped.Sources))
	out := make([]string, 0, len(wrapped.Sources))
	for _, s := range wrapped.Sources {
		if s.Name == "" {
			continue
		}
		if _, dup := seen[s.Name]; dup {
			continue
		}
		seen[s.Name] = struct{}{}
		out = append(out, s.Name)
	}
	return out
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
