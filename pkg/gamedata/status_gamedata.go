package gamedata

import (
	"sort"
	"time"

	"recall/pkg/parser"
)

// Status/diff side of the game-data update pipeline: the wire-shape Status /
// RosterDiff types plus the roster and season diffing that decides whether an
// update exists. The fetch side feeding it lives in fetch_gamedata.go.

// RosterDiff is the shared shape Status embeds. Mirrors the
// OpenAPI `RosterDiff` schema (factored via `allOf` from
// `Status`). Embedding here is the Go-side equivalent of
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

// Status tracks the live main channel. CommitSHA /
// AppliedCommit identify the published vs applied main commits;
// HasUpdate (inherited from RosterDiff) is true whenever they differ.
// CommitSHA is empty when the Pages fetch fails — the FE uses an
// empty CommitSHA as the "main channel unavailable" signal.
type Status struct {
	RosterDiff
	CommitSHA     string `json:"commit_sha"`
	CommittedAt   string `json:"committed_at,omitempty"`
	AppliedCommit string `json:"applied_commit"`
	AppliedAt     string `json:"applied_at,omitempty"`
}

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

// FetchStatus fetches the main-channel version + rosters and diffs them
// against the local manifest + currently-loaded parser tables. The
// one-call surface the app shell's background game-data probe uses.
func FetchStatus(baseDir string) Status {
	// Same client across version.json + all three rosters + sidecars —
	// eight sequential GETs to one Pages host per background probe.
	client := NewUpdateClient()
	ver := fetchMainVersion(client)
	heroes, maps, sources := fetchMainRosters(client)
	seasons := fetchMainSeasons(client)
	return computeGameDataStatus(baseDir, ver, heroes, maps, sources, seasons)
}

// computeGameDataStatus reads the local manifest + currently-loaded
// rosters and returns a Status showing what's different
// between the user's applied main commit (per manifest) and the
// freshly-fetched main rosters. Returns an empty Status
// (CommitSHA="") when the Pages fetch failed — the FE uses CommitSHA
// as the "main channel reachable" gate.
func computeGameDataStatus(baseDir string, ver mainVersion, heroes, maps, sources []string, seasons []seasonMeta) Status {
	if ver.CommitSHA == "" {
		return Status{}
	}
	manifest, _ := LoadManifest(baseDir)
	gd := Status{
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
		if seasonContentDiffers(a, l) {
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

// seasonContentDiffers reports whether a same-name season's content — its
// chapter, number, or window — changed between the applied and live sets.
func seasonContentDiffers(a parser.Season, l seasonMeta) bool {
	return a.Chapter != l.chapter || a.Number != l.number ||
		!a.Start.Equal(l.start) || !a.End.Equal(l.end)
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
