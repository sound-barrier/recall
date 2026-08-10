package gamedata

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// Fetch side of the game-data update pipeline: the release walk, the
// Pages-published main channel, per-asset SHA-256 verification, and the YAML
// decoders that turn fetched bytes into comparable name lists / season metas.
// The status/diff side that consumes these lives in status_gamedata.go.

// ReleaseAssetURL builds the public-asset URL for a release file.
// Exported package var: tests swap it for an
// httptest.NewServer-routed builder. The released-asset attestation
// PR (#220) ships `recall-<version>-heroes.yaml`,
// `recall-<version>-maps.yaml`, and `<file>.sha256` sidecars for both
// at this prefix.
var ReleaseAssetURL = func(version, name string) string {
	return fmt.Sprintf(
		"https://github.com/sound-barrier/recall/releases/download/v%s/recall-%s-%s",
		version, version, name,
	)
}

// ReleaseListURL is the GitHub API endpoint listing releases newest-first.
// FetchReleaseRosters walks this list to find the most recent release that
// still carries a given roster YAML — release.yml only attaches heroes.yaml /
// maps.yaml when they changed, so the latest release may omit an unchanged one.
// Var-seam: tests route it at an httptest.NewServer.
var ReleaseListURL = "https://api.github.com/repos/sound-barrier/recall/releases?per_page=30"

// MainAssetURL builds the from-main asset URL. Var-seam so tests can
// route at an httptest.NewServer — same pattern as ReleaseAssetURL.
// Pages publishes the three YAMLs + per-file `.sha256` sidecars at
// https://sound-barrier.github.io/recall/data/ on every push to main
// that touches pkg/parser/*.yaml; see .github/workflows/pages.yml.
var MainAssetURL = func(name string) string {
	return "https://sound-barrier.github.io/recall/data/" + name
}

// MainVersionURL points at the version.json the Pages workflow
// publishes alongside the YAMLs. The file carries the commit SHA +
// committer date so the app can label what users applied
// ("Applied main @ abc1234 · 2 days ago"). Var-seam for tests.
var MainVersionURL = "https://sound-barrier.github.io/recall/data/version.json"

// FetchReleaseRosters downloads the release's `heroes.yaml`,
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
func FetchReleaseRosters(latest string) (heroes, maps, sources []string) {
	// One client for the whole check: every asset + sidecar + the release
	// list hit the same GitHub hosts, so sharing the transport reuses
	// connections and TLS state across the up-to-dozens of GETs a
	// release walk can issue.
	client := NewUpdateClient()
	order := releaseWalkOrder(client, latest)
	heroes = fetchAssetAcross(client, order, "heroes.yaml", parseRosterNames)
	maps = fetchAssetAcross(client, order, "maps.yaml", parseRosterNames)
	sources = fetchAssetAcross(client, order, "screenshot_sources.yaml", parseSourceNames)
	return heroes, maps, sources
}

// releaseWalkOrder returns the release versions to try for an asset, newest
// first: `latest` always leads, followed by every other tag from the GitHub
// releases list (newest-first, v-stripped, deduped). If the list fetch fails it
// degrades to just [latest] — the pre-walk-back behavior.
func releaseWalkOrder(client *http.Client, latest string) []string {
	order := []string{latest}
	seen := map[string]struct{}{latest: {}}
	for _, tag := range fetchReleaseTags(client) {
		if _, dup := seen[tag]; dup {
			continue
		}
		seen[tag] = struct{}{}
		order = append(order, tag)
	}
	return order
}

// fetchReleaseTags returns release tag versions (leading "v" stripped),
// newest-first, from the GitHub releases list. Empty on any failure — callers
// then only try `latest`.
func fetchReleaseTags(client *http.Client) []string {
	b, err := getBytes(client, ReleaseListURL)
	if err != nil {
		return nil
	}
	var releases []struct {
		TagName string `json:"tag_name"`
	}
	if err := json.Unmarshal(b, &releases); err != nil {
		return nil
	}
	tags := make([]string, 0, len(releases))
	for _, r := range releases {
		if r.TagName != "" {
			tags = append(tags, strings.TrimPrefix(r.TagName, "v"))
		}
	}
	return tags
}

// fetchAssetAcross tries each version in order and returns the first roster the
// release actually carries. nil only if no release in the walk has the asset.
func fetchAssetAcross(client *http.Client, versions []string, name string, decode func([]byte) []string) []string {
	for _, v := range versions {
		if names := fetchAsset(client, v, name, decode); names != nil {
			return names
		}
	}
	return nil
}

// fetchAsset downloads <release>/recall-<v>-<name> + its .sha256
// sidecar, verifies the SHA, and returns the flat name list extracted
// by `decode`. Empty slice on any failure (network / status / SHA
// mismatch / decode error).
func fetchAsset(client *http.Client, version, name string, decode func([]byte) []string) []string {
	yamlBytes, err := getBytes(client, ReleaseAssetURL(version, name))
	if err != nil {
		return nil
	}

	sumBytes, err := getBytes(client, ReleaseAssetURL(version, name)+".sha256")
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
func fetchMainVersion(client *http.Client) mainVersion {
	b, err := getBytes(client, MainVersionURL)
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
func fetchMainRosters(client *http.Client) (heroes, maps, sources []string) {
	heroes = fetchMainAsset(client, "heroes.yaml", parseRosterNames)
	maps = fetchMainAsset(client, "maps.yaml", parseRosterNames)
	sources = fetchMainAsset(client, "screenshot_sources.yaml", parseSourceNames)
	return heroes, maps, sources
}

func fetchMainAsset(client *http.Client, name string, decode func([]byte) []string) []string {
	yamlBytes, err := getBytes(client, MainAssetURL(name))
	if err != nil {
		return nil
	}
	sumBytes, err := getBytes(client, MainAssetURL(name)+".sha256")
	if err != nil {
		return nil
	}
	if !verifySha256(yamlBytes, sumBytes) {
		return nil
	}
	return decode(yamlBytes)
}

// fetchMainSeasons fetches + verifies the live seasons.yaml and returns its
// comparable metas (nil on any failure — the season diff is then skipped).
func fetchMainSeasons(client *http.Client) []seasonMeta {
	yamlBytes, err := getBytes(client, MainAssetURL("seasons.yaml"))
	if err != nil {
		return nil
	}
	sumBytes, err := getBytes(client, MainAssetURL("seasons.yaml")+".sha256")
	if err != nil {
		return nil
	}
	if !verifySha256(yamlBytes, sumBytes) {
		return nil
	}
	return parseSeasonMetas(yamlBytes)
}

// parseSeasonMetas decodes seasons.yaml into comparable metas, parsing the UTC
// instants so a re-formatted boundary (19:00:00Z vs 19:00Z) doesn't false-diff.
// nil on any error — the caller then skips the season diff (roster pattern).
func parseSeasonMetas(yamlBytes []byte) []seasonMeta {
	var wrapped struct {
		Seasons []struct {
			Name    string `yaml:"name"`
			Chapter string `yaml:"chapter"`
			Number  int    `yaml:"number"`
			Start   string `yaml:"start"`
			End     string `yaml:"end"`
		} `yaml:"seasons"`
	}
	if err := yaml.Unmarshal(yamlBytes, &wrapped); err != nil {
		return nil
	}
	out := make([]seasonMeta, 0, len(wrapped.Seasons))
	for _, s := range wrapped.Seasons {
		start, err1 := time.Parse(time.RFC3339, s.Start)
		end, err2 := time.Parse(time.RFC3339, s.End)
		if s.Name == "" || err1 != nil || err2 != nil {
			return nil // a malformed live file is not a partial diff
		}
		out = append(out, seasonMeta{name: s.Name, chapter: s.Chapter, number: s.Number, start: start.UTC(), end: end.UTC()})
	}
	return out
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
