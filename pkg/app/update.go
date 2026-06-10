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

	// GameData carries the comparison between the user's currently-
	// applied game data (heroes / maps / screenshot sources, per
	// <RECALL_DATA_DIR>/data/manifest.json — or "embedded" if missing)
	// and the live main channel published at
	// https://sound-barrier.github.io/recall/data/. Always populated
	// when the Pages fetch succeeded; empty CommitSHA means the Pages
	// fetch failed (network / Pages outage / invalid version.json) and
	// the FE shows a "main unreachable" state.
	GameData GameDataStatus `json:"game_data"`
}

// RosterDiff is the shared shape GameDataStatus embeds. Mirrors the
// OpenAPI `RosterDiff` schema (factored via `allOf` from
// `GameDataStatus`). Embedding here is the Go-side equivalent of
// allOf composition: the JSON output is flat (no `roster_diff`
// wrapper key) because Go's `json` package promotes embedded-struct
// fields to the outer level by default.
type RosterDiff struct {
	HasUpdate      bool     `json:"has_update"`
	AddedHeroes    []string `json:"added_heroes,omitempty"`
	RemovedHeroes  []string `json:"removed_heroes,omitempty"`
	AddedMaps      []string `json:"added_maps,omitempty"`
	RemovedMaps    []string `json:"removed_maps,omitempty"`
	AddedSources   []string `json:"added_sources,omitempty"`
	RemovedSources []string `json:"removed_sources,omitempty"`
}

// GameDataStatus tracks the live main channel. CommitSHA /
// AppliedCommit identify the published vs applied main commits;
// HasUpdate (inherited from RosterDiff) is true whenever they differ.
// CommitSHA is empty when the Pages fetch fails — the FE uses an
// empty CommitSHA as the "main channel unavailable" signal.
type GameDataStatus struct {
	RosterDiff
	CommitSHA     string `json:"commit_sha"`
	CommittedAt   string `json:"committed_at,omitempty"`
	AppliedCommit string `json:"applied_commit"`
	AppliedAt     string `json:"applied_at,omitempty"`
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

// mainAssetURL builds the from-main asset URL. Var-seam so tests can
// route at an httptest.NewServer — same pattern as releaseAssetURL.
// Pages publishes the three YAMLs + per-file `.sha256` sidecars at
// https://sound-barrier.github.io/recall/data/ on every push to main
// that touches pkg/parser/*.yaml; see .github/workflows/pages.yml.
var mainAssetURL = func(name string) string {
	return "https://sound-barrier.github.io/recall/data/" + name
}

// mainVersionURL points at the version.json the Pages workflow
// publishes alongside the YAMLs. The file carries the commit SHA +
// committer date so the app can label what users applied
// ("Applied main @ abc1234 · 2 days ago"). Var-seam for tests.
var mainVersionURL = "https://sound-barrier.github.io/recall/data/version.json"

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

	// Fire the game-data (main-channel) fetch in parallel with the
	// release-channel binary-version fetch — they hit independent
	// hosts (api.github.com vs sound-barrier.github.io) so serial
	// would double the latency for no benefit. Joined at every return
	// path via gameDataChan; failures collapse to GameDataStatus{}
	// which the FE renders as "main channel unavailable".
	gameDataChan := make(chan GameDataStatus, 1)
	go func() {
		ver := fetchMainVersion()
		mh, mm, ms := fetchMainRosters()
		gameDataChan <- computeGameDataStatus(ver, mh, mm, ms)
	}()
	withGameData := func(u UpdateInfo) UpdateInfo {
		u.GameData = <-gameDataChan
		return u
	}

	client := newUpdateClient()
	resp, err := client.Get(releasesURL)
	if err != nil {
		// Drain the goroutine even on the network-failure path so it
		// doesn't leak. Empty-UpdateInfo is the contract the FE
		// already reads; the Main field stays its zero value.
		<-gameDataChan
		return UpdateInfo{}
	}
	defer func() { _ = resp.Body.Close() }()

	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
		Body    string `json:"body"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		<-gameDataChan
		return UpdateInfo{}
	}

	latest := strings.TrimPrefix(release.TagName, "v")
	if latest == "" {
		<-gameDataChan
		return UpdateInfo{}
	}

	now := time.Now().UTC()
	_ = TouchLastChecked(now)
	lastChecked := now.Format(time.RFC3339)
	notes := excerptReleaseNotes(release.Body)

	if isDev {
		return withGameData(UpdateInfo{
			Checked:       true,
			DevBuild:      true,
			Latest:        latest,
			URL:           release.HTMLURL,
			LastCheckedAt: lastChecked,
			ReleaseNotes:  notes,
		})
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
			return withGameData(UpdateInfo{
				Checked:       true,
				LastCheckedAt: lastChecked,
				ReleaseNotes:  notes,
			})
		}
		return withGameData(UpdateInfo{
			Checked:       true,
			Available:     true,
			Latest:        latest,
			URL:           release.HTMLURL,
			LastCheckedAt: lastChecked,
			ReleaseNotes:  notes,
		})
	}

	if !current.LessThan(upstream) {
		return withGameData(UpdateInfo{
			Checked:       true,
			LastCheckedAt: lastChecked,
			ReleaseNotes:  notes,
		})
	}
	heroes, maps, sources := fetchReleaseRosters(latest)
	return withGameData(UpdateInfo{
		Checked:       true,
		Available:     true,
		Latest:        latest,
		URL:           release.HTMLURL,
		LatestHeroes:  heroes,
		LatestMaps:    maps,
		LatestSources: sources,
		LastCheckedAt: lastChecked,
		ReleaseNotes:  notes,
	})
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
	client := newUpdateClient()

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

// mainVersion is the shape of data/version.json the Pages workflow
// publishes alongside the YAMLs. Both fields are always populated by
// the workflow; we tolerate either being empty for forward-compat.
type mainVersion struct {
	CommitSHA   string `json:"commit_sha"`
	CommittedAt string `json:"committed_at"`
}

// fetchMainVersion fetches the from-main metadata blob. Returns the
// zero value on any failure (network, decode, etc.) — callers treat
// an empty CommitSHA as "Pages channel unavailable" and skip the
// main-channel diff entirely.
func fetchMainVersion() mainVersion {
	client := newUpdateClient()
	b, err := getBytes(client, mainVersionURL)
	if err != nil {
		return mainVersion{}
	}
	var v mainVersion
	if err := json.Unmarshal(b, &v); err != nil {
		return mainVersion{}
	}
	return v
}

// fetchMainRosters downloads heroes.yaml + maps.yaml +
// screenshot_sources.yaml + per-file `.sha256` sidecars from the
// Pages-published live channel and returns the flat name lists. Same
// SHA-256 verification shape as fetchReleaseRosters; nil returned
// for any asset whose fetch or verification failed.
func fetchMainRosters() (heroes, maps, sources []string) {
	heroes = fetchMainAsset("heroes.yaml", parseRosterNames)
	maps = fetchMainAsset("maps.yaml", parseRosterNames)
	sources = fetchMainAsset("screenshot_sources.yaml", parseSourceNames)
	return heroes, maps, sources
}

func fetchMainAsset(name string, decode func([]byte) []string) []string {
	client := newUpdateClient()

	yamlBytes, err := getBytes(client, mainAssetURL(name))
	if err != nil {
		return nil
	}
	sumBytes, err := getBytes(client, mainAssetURL(name)+".sha256")
	if err != nil {
		return nil
	}
	if !verifySha256(yamlBytes, sumBytes) {
		return nil
	}
	return decode(yamlBytes)
}

// computeGameDataStatus reads the local manifest + currently-loaded
// rosters and returns a GameDataStatus showing what's different
// between the user's applied main commit (per manifest) and the
// freshly-fetched main rosters. Returns an empty GameDataStatus
// (CommitSHA="") when the Pages fetch failed — the FE uses CommitSHA
// as the "main channel reachable" gate.
func computeGameDataStatus(ver mainVersion, heroes, maps, sources []string) GameDataStatus {
	if ver.CommitSHA == "" {
		return GameDataStatus{}
	}
	manifest, _ := LoadManifest()
	gd := GameDataStatus{
		RosterDiff: RosterDiff{
			HasUpdate: manifest.AppliedSource != "main" || manifest.AppliedMainCommit != shortenCommitSHA(ver.CommitSHA),
		},
		CommitSHA:     shortenCommitSHA(ver.CommitSHA),
		CommittedAt:   ver.CommittedAt,
		AppliedCommit: manifest.AppliedMainCommit,
	}
	if manifest.AppliedSource == "main" && !manifest.AppliedAt.IsZero() {
		gd.AppliedAt = manifest.AppliedAt.UTC().Format(time.RFC3339)
	}
	if heroes != nil {
		gd.AddedHeroes, gd.RemovedHeroes = diffRosters(flattenRoster(parser.HeroesByRole()), heroes)
	}
	if maps != nil {
		gd.AddedMaps, gd.RemovedMaps = diffRosters(flattenRoster(parser.MapsByType()), maps)
	}
	if sources != nil {
		gd.AddedSources, gd.RemovedSources = diffRosters(sourceNames(parser.Sources()), sources)
	}
	return gd
}

// shortenCommitSHA trims a full 40-char SHA to the conventional
// 7-char short form. Tolerates already-short inputs unchanged.
func shortenCommitSHA(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

// updateAllowedHost reports whether h is a host we'll follow a
// redirect to during an update fetch. GitHub release-asset downloads
// 302 from github.com to the objects.githubusercontent.com CDN, so
// the *.githubusercontent.com suffix must be allowed; everything
// else is refused.
func updateAllowedHost(h string) bool {
	switch h {
	case "api.github.com", "github.com", "sound-barrier.github.io":
		return true
	}
	return strings.HasSuffix(h, ".githubusercontent.com")
}

// newUpdateClient is the http.Client used for every update fetch: a
// 5 s timeout plus a redirect guard. The guard refuses to follow a
// redirect to a host outside the GitHub / Pages allowlist or to a
// non-HTTPS scheme, and caps the chain at 10 hops.
//
// Trust model (review finding F4): the app runs on a home-lab LAN
// with no TLS pinning, so a LAN-level MITM that can spoof github.com
// could still serve a payload — but the SHA-256 sidecar check
// (verifySha256) gates whether fetched data is *applied*, and this
// guard stops a spoofed redirect from bouncing the fetch to an
// arbitrary internal host (SSRF). The initial request URL is never
// user-controlled (it comes from the hardcoded var-seams above), so
// only redirects are gated — test seams pointing at 127.0.0.1 keep
// working because CheckRedirect doesn't fire on the first request.
func newUpdateClient() *http.Client {
	return &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("update: stopped after 10 redirects")
			}
			if req.URL.Scheme != "https" {
				return fmt.Errorf("update: refusing redirect to non-HTTPS %s", req.URL.Redacted())
			}
			if !updateAllowedHost(req.URL.Hostname()) {
				return fmt.Errorf("update: refusing redirect to disallowed host %q", req.URL.Hostname())
			}
			return nil
		},
	}
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
//
// Trust-model note (review finding F4): the sidecar is fetched over
// the SAME channel as the payload (both from GitHub Releases / Pages),
// so a full LAN-MITM that can substitute the payload can also
// substitute its sidecar and defeat this check. With public-internet
// TLS that's not reachable; on a hostile LAN with no TLS it is. We
// accept this for a home-lab tool — the data here is roster YAML, not
// secrets — but the limitation is real. Stronger options (a
// separate-channel signature, SLSA attestation verification) are
// deferred. The redirect guard in newUpdateClient bounds the
// adjacent SSRF risk regardless.
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
