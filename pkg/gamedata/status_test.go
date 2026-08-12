package gamedata_test

import (
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"

	"recall/pkg/gamedata"
	"recall/pkg/parser"
)

// embeddedSeasonsYAML renders the EMBEDDED season list back to the on-the-wire
// YAML shape. These fixtures used to be hand-copied literals, so every shipped
// season broke them with "season N removed" — which reads like a diffing bug
// rather than a stale fixture. Derived, they cannot drift.
func embeddedSeasonsYAML(t *testing.T) string {
	t.Helper()
	type entry struct {
		Name    string `yaml:"name"`
		Chapter string `yaml:"chapter"`
		Number  int    `yaml:"number"`
		Start   string `yaml:"start"`
		End     string `yaml:"end"`
	}
	var doc struct {
		Seasons []entry `yaml:"seasons"`
	}
	for _, s := range parser.Seasons() {
		doc.Seasons = append(doc.Seasons, entry{
			Name:    s.Name,
			Chapter: s.Chapter,
			Number:  s.Number,
			Start:   s.Start.UTC().Format(time.RFC3339),
			End:     s.End.UTC().Format(time.RFC3339),
		})
	}
	out, err := yaml.Marshal(doc)
	if err != nil {
		t.Fatalf("marshal embedded seasons: %v", err)
	}
	return string(out)
}

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

// A freshly-published main commit that carries the SAME rosters the app
// already has must NOT read as an update. pages.yml republishes version.json
// (a new commit SHA + date) on testdata/openapi/docs changes too, so a
// commit-only comparison flags a phantom "update available" — and the UI then
// shows "your roster data is N days old" — when heroes & maps are byte-identical.
// has_update must be driven by roster content, not the commit SHA.
func TestComputeGameDataStatus_IdenticalRosters_NoUpdate(t *testing.T) {
	heroes := flattenRoster(parser.HeroesByRole())
	maps := flattenRoster(parser.MapsByGameMode())
	sources := sourceNames(parser.Sources())

	gd := gamedata.ComputeGameDataStatusForTest(
		t.TempDir(), "abcdef1234567", "2026-06-17T00:00:00Z", heroes, maps, sources, "")

	if gd.HasUpdate {
		t.Errorf("HasUpdate = true for byte-identical rosters; want false (no roster change → no update)")
	}
	if n := len(gd.AddedHeroes) + len(gd.RemovedHeroes) + len(gd.AddedMaps) + len(gd.RemovedMaps) +
		len(gd.AddedSources) + len(gd.RemovedSources); n != 0 {
		t.Errorf("expected empty roster diff, got %d changes (added heroes %v, added maps %v)",
			n, gd.AddedHeroes, gd.AddedMaps)
	}
}

// applied_at is what the FE stamps its "Applied main @ <commit> · N days ago"
// label from, so it may only be filled when the manifest actually records a
// main-channel apply that happened. A manifest from the retired release
// channel, or a main manifest with no timestamp, must leave it empty —
// otherwise the UI dates an apply the user never made from main, next to an
// empty applied_commit.
func TestComputeGameDataStatus_AppliedAt_OnlyFromDatedMainManifest(t *testing.T) {
	applied := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name     string
		manifest gamedata.DataManifest
		want     string
	}{
		{
			name:     "dated main apply is stamped",
			manifest: gamedata.DataManifest{AppliedSource: "main", AppliedMainCommit: "abc1234", AppliedAt: applied},
			want:     "2026-08-01T12:00:00Z",
		},
		{
			name:     "release-channel manifest is not",
			manifest: gamedata.DataManifest{AppliedSource: "release", AppliedReleaseTag: "0.9.0", AppliedAt: applied},
			want:     "",
		},
		{
			name:     "main manifest with no timestamp is not",
			manifest: gamedata.DataManifest{AppliedSource: "main", AppliedMainCommit: "abc1234"},
			want:     "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseDir := t.TempDir()
			if err := gamedata.SaveManifest(baseDir, tt.manifest); err != nil {
				t.Fatalf("SaveManifest: %v", err)
			}
			gd := gamedata.ComputeGameDataStatusForTest(
				baseDir, "abcdef1234567", "2026-08-02T00:00:00Z", nil, nil, nil, "")
			if gd.AppliedAt != tt.want {
				t.Errorf("AppliedAt = %q, want %q", gd.AppliedAt, tt.want)
			}
		})
	}
}

// A genuinely new hero in the fetched roster IS an update, surfaced in the diff.
func TestComputeGameDataStatus_NewHero_HasUpdate(t *testing.T) {
	heroes := append(flattenRoster(parser.HeroesByRole()), "Totally New Hero")
	maps := flattenRoster(parser.MapsByGameMode())
	sources := sourceNames(parser.Sources())

	gd := gamedata.ComputeGameDataStatusForTest(
		t.TempDir(), "abcdef1234567", "2026-07-01T00:00:00Z", heroes, maps, sources, "")

	if !gd.HasUpdate {
		t.Fatal("HasUpdate = false; want true when a new hero appears in the fetched roster")
	}
	found := false
	for _, h := range gd.AddedHeroes {
		if h == "Totally New Hero" {
			found = true
		}
	}
	if !found {
		t.Errorf("AddedHeroes = %v; want it to contain the new hero", gd.AddedHeroes)
	}
}

// A season whose end date shifted (same name, different window) is a
// content-based update — the name-list diff heroes/maps use would miss it.
func TestComputeGameDataStatus_ChangedSeasonWindow_HasUpdate(t *testing.T) {
	heroes := flattenRoster(parser.HeroesByRole())
	maps := flattenRoster(parser.MapsByGameMode())
	sources := sourceNames(parser.Sources())

	// The embedded list with the NEWEST season's end shifted by a day — the
	// "a corrected end date ships as an update" case the seasons.yaml header
	// describes. Derived from the embedded set so only the one field differs.
	newest := parser.Seasons()[len(parser.Seasons())-1]
	shifted := newest.End.UTC().AddDate(0, 0, 1).Format(time.RFC3339)
	liveSeasons := strings.Replace(
		embeddedSeasonsYAML(t),
		newest.End.UTC().Format(time.RFC3339),
		shifted, 1)

	gd := gamedata.ComputeGameDataStatusForTest(
		t.TempDir(), "abcdef1234567", "2026-07-01T00:00:00Z", heroes, maps, sources, liveSeasons)

	if !gd.HasUpdate {
		t.Fatal("HasUpdate = false; want true when a season window changed")
	}
	if len(gd.ChangedSeasons) != 1 || gd.ChangedSeasons[0] != newest.Name {
		t.Errorf("ChangedSeasons = %v, want [%s]", gd.ChangedSeasons, newest.Name)
	}
	if len(gd.AddedSeasons) != 0 || len(gd.RemovedSeasons) != 0 {
		t.Errorf("added/removed should be empty: +%v -%v", gd.AddedSeasons, gd.RemovedSeasons)
	}
}

// Byte-identical live seasons produce no season diff.
func TestComputeGameDataStatus_IdenticalSeasons_NoSeasonDiff(t *testing.T) {
	heroes := flattenRoster(parser.HeroesByRole())
	maps := flattenRoster(parser.MapsByGameMode())
	sources := sourceNames(parser.Sources())
	identical := embeddedSeasonsYAML(t)

	gd := gamedata.ComputeGameDataStatusForTest(
		t.TempDir(), "abcdef1234567", "2026-07-01T00:00:00Z", heroes, maps, sources, identical)
	if len(gd.AddedSeasons)+len(gd.RemovedSeasons)+len(gd.ChangedSeasons) != 0 {
		t.Errorf("identical seasons should not diff: +%v -%v ~%v", gd.AddedSeasons, gd.RemovedSeasons, gd.ChangedSeasons)
	}
}
