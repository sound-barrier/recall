package gamedata_test

import (
	"testing"

	"recall/pkg/gamedata"
	"recall/pkg/parser"
)

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

	// Live seasons.yaml with Season 3's end corrected (Aug 11 → Aug 12).
	liveSeasons := `seasons:
  - name: "Reign of Talon — Season 1"
    chapter: "Reign of Talon"
    number: 1
    start: "2026-02-10T19:00:00Z"
    end: "2026-04-14T19:00:00Z"
  - name: "Reign of Talon — Season 2"
    chapter: "Reign of Talon"
    number: 2
    start: "2026-04-14T19:00:00Z"
    end: "2026-06-16T19:00:00Z"
  - name: "Reign of Talon — Season 3"
    chapter: "Reign of Talon"
    number: 3
    start: "2026-06-16T19:00:00Z"
    end: "2026-08-12T19:00:00Z"
`
	gd := gamedata.ComputeGameDataStatusForTest(
		t.TempDir(), "abcdef1234567", "2026-07-01T00:00:00Z", heroes, maps, sources, liveSeasons)

	if !gd.HasUpdate {
		t.Fatal("HasUpdate = false; want true when a season window changed")
	}
	if len(gd.ChangedSeasons) != 1 || gd.ChangedSeasons[0] != "Reign of Talon — Season 3" {
		t.Errorf("ChangedSeasons = %v, want [Reign of Talon — Season 3]", gd.ChangedSeasons)
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
	identical := `seasons:
  - name: "Reign of Talon — Season 1"
    chapter: "Reign of Talon"
    number: 1
    start: "2026-02-10T19:00:00Z"
    end: "2026-04-14T19:00:00Z"
  - name: "Reign of Talon — Season 2"
    chapter: "Reign of Talon"
    number: 2
    start: "2026-04-14T19:00:00Z"
    end: "2026-06-16T19:00:00Z"
  - name: "Reign of Talon — Season 3"
    chapter: "Reign of Talon"
    number: 3
    start: "2026-06-16T19:00:00Z"
    end: "2026-08-11T19:00:00Z"
`
	gd := gamedata.ComputeGameDataStatusForTest(
		t.TempDir(), "abcdef1234567", "2026-07-01T00:00:00Z", heroes, maps, sources, identical)
	if len(gd.AddedSeasons)+len(gd.RemovedSeasons)+len(gd.ChangedSeasons) != 0 {
		t.Errorf("identical seasons should not diff: +%v -%v ~%v", gd.AddedSeasons, gd.RemovedSeasons, gd.ChangedSeasons)
	}
}
