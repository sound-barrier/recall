package fixtures_test

import (
	"math"
	"math/rand"
	"testing"

	"recall/pkg/fixtures"
)

// tierIdx is a readable helper for the rank tests.
func tierIdx(name string) int {
	for i, n := range fixtures.TierNames {
		if n == name {
			return i
		}
	}
	panic("unknown tier " + name)
}

func TestAdvance_UpCarryDivisionAndTier(t *testing.T) {
	gold, plat := tierIdx("gold"), tierIdx("platinum")

	// Gold 1 @ 95% + 10 → overflow promotes into Platinum 5 @ 5%.
	got, used := fixtures.Advance(fixtures.NewLadderPos(gold, 1, 95), 10, true)
	if got != fixtures.NewLadderPos(plat, 5, 5) || used {
		t.Fatalf("gold 1 95%%+10 = %+v used=%v; want platinum 5 @5%%", got, used)
	}

	// Within-tier promote: Gold 3 @ 90% + 20 → Gold 2 @ 10%.
	got, _ = fixtures.Advance(fixtures.NewLadderPos(gold, 3, 90), 20, true)
	if got != fixtures.NewLadderPos(gold, 2, 10) {
		t.Fatalf("gold 3 90%%+20 = %+v; want gold 2 @10%%", got)
	}

	// Diamond 1 @ +100% lands exactly on the Master boundary (Master 5 @ 0%).
	dia, master := tierIdx("diamond"), tierIdx("master")
	got, _ = fixtures.Advance(fixtures.NewLadderPos(dia, 1, 0), 100, true)
	if got != fixtures.NewLadderPos(master, 5, 0) {
		t.Fatalf("diamond 1 +100 = %+v; want master 5 @0%%", got)
	}
}

func TestAdvance_DownCarryInverse(t *testing.T) {
	gold, silver := tierIdx("gold"), tierIdx("silver")

	// Within-tier demote never touches grace: Gold 3 @ 5% − 20 → Gold 4 @ 85%.
	got, used := fixtures.Advance(fixtures.NewLadderPos(gold, 3, 5), -20, false)
	if got != fixtures.NewLadderPos(gold, 4, 85) || used {
		t.Fatalf("gold 3 5%%-20 = %+v used=%v; want gold 4 @85%%", got, used)
	}

	// Tier-floor crossing without grace drops a tier: Gold 5 @ 5% − 20 →
	// Silver 1 @ 85% (inverse of the up-carry).
	got, used = fixtures.Advance(fixtures.NewLadderPos(gold, 5, 5), -20, false)
	if got != fixtures.NewLadderPos(silver, 1, 85) || used {
		t.Fatalf("gold 5 5%%-20 (no grace) = %+v used=%v; want silver 1 @85%%", got, used)
	}
}

func TestAdvance_DemotionProtection(t *testing.T) {
	gold := tierIdx("gold")

	// At a tier floor, a crossing loss WITH grace is absorbed: clamp to Gold 5
	// @ 0% and report grace consumed.
	got, used := fixtures.Advance(fixtures.NewLadderPos(gold, 5, 5), -20, true)
	if got != fixtures.NewLadderPos(gold, 5, 0) || !used {
		t.Fatalf("gold 5 5%%-20 (grace) = %+v used=%v; want gold 5 @0%% grace consumed", got, used)
	}

	// The NEXT floor loss (grace already spent) actually drops the tier.
	got, used = fixtures.Advance(got, -20, false)
	if got.Tier() != tierIdx("silver") || used {
		t.Fatalf("gold 5 0%%-20 (no grace) = %+v used=%v; want a silver-tier drop", got, used)
	}
}

func TestAdvance_LadderCaps(t *testing.T) {
	// Bronze 5 can't fall below its floor.
	bronze := tierIdx("bronze")
	got, _ := fixtures.Advance(fixtures.NewLadderPos(bronze, 5, 3), -20, false)
	if got != fixtures.NewLadderPos(bronze, 5, 0) {
		t.Fatalf("bronze 5 floor = %+v; want bronze 5 @0%%", got)
	}
	// Champion 1 can't climb past its cap.
	champ := tierIdx("champion")
	got, _ = fixtures.Advance(fixtures.NewLadderPos(champ, 1, 95), 20, true)
	if got != fixtures.NewLadderPos(champ, 1, 100) {
		t.Fatalf("champion 1 cap = %+v; want champion 1 @100%%", got)
	}
}

func TestMeterBand(t *testing.T) {
	cases := []struct {
		tier, streak   int
		wantLo, wantHi int
	}{
		{tierIdx("bronze"), 1, 4, 9},
		{tierIdx("champion"), 1, 4, 9},
		{tierIdx("gold"), 1, 19, 23},
		{tierIdx("gold"), 5, 19, 23},
		{tierIdx("gold"), 6, 26, 30},
		{tierIdx("diamond"), 8, 26, 30},
	}
	for _, c := range cases {
		lo, hi := fixtures.MeterBand(c.tier, c.streak)
		if lo != c.wantLo || hi != c.wantHi {
			t.Errorf("meterBand(tier=%d,streak=%d) = {%d,%d}; want {%d,%d}", c.tier, c.streak, lo, hi, c.wantLo, c.wantHi)
		}
	}
}

func TestWinProb_GapReversion(t *testing.T) {
	const line = 15.0 // ~Platinum 5, arbitrary

	// ON the line with neutral form: wrEqualize — a shade over 50% because
	// the hero-cost penalties are folded in downstream (realized ≈ 50%).
	if p := fixtures.WinProb(line, line, 0); p != fixtures.WrEqualize {
		t.Errorf("winProb on the line = %.3f; want wrEqualize %.3f", p, fixtures.WrEqualize)
	}
	// A local MINIMUM (dropped below real skill) recovers at an elevated
	// rate; a local MAXIMUM (peaked above it) falls back below 50%. The two
	// sit symmetric around wrEqualize at the gap cap.
	below := fixtures.WinProb(line-4, line, 0)
	above := fixtures.WinProb(line+4, line, 0)
	if math.Abs(below-(fixtures.WrEqualize+fixtures.WrGapCap)) > 1e-9 {
		t.Errorf("winProb 4 divisions below = %.3f; want the +%.2f cap", below, fixtures.WrGapCap)
	}
	if math.Abs(above-(fixtures.WrEqualize-fixtures.WrGapCap)) > 1e-9 || above >= 0.50 {
		t.Errorf("winProb 4 divisions above = %.3f; want the -%.2f cap, under 50%%", above, fixtures.WrGapCap)
	}
	// Monotone within the linear zone: the closer to the line from below,
	// the lower the rate — climbing gets harder as you approach real skill.
	prev := 1.0
	for _, gap := range []float64{2, 1.5, 1, 0.5, 0} {
		p := fixtures.WinProb(line-gap, line, 0)
		if p >= prev {
			t.Errorf("winProb should descend approaching the line: gap %.1f = %.3f >= previous %.3f", gap, p, prev)
		}
		prev = p
	}
	// Form shifts the rate point-for-point; the hard clamp still rules.
	if p := fixtures.WinProb(line, line, 3); math.Abs(p-(fixtures.WrEqualize+0.03)) > 1e-9 {
		t.Errorf("winProb with +3 form = %.3f; want %.3f", p, fixtures.WrEqualize+0.03)
	}
	if p := fixtures.WinProb(line-10, line, fixtures.FormAmpPts); p != fixtures.WrCeiling {
		t.Errorf("hot form far below the line = %.3f; want the %.2f hard cap", p, fixtures.WrCeiling)
	}
}

func TestTrueSkillAt_PulsedRise(t *testing.T) {
	for track, line := range fixtures.TrackSkillLines {
		if got := fixtures.TrueSkillAt(track, 0); got != line.Start() {
			t.Errorf("%s skill at season start = %.2f; want %.2f", track, got, line.Start())
		}
		if got := fixtures.TrueSkillAt(track, 1); got != line.End() {
			t.Errorf("%s skill at season end = %.2f; want %.2f", track, got, line.End())
		}
		prev := line.Start()
		for f := 0.05; f <= 1.0; f += 0.05 {
			got := fixtures.TrueSkillAt(track, f)
			if got < prev-1e-9 {
				t.Fatalf("%s skill line regressed at frac %.2f: %.3f < %.3f — skill only rises", track, f, got, prev)
			}
			prev = got
		}
	}
	// Out-of-range fractions clamp instead of extrapolating.
	if got, want := fixtures.TrueSkillAt("dps", 1.7), fixtures.TrackSkillLines["dps"].End(); got != want {
		t.Errorf("frac past season end = %.2f; want clamped %.2f", got, want)
	}
}

func TestPerMatchDelta_SignsAndBands(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	gold := tierIdx("gold")

	for range 500 {
		win := fixtures.PerMatchDelta(rng, gold, 1, "victory", "expected")
		if win < 19 || win > 23 {
			t.Fatalf("standard win delta %d out of [19,23]", win)
		}
		loss := fixtures.PerMatchDelta(rng, gold, 1, "defeat", "expected")
		if loss > -19 || loss < -23 {
			t.Fatalf("standard loss delta %d out of [-23,-19]", loss)
		}
		streakWin := fixtures.PerMatchDelta(rng, gold, 6, "victory", "win streak")
		if streakWin < 26 || streakWin > 30 {
			t.Fatalf("streak win delta %d out of [26,30] (no double-amplify expected)", streakWin)
		}
		// Consolation softens a loss below the standard band floor.
		cons := fixtures.PerMatchDelta(rng, gold, 1, "defeat", "consolation")
		if cons <= -19 || cons >= 0 {
			t.Fatalf("consolation loss %d should be a softened negative (> -19)", cons)
		}
	}
	if d := fixtures.PerMatchDelta(rng, gold, 1, "draw", "draw"); d != 0 {
		t.Fatalf("draw delta = %d; want 0", d)
	}
}

func TestPickModifier_OnlyEnumValues(t *testing.T) {
	valid := map[string]bool{}
	for _, m := range []string{
		"expected", "uphill battle", "reversal", "consolation", "win streak",
		"loss streak", "calibration", "volatile", "draw",
	} {
		valid[m] = true
	}
	rng := rand.New(rand.NewSource(7))
	sawCalibration, sawStreak := false, false
	for g := 1; g <= 400; g++ {
		result := "victory"
		if g%3 == 0 {
			result = "defeat"
		}
		streak := 1
		if g%20 == 0 {
			streak = 8
		}
		m := fixtures.PickModifier(rng, result, streak, g)
		if !valid[m] {
			t.Fatalf("pickModifier returned %q, not in the CHECK enum", m)
		}
		if g <= fixtures.CalibrationGames && m == "calibration" {
			sawCalibration = true
		}
		if streak >= fixtures.StreakThreshold && (m == "win streak" || m == "loss streak") {
			sawStreak = true
		}
	}
	if !sawCalibration {
		t.Error("expected a calibration pill in the opening window")
	}
	if !sawStreak {
		t.Error("expected a streak pill at streak>=6")
	}
}

func TestRankTrackKey(t *testing.T) {
	// Open queue collapses to one track regardless of hero.
	if k := fixtures.RankTrackKey("open", "reinhardt"); k != "open" {
		t.Errorf("open queue key = %q; want open", k)
	}
	// Role queue routes by the primary hero's role (parity with roleOfHero).
	for _, h := range []string{fixtures.FixtureTanks()[0], fixtures.FixtureSupports()[0], fixtures.FixtureDPS()[0]} {
		want := fixtures.RoleOfHero(h)
		if k := fixtures.RankTrackKey("role", h); k != want {
			t.Errorf("role queue key for %s = %q; want %q", h, k, want)
		}
	}
}

func TestTrackWalk_ScreenReflectsFullAccumulation(t *testing.T) {
	// The meter moves every game, including the rankless ones; the screen that
	// finally appears reflects the FULL accumulation since the last screen, not
	// a single game. Gold 3 22% + 5 straight wins ≈ +1 division (~Gold 2 with a
	// ~+100% card) — never "Gold 3 42%" (which would throw away the 4 rankless
	// wins and count only the screen's own game).
	start := fixtures.NewLadderPos(tierIdx("gold"), 3, 22)
	w := fixtures.NewTrackWalk(start, true, 100 /*past calibration*/, fixtures.SRFromLadder(start))
	rng := rand.New(rand.NewSource(3))

	var card *fixtures.RankCard
	for range 5 {
		if c := w.Step(rng, "victory"); c != nil {
			card = c
		}
	}
	if card == nil {
		t.Fatal("no card after 5 wins — the 5-win cadence should have fired")
	}
	if card.ChangePercent() < 90 {
		t.Fatalf("change_percent %d too small — the screen ignored the rankless wins (want ~+100)", card.ChangePercent())
	}
	if card.Pos().Tier() != tierIdx("gold") || card.Pos().Div() != 2 {
		t.Fatalf("5 wins from Gold 3 22%% landed at %+v; want a full division up (~Gold 2)", card.Pos())
	}
}

func TestNewTrackWalks_StaggeredStarts(t *testing.T) {
	walks := fixtures.NewTrackWalks()
	want := map[string]fixtures.LadderPos{
		"tank":    fixtures.NewLadderPos(tierIdx("silver"), 1, 0), // Silver 1
		"dps":     fixtures.NewLadderPos(tierIdx("gold"), 4, 0),   // Gold 4
		"support": fixtures.NewLadderPos(tierIdx("gold"), 3, 0),   // Gold 3
		"open":    fixtures.NewLadderPos(tierIdx("gold"), 5, 0),   // Gold 5
	}
	for key, wp := range want {
		w, ok := walks[key]
		if !ok {
			t.Fatalf("no walk for track %q", key)
		}
		if w.Pos() != wp {
			t.Errorf("track %q starts at %+v; want %+v", key, w.Pos(), wp)
		}
		if !w.Grace() {
			t.Errorf("track %q should start with demotion-protection grace", key)
		}
	}
}

func TestSRFromLadder_Monotonic(t *testing.T) {
	prev := -1
	for tier := range fixtures.TierNames {
		for div := 5; div >= 1; div-- {
			for _, prog := range []int{0, 50, 99} {
				sr := fixtures.SRFromLadder(fixtures.NewLadderPos(tier, div, prog))
				if sr <= prev {
					t.Fatalf("SR not monotonic at tier=%d div=%d prog=%d: %d <= %d", tier, div, prog, sr, prev)
				}
				prev = sr
			}
		}
	}
}
