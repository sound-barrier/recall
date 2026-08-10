package parser_test

import (
	"fmt"
	"slices"
	"testing"

	"recall/pkg/parser"
)

// ──────────────────────────────────────────────────────────────────────────
// parsePersonal — the PERSONAL tab's 3×3 grid. Every cell is a separate OCR
// region ("personal_rXcY" for the PSM 11 pass, "_b" for PSM 6, "_s" for the
// icon-stripped pass), so stubOCR can hand each card its own canned text and
// drive the whole grid walk without Tesseract.
// ──────────────────────────────────────────────────────────────────────────

// primaryStats returns the Stats map filed under the first heroes_played
// entry — the hero-info card's hero, which owns every stat cell on screen.
func primaryStats(t *testing.T, res *parser.MatchResult) map[string]int {
	t.Helper()
	if len(res.HeroesPlayed) == 0 {
		t.Fatal("no heroes_played entry: the hero-info card (r0c0) did not parse")
	}
	return res.HeroesPlayed[0].Stats
}

func assertStat(t *testing.T, stats map[string]int, key string, want int) {
	t.Helper()
	got, ok := stats[key]
	if !ok {
		t.Fatalf("stat %q missing, have %v", key, stats)
	}
	if got != want {
		t.Errorf("stat %q = %d, want %d", key, got, want)
	}
}

func heroNames(res *parser.MatchResult) []string {
	out := make([]string, 0, len(res.HeroesPlayed))
	for _, hp := range res.HeroesPlayed {
		out = append(out, hp.Hero)
	}
	return out
}

func parsePersonalWith(t *testing.T, cells map[string]string) *parser.MatchResult {
	t.Helper()
	stubOCR(t, cells)
	res, err := parser.ParsePersonal(tinyImage(), t.TempDir())
	if err != nil {
		t.Fatalf("ParsePersonal: %v", err)
	}
	return res
}

// Every stat card on screen belongs to the hero named on the r0c0 info card
// — which is the SELECTED hero, not necessarily the most-played one — and
// the sidebar roster is appended after it, in the order the sidebar lists it.
// Two failure modes are pinned here: appending the sidebar before the grid
// would file the stats under whichever hero the sidebar happens to list
// first, and appending in extractHeroes' (alphabetical) order would report
// ANA ahead of ZARYA and misstate the play order.
func TestParsePersonal_StatsBelongToTheHeroCardAndSidebarKeepsPlayOrder(t *testing.T) {
	res := parsePersonalWith(t, map[string]string{
		"personal_r0c0":    "KIRIKO\n40%\n4:30",
		"personal_r0c1":    "41%\nCRITICAL HIT ACCURACY",
		"personal_r0c2":    "13\nSOLO KILLS",
		"personal_sidebar": "ZARYA\nKIRIKO\nANA\nALL HEROES",
	})

	if res.Hero != "kiriko" || res.Role != "support" {
		t.Errorf("hero/role = %q/%q, want kiriko/support", res.Hero, res.Role)
	}
	stats := primaryStats(t, res)
	assertStat(t, stats, "critical_hit_accuracy", 41)
	assertStat(t, stats, "solo_kills", 13)

	got := heroNames(res)
	want := []string{"kiriko", "zarya", "ana"}
	if !slices.Equal(got, want) {
		t.Fatalf("heroes_played = %v, want %v (hero card first, then sidebar order, deduped)", got, want)
	}
	// Sidebar-only heroes are name-carriers: no % (0 would read as "played
	// 0%" downstream and could be filtered out) and no stats — only the
	// selected hero's cards are on screen.
	for _, hp := range res.HeroesPlayed[1:] {
		if hp.PercentPlayed != 0 || hp.PlayTime != "" || hp.Stats != nil {
			t.Errorf("sidebar hero %+v must carry a name only", hp)
		}
	}
}

// When the hero-info card doesn't resolve to a known hero, the eight stat
// cards must be DROPPED, not filed into a nameless bucket that a later merge
// would attach to the wrong hero. The unmatched OCR text still surfaces as
// HeroRaw so the "Unknown hero" chip can name it.
func TestParsePersonal_UnknownHeroCardDropsEveryStat(t *testing.T) {
	res := parsePersonalWith(t, map[string]string{
		"personal_r0c0": "MIYAZAKI\n100%\n11:25",
		"personal_r0c1": "41%\nWEAPON ACCURACY",
		"personal_r1c1": "13\nSOUND BARRIERS PROVIDED",
	})

	if res.Hero != "" {
		t.Errorf("hero = %q, want empty for an off-roster name", res.Hero)
	}
	if res.HeroRaw != "miyazaki" {
		t.Errorf("hero_raw = %q, want %q", res.HeroRaw, "miyazaki")
	}
	if len(res.HeroesPlayed) != 0 {
		t.Fatalf("heroes_played = %+v, want none — a stat bucket with no hero is worse than no data", res.HeroesPlayed)
	}
}

// The value and the label routinely come from DIFFERENT OCR passes of the
// same card: the icon glues letter noise onto the label in the full-cell
// pass, and the icon-stripped pass (which crops the left 30%) can lose the
// lone digit sitting against the crop edge. Both passes are unioned, so
// dropping either one loses the whole stat.
func TestParsePersonal_ValueAndLabelUnionAcrossTheIconStrippedPass(t *testing.T) {
	res := parsePersonalWith(t, map[string]string{
		"personal_r0c0": "MIZUKI\n100%\n8:45",
		// Full cell: the icon ate the label, only the value survived.
		"personal_r1c0": "® y 5",
		// Icon-stripped cell: clean label, digit lost at the crop edge.
		"personal_r1c0_s": "PLAYERS SAVED",
	})
	assertStat(t, primaryStats(t, res), "players_saved", 5)
}

// A hyphen breaks the uppercase-label regex, so "RIP-TIRE KILL" reads as
// "TIRE KILL" — SnapHeroStatKey has to pull it back to the canonical
// hero_stats.yaml key. Without the snap, the same stat would be stored under
// two different keys depending on how the OCR fell.
func TestParsePersonal_StatKeySnapsToTheCanonicalHeroStat(t *testing.T) {
	res := parsePersonalWith(t, map[string]string{
		"personal_r0c0": "JUNKRAT\n100%\n9:10",
		"personal_r2c2": "1\nRIP-TIRE KILL\nAVG PER 10 MIN: 1.09",
	})
	assertStat(t, primaryStats(t, res), "rip_tire_kill", 1)
}

// The cell-drop recovery: a 0/1-value digit next to the card icon often OCRs
// as a letter, leaving the cell with a label and an AVG line but no digit.
// The value is then reconstructed as avg × play-time/10 using the play time
// off the hero card — which is why the seconds have to survive the trip
// (7:30 is 7.5 minutes: 2.00 × 7.5/10 = 1.5 → 2; truncating to 7 minutes
// would store 1).
func TestParsePersonal_AvgAnchorRecoversTheDroppedDigitUsingPlayTimeSeconds(t *testing.T) {
	res := parsePersonalWith(t, map[string]string{
		"personal_r0c0": "REINHARDT\n100%\n7:30",
		"personal_r1c2": "O\nCHARGE KILL\nAVG PER 10 MIN: 2.00",
	})
	assertStat(t, primaryStats(t, res), "charge_kill", 2)
}

// …but the AVG alone is NOT a value. With no play time on the hero card
// there is nothing to scale by, so the stat is skipped rather than stored as
// the raw average (or as a 0 that would read as a real measurement).
func TestParsePersonal_NoPlayTimeMeansNoAvgRecovery(t *testing.T) {
	res := parsePersonalWith(t, map[string]string{
		"personal_r0c0": "LUCIO\n100%",
		"personal_r1c2": "O\nSOUND BARRIERS PROVIDED\nAVG PER 10 MIN: 2.00",
	})
	if stats := primaryStats(t, res); len(stats) != 0 {
		t.Errorf("stats = %v, want none — an average is not a count", stats)
	}
}

// The icon-stripped third pass is for stat cards only: the hero-info card at
// r0c0 has its name in the left 30% that the strip crops away, so stripping
// it there would throw away the only copy of the hero name.
func TestParsePersonal_IconStripPassSkipsTheHeroInfoCard(t *testing.T) {
	regions := recordingStubOCR(t, map[string]string{"personal_r0c0": "LUCIO\n100%\n11:25"})
	if _, err := parser.ParsePersonal(tinyImage(), t.TempDir()); err != nil {
		t.Fatalf("ParsePersonal: %v", err)
	}
	seen := map[string]bool{}
	for _, r := range *regions {
		seen[r] = true
	}
	for row := range 3 {
		for col := range 3 {
			assertCellPasses(t, seen, row, col)
		}
	}
}

// The card icon's stray digit lands after the real value as often as before
// it, and the value pick is by longest digit run — so a comma-grouped total
// has to survive both hazards: the comma-joined groups must count as ONE
// token ("1,367" is not "1" and "367"), and the shorter trailing run must not
// displace the longer one already found.
func TestParsePersonalStatCell_CommaGroupedValueSurvivesTrailingIconDigit(t *testing.T) {
	key, val, ok := parser.ParsePersonalStatCell("1,367\nDAMAGE AMPLIFIED\n4", 0)
	if !ok || key != "damage_amplified" || val != 1367 {
		t.Errorf("got (%q, %d, %v), want (damage_amplified, 1367, true)", key, val, ok)
	}
}

// assertCellPasses checks that one grid cell got both full-cell OCR passes,
// and the icon-stripped pass iff it is a stat card.
func assertCellPasses(t *testing.T, seen map[string]bool, row, col int) {
	t.Helper()
	name := fmt.Sprintf("personal_r%dc%d", row, col)
	for _, pass := range []string{name, name + "_b"} {
		if !seen[pass] {
			t.Errorf("cell %s was never OCR'd in pass %q", name, pass)
		}
	}
	wantStrip := row != 0 || col != 0
	if got := seen[name+"_s"]; got != wantStrip {
		t.Errorf("cell %s icon-stripped pass = %v, want %v", name, got, wantStrip)
	}
}
