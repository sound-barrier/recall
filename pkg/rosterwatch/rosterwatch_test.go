package rosterwatch_test

import (
	"slices"
	"testing"
	"time"

	"recall/pkg/rosterwatch"
)

// The comparison is the whole tool. Everything else is fetching bytes and
// printing; this is where "the game moved" is decided, so it is pure and
// table-driven and never touches the network.
//
// The rule underneath every case: a finding must be something a human can act
// on. "Upstream has a hero you don't" is actionable. "Upstream could not be
// read" is a different thing and must never look like the first.

// at parses an RFC 3339 instant or panics — fixture data, not input.
func at(s string) time.Time {
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return v
}

func shipped() rosterwatch.Shipped {
	return rosterwatch.Shipped{
		HeroesByRole: map[string][]string{"dps": {"Ashe", "Mei"}, "tank": {"D.va"}},
		// Three tracked modes, because the map comparison reads the tracked set
		// off this map — a fixture with one mode cannot exercise the filter.
		MapsByGameMode:  map[string][]string{"control": {"Ilios"}, "hybrid": {"King's Row"}, "push": {"Colosseo"}},
		NewestPatch:     at("2026-08-11T19:00:00Z"),
		NewestSeasonEnd: at("2126-10-13T19:00:00Z"),
	}
}

func upstream() rosterwatch.Upstream {
	return rosterwatch.Upstream{
		Heroes:     []rosterwatch.Hero{{Name: "Ashe", Role: "dps"}, {Name: "Mei", Role: "dps"}, {Name: "D.va", Role: "tank"}},
		Maps:       []rosterwatch.Map{{Name: "Ilios", GameMode: "control"}, {Name: "King's Row", GameMode: "hybrid"}},
		PatchDates: []time.Time{at("2026-08-11T00:00:00Z")},
	}
}

func kinds(r rosterwatch.Report) []string {
	out := make([]string, 0, len(r.Findings))
	for _, f := range r.Findings {
		out = append(out, f.Kind)
	}
	slices.Sort(out)
	return out
}

var now = at("2026-09-03T12:00:00Z")

func TestCompare_InSyncReportsNothing(t *testing.T) {
	got := rosterwatch.Compare(shipped(), upstream(), now, nil)
	if len(got.Findings) != 0 {
		t.Fatalf("findings = %+v, want none — the shipped roster matches upstream", got.Findings)
	}
	if got.Drifted() {
		t.Error("Drifted() = true with no findings")
	}
}

func TestCompare_NamesAHeroUpstreamHasAndTheRosterDoesNot(t *testing.T) {
	up := upstream()
	up.Heroes = append(up.Heroes, rosterwatch.Hero{Name: "Vantage", Role: "support"})

	got := rosterwatch.Compare(shipped(), up, now, nil)
	if !slices.Contains(kinds(got), rosterwatch.KindHeroMissing) {
		t.Fatalf("kinds = %v, want a %s finding", kinds(got), rosterwatch.KindHeroMissing)
	}
	f := got.Findings[0]
	if f.Name != "Vantage" || f.Group != "support" {
		t.Errorf("finding = %+v, want Vantage under support", f)
	}
}

func TestCompare_NamesAMapUpstreamHasAndTheRosterDoesNot(t *testing.T) {
	up := upstream()
	up.Maps = append(up.Maps, rosterwatch.Map{Name: "Runasapi", GameMode: "push"})

	got := rosterwatch.Compare(shipped(), up, now, nil)
	if !slices.Contains(kinds(got), rosterwatch.KindMapMissing) {
		t.Fatalf("kinds = %v, want a %s finding", kinds(got), rosterwatch.KindMapMissing)
	}
}

// A hero the ROSTER has and upstream does not is a spelling difference, not a
// removal — Blizzard does not delete heroes. This is the D.Va / D.va case that
// exists in the real roster today, and it must be reported as its own kind so
// it can be accepted separately from a genuine addition.
func TestCompare_ReportsASpellingDifferenceRatherThanARemoval(t *testing.T) {
	ship := shipped()
	ship.HeroesByRole["tank"] = []string{"D.va"}
	up := upstream()
	up.Heroes = []rosterwatch.Hero{{Name: "Ashe", Role: "dps"}, {Name: "Mei", Role: "dps"}, {Name: "D.Va", Role: "tank"}}

	got := rosterwatch.Compare(ship, up, now, nil)
	if !slices.Contains(kinds(got), rosterwatch.KindHeroSpelling) {
		t.Fatalf("kinds = %v, want a %s finding", kinds(got), rosterwatch.KindHeroSpelling)
	}
	// And NOT an addition: "D.Va" and "D.va" are the same hero. Reporting both
	// would ask the maintainer to add a hero they already have.
	if slices.Contains(kinds(got), rosterwatch.KindHeroMissing) {
		t.Errorf("kinds = %v, must not also claim the hero is missing", kinds(got))
	}
}

// maps.yaml tracks the COMPETITIVE modes only. Upstream lists every map in the
// game — deathmatch, workshop, the practice range — and proposing those would
// bury a real new map under two dozen that do not belong in the file.
//
// The filter reads the modes off the shipped file rather than hard-coding
// them, so it cannot fall out of step with what maps.yaml actually files under.
func TestCompare_IgnoresAMapInAModeTheRosterDoesNotTrack(t *testing.T) {
	up := upstream()
	up.Maps = append(up.Maps,
		rosterwatch.Map{Name: "Petra", GameMode: "deathmatch"},
		rosterwatch.Map{Name: "Workshop Island", GameMode: "workshop"},
		rosterwatch.Map{Name: "Redwood Dam", GameMode: "push"})

	got := rosterwatch.Compare(shipped(), up, now, nil)
	if len(got.Findings) != 1 {
		t.Fatalf("findings = %+v, want only the push map", got.Findings)
	}
	if got.Findings[0].Name != "Redwood Dam" {
		t.Errorf("finding = %+v, want Redwood Dam", got.Findings[0])
	}
}

// A map the roster spells differently is a spelling difference, not a second
// map. Reported as an addition it would be APPLIED as one, leaving the roster
// carrying both — which is how "Hanoaka" and "Hanaoka" would have ended up
// side by side, the exact shape of the Neon Function incident.
func TestCompare_ReportsAMapSpellingRatherThanASecondMap(t *testing.T) {
	ship := shipped()
	ship.MapsByGameMode["clash"] = []string{"Hanoaka"}
	up := upstream()
	up.Maps = append(up.Maps, rosterwatch.Map{Name: "Hanaoka", GameMode: "clash"})

	got := rosterwatch.Compare(ship, up, now, nil)
	if len(got.Findings) != 1 || got.Findings[0].Kind != rosterwatch.KindMapSpelling {
		t.Fatalf("findings = %+v, want one %s", got.Findings, rosterwatch.KindMapSpelling)
	}
}

// Upstream writes King's Row with a typographic apostrophe; the roster uses the
// ASCII one. parser.Normalize folds diacritics and colons but not quote marks,
// so without folding here the app's most-played map reads as missing.
func TestCompare_FoldsATypographicApostrophe(t *testing.T) {
	up := upstream()
	up.Maps = []rosterwatch.Map{{Name: "Ilios", GameMode: "control"}, {Name: "King\u2019s Row", GameMode: "hybrid"}}

	got := rosterwatch.Compare(shipped(), up, now, nil)
	if len(got.Findings) != 0 {
		t.Fatalf("findings = %+v, want none — it is the same map", got.Findings)
	}
}

// A dropped colon IS reported, and a quote-style difference is not — the line
// between them is whether the roster made a choice.
//
// U+2019 and U+0027 are two renderings of one apostrophe; neither spelling is a
// decision anybody took. But the roster keeps the colon in "Soldier: 76" and
// drops it in "Watchpoint Gibraltar", so dropping it is a choice, and a choice
// that disagrees with Blizzard is worth putting in front of the maintainer
// once. The accepted list is where it goes to rest.
func TestCompare_ReportsADroppedColonEvenThoughItStillMatches(t *testing.T) {
	ship := shipped()
	ship.MapsByGameMode["escort"] = []string{"Watchpoint Gibraltar"}
	up := upstream()
	up.Maps = append(up.Maps, rosterwatch.Map{Name: "Watchpoint: Gibraltar", GameMode: "escort"})

	got := rosterwatch.Compare(ship, up, now, nil)
	if len(got.Findings) != 1 || got.Findings[0].Kind != rosterwatch.KindMapSpelling {
		t.Fatalf("findings = %+v, want one %s", got.Findings, rosterwatch.KindMapSpelling)
	}
	// Reported as a spelling, never as a missing map: the two names already
	// match on the comparison key, so writing it would add a duplicate.
	if got.Findings[0].Kind == rosterwatch.KindMapMissing {
		t.Error("a dropped colon must not propose a second map")
	}
}

func TestCompare_NamesAPatchNewerThanTheNewestShipped(t *testing.T) {
	up := upstream()
	up.PatchDates = append(up.PatchDates, at("2026-08-19T00:00:00Z"))

	got := rosterwatch.Compare(shipped(), up, now, nil)
	if !slices.Contains(kinds(got), rosterwatch.KindPatchMissing) {
		t.Fatalf("kinds = %v, want a %s finding", kinds(got), rosterwatch.KindPatchMissing)
	}
}

// The season half is local-only: no source publishes the next season's window,
// so the signal is that the shipped one has run out.
func TestCompare_SaysTheSeasonRanOutWhenItsEndHasPassed(t *testing.T) {
	ship := shipped()
	ship.NewestSeasonEnd = at("2026-08-01T19:00:00Z")

	got := rosterwatch.Compare(ship, upstream(), now, nil)
	if !slices.Contains(kinds(got), rosterwatch.KindSeasonExpired) {
		t.Fatalf("kinds = %v, want a %s finding", kinds(got), rosterwatch.KindSeasonExpired)
	}
}

// The accepted list is what lets the watch reach green. Without it the D.Va
// difference — real in the roster today — would be reported on every run
// forever, which is how a gate teaches people to ignore it.
func TestCompare_StaysQuietAboutAnAcceptedDifference(t *testing.T) {
	ship := shipped()
	up := upstream()
	up.Heroes = []rosterwatch.Hero{{Name: "Ashe", Role: "dps"}, {Name: "Mei", Role: "dps"}, {Name: "D.Va", Role: "tank"}}

	accepted := rosterwatch.Accepted{"hero-spelling:D.Va": "the scoreboard renders it D.va"}
	got := rosterwatch.Compare(ship, up, now, accepted)
	if len(got.Findings) != 0 {
		t.Fatalf("findings = %+v, want none — the difference is on the accepted list", got.Findings)
	}
}

// An accepted entry that no longer matches anything is a stale exemption, and
// a stale exemption is how an accepted list stops meaning anything.
func TestCompare_FlagsAnAcceptedEntryNothingMatches(t *testing.T) {
	accepted := rosterwatch.Accepted{"hero-spelling:Ghost": "nothing upstream is called this"}
	got := rosterwatch.Compare(shipped(), upstream(), now, accepted)
	if !slices.Contains(kinds(got), rosterwatch.KindAcceptedStale) {
		t.Fatalf("kinds = %v, want a %s finding", kinds(got), rosterwatch.KindAcceptedStale)
	}
}
