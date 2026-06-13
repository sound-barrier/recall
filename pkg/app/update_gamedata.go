package app

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"gopkg.in/yaml.v3"

	"recall/pkg/parser"
)

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

// flattenRoster takes a role/type-grouped map of canonical display
// names (parser.HeroesByRole / parser.MapsByGameMode output) and returns a
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
		gd.AddedMaps, gd.RemovedMaps = diffRosters(flattenRoster(parser.MapsByGameMode()), maps)
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
