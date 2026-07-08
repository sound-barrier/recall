package gamedata

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
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
	// Seasons diff by NAME. Unlike the roster name-lists, a season's content
	// is its window, so a same-name entry with a shifted start/end shows up in
	// ChangedSeasons (a corrected end date IS an update).
	AddedSeasons   []string `json:"added_seasons,omitempty"`
	RemovedSeasons []string `json:"removed_seasons,omitempty"`
	ChangedSeasons []string `json:"changed_seasons,omitempty"`
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

// flattenRoster takes a role/type-grouped map of canonical display
// names (parser.HeroesByRole / parser.MapsByGameMode output) and returns a
// flat slice for diffing.
func flattenRoster(grouped map[string][]string) []string {
	total := 0
	for _, names := range grouped {
		total += len(names)
	}
	out := make([]string, 0, total)
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

// Status fetches the main-channel version + rosters and diffs them
// against the local manifest + currently-loaded parser tables. The
// one-call surface the app shell's background game-data probe uses.
func Status(baseDir string) GameDataStatus {
	// Same client across version.json + all three rosters + sidecars —
	// eight sequential GETs to one Pages host per background probe.
	client := NewUpdateClient()
	ver := fetchMainVersion(client)
	heroes, maps, sources := fetchMainRosters(client)
	seasons := fetchMainSeasons(client)
	return computeGameDataStatus(baseDir, ver, heroes, maps, sources, seasons)
}

// computeGameDataStatus reads the local manifest + currently-loaded
// rosters and returns a GameDataStatus showing what's different
// between the user's applied main commit (per manifest) and the
// freshly-fetched main rosters. Returns an empty GameDataStatus
// (CommitSHA="") when the Pages fetch failed — the FE uses CommitSHA
// as the "main channel reachable" gate.
func computeGameDataStatus(baseDir string, ver mainVersion, heroes, maps, sources []string, seasons []seasonMeta) GameDataStatus {
	if ver.CommitSHA == "" {
		return GameDataStatus{}
	}
	manifest, _ := LoadManifest(baseDir)
	gd := GameDataStatus{
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
	if seasons != nil {
		gd.AddedSeasons, gd.RemovedSeasons, gd.ChangedSeasons = diffSeasons(parser.Seasons(), seasons)
	}
	// Content-based: an update exists only when the live rosters actually differ
	// from what the app already has — NOT when the published main commit merely
	// advanced. pages.yml republishes version.json on testdata/openapi/docs
	// changes too, so a commit-SHA comparison flagged a phantom "update
	// available" (and the UI's "roster data is N days old") when heroes & maps
	// were byte-identical. Keying off the diff makes the signal reflect the
	// roster, not release cadence.
	gd.HasUpdate = len(gd.AddedHeroes)+len(gd.RemovedHeroes)+
		len(gd.AddedMaps)+len(gd.RemovedMaps)+
		len(gd.AddedSources)+len(gd.RemovedSources)+
		len(gd.AddedSeasons)+len(gd.RemovedSeasons)+len(gd.ChangedSeasons) > 0
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

// seasonMeta is the comparable form of one live season fetched from Pages —
// name is the diff key, the rest is the content a same-name change compares.
type seasonMeta struct {
	name, chapter string
	number        int
	start, end    time.Time
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

// diffSeasons compares the currently-loaded seasons against the live set by
// NAME: added (live-only), removed (applied-only), changed (same name, differing
// chapter/number/start/end). Each list is sorted for stable UI rendering.
func diffSeasons(applied []parser.Season, live []seasonMeta) (added, removed, changed []string) {
	appliedByName := make(map[string]parser.Season, len(applied))
	for _, s := range applied {
		appliedByName[s.Name] = s
	}
	liveByName := make(map[string]seasonMeta, len(live))
	for _, s := range live {
		liveByName[s.name] = s
	}
	for name, l := range liveByName {
		a, ok := appliedByName[name]
		if !ok {
			added = append(added, name)
			continue
		}
		if a.Chapter != l.chapter || a.Number != l.number || !a.Start.Equal(l.start) || !a.End.Equal(l.end) {
			changed = append(changed, name)
		}
	}
	for name := range appliedByName {
		if _, ok := liveByName[name]; !ok {
			removed = append(removed, name)
		}
	}
	sort.Strings(added)
	sort.Strings(removed)
	sort.Strings(changed)
	return added, removed, changed
}

// seasonMetasFromParser adapts loaded parser seasons to the diff's meta shape
// (the apply path compares two loaded sets, not a fetched YAML).
func seasonMetasFromParser(seasons []parser.Season) []seasonMeta {
	out := make([]seasonMeta, 0, len(seasons))
	for _, s := range seasons {
		out = append(out, seasonMeta{name: s.Name, chapter: s.Chapter, number: s.Number, start: s.Start.UTC(), end: s.End.UTC()})
	}
	return out
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
