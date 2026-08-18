package fixtures_test

import (
	"math"
	"math/rand"
	"testing"

	"recall/pkg/fixtures"
	"recall/pkg/parser"
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
		assertDeltaInBand(t, "standard win",
			fixtures.PerMatchDelta(rng, gold, 1, "victory", "expected"), 19, 23)
		assertDeltaInBand(t, "standard loss",
			fixtures.PerMatchDelta(rng, gold, 1, "defeat", "expected"), -23, -19)
		assertDeltaInBand(t, "streak win (no double-amplify expected)",
			fixtures.PerMatchDelta(rng, gold, 6, "victory", "win streak"), 26, 30)
		// Consolation softens a loss below the standard band floor: a
		// negative delta strictly above -19.
		assertDeltaInBand(t, "consolation loss (softened negative)",
			fixtures.PerMatchDelta(rng, gold, 1, "defeat", "consolation"), -18, -1)
	}
	if d := fixtures.PerMatchDelta(rng, gold, 1, "draw", "draw"); d != 0 {
		t.Fatalf("draw delta = %d; want 0", d)
	}
}

// assertDeltaInBand pins one per-match delta inside its inclusive band.
func assertDeltaInBand(t *testing.T, label string, delta, lo, hi int) {
	t.Helper()
	if delta < lo || delta > hi {
		t.Fatalf("%s delta %d out of [%d,%d]", label, delta, lo, hi)
	}
}

// validPickModifiers is the rank_modifiers CHECK-enum subset pickModifier
// may emit.
var validPickModifiers = map[string]bool{
	"expected": true, "uphill battle": true, "reversal": true, "consolation": true,
	"win streak": true, "loss streak": true, "calibration": true, "volatile": true,
	"draw": true,
}

func TestPickModifier_OnlyEnumValues(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	sawCalibration, sawStreak := false, false
	for g := 1; g <= 400; g++ {
		result, streak := modifierGameInputs(g)
		m := fixtures.PickModifier(rng, result, streak, g)
		if !validPickModifiers[m] {
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

// modifierGameInputs derives game g's result (every 3rd a defeat) and streak
// (every 20th a streak game).
func modifierGameInputs(g int) (result string, streak int) {
	result = "victory"
	if g%3 == 0 {
		result = "defeat"
	}
	streak = 1
	if g%20 == 0 {
		streak = 8
	}
	return result, streak
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

// Monotonicity alone let the whole curve slide: shifting srFromLadder by a
// full division changed every SR the seed generator prints and the suite
// stayed green. These pin it to the ladder it claims to encode — the bottom
// rung, the top rung, and the step between two adjacent ones — so a retune is
// a deliberate edit here rather than a silent rewrite of the dev corpus.
func TestSRFromLadder_AnchoredToTheLadder(t *testing.T) {
	t.Parallel()

	bottom := fixtures.SRFromLadder(fixtures.NewLadderPos(0, 5, 0))
	if bottom != 1000 {
		t.Errorf("the bottom of the ladder is 1000 SR, got %d", bottom)
	}

	// A division is one rung, and each rung is worth the same.
	oneUp := fixtures.SRFromLadder(fixtures.NewLadderPos(0, 4, 0))
	step := oneUp - bottom
	if step <= 0 {
		t.Fatalf("climbing a division must raise SR, got %d -> %d", bottom, oneUp)
	}
	acrossATier := fixtures.SRFromLadder(fixtures.NewLadderPos(1, 5, 0)) - bottom
	if acrossATier != step*5 {
		t.Errorf("a tier is five divisions: want %d SR, got %d", step*5, acrossATier)
	}

	// Progress inside a division spans exactly one rung, so a full meter is
	// worth the same as the promotion it is about to earn.
	full := fixtures.SRFromLadder(fixtures.NewLadderPos(0, 5, 100))
	if full-bottom != step {
		t.Errorf("a full progress meter is worth one division (%d SR), got %d", step, full-bottom)
	}
}

// The percentile printed on a seeded rank card has to agree with the tier
// printed beside it, or every screenshot of the dev seed is visibly wrong.
func TestLadderPercentile(t *testing.T) {
	// One entry per RUNG, pinned to the ladder: adding a tier without adding
	// its five divisions would silently shift every rung above it onto the
	// wrong percentile.
	if got, want := len(fixtures.DivisionPercentile()), len(parser.Ranks())*5; got != want {
		t.Fatalf("divisionPercentile has %d entries, ladder has %d rungs — a tier was "+
			"added to ranks.yaml without deciding what share of players sits below it", got, want)
	}

	// The ends are the ends.
	if got := fixtures.LadderPercentile(0, 5, 0); got != 0 {
		t.Errorf("the bottom of bronze = %d%%, want 0", got)
	}
	if got := fixtures.LadderPercentile(len(parser.Ranks())-1, 1, 100); got != 100 {
		t.Errorf("the top of the ladder = %d%%, want 100", got)
	}

	// Anchored to the survey the table is fitted from: Platinum 2 sits at
	// 46.5% and Platinum 1 at 52.4%, so two-thirds of the way through
	// Platinum 2 lands around 50. The real season-4 captures read 57 at that
	// rung, which is inside the survey's own spread for it (responses ranged
	// 25-58%) — the seed wants the central estimate, not one capture.
	plat := indexOfTier(t, "platinum")
	if got := fixtures.LadderPercentile(plat, 2, 67); got < 45 || got > 58 {
		t.Errorf("Platinum 2 at 67%% progress = %d%%, want ~50 — between the survey's "+
			"fitted Platinum 2 (46.5) and Platinum 1 (52.4)", got)
	}
	// The bottom of the ladder is the half the old invented numbers got most
	// wrong: they put the top of Gold at 48%, the survey fits 24.7%.
	gold := indexOfTier(t, "gold")
	if got := fixtures.LadderPercentile(gold, 1, 0); got < 20 || got > 30 {
		t.Errorf("the top of Gold = %d%%, want ~25 per the survey fit", got)
	}
}

// Monotonic across the WHOLE ladder: every division of every tier, bottom to
// top. A non-monotonic curve would let a promotion LOWER the share of players
// beneath you, which is the one thing this number must never do.
func TestLadderPercentile_RisesWithEveryRung(t *testing.T) {
	prev := -1
	for tier := range parser.Ranks() {
		for div := 5; div >= 1; div-- {
			got := fixtures.LadderPercentile(tier, div, 0)
			if got < prev {
				t.Fatalf("tier %d div %d = %d%%, below the previous rung's %d%%", tier, div, got, prev)
			}
			if got < 0 || got > 100 {
				t.Errorf("tier %d div %d = %d%%, outside 0-100", tier, div, got)
			}
			prev = got
		}
	}
}

func indexOfTier(t *testing.T, name string) int {
	t.Helper()
	for i, r := range parser.Ranks() {
		if r == name {
			return i
		}
	}
	t.Fatalf("tier %q not on the ladder", name)
	return 0
}

// The tilt penalty had no behavioral guard: deleting it outright (tiltPts → 0,
// or tiltRunStart → unreachable) changed a third of the generated corpus and
// every test still passed. The story test that looks like coverage counts
// same-day loss RUNS in the output, which the base win-rate model produces on
// its own — so it never touched the penalty at all.
//
// This asserts the mechanic where it lives: the same-day loss run has to cost
// the player win probability, and only from the threshold on.
func TestPlayerState_TiltPenaltyCostsWinProbability(t *testing.T) {
	t.Parallel()

	const day = "2026-08-17"
	ps := &fixtures.PlayerState{}
	// A fresh player on a fresh day carries no penalty of any kind.
	if got := ps.Observe(day); got != 0 {
		t.Fatalf("clean first game should carry no penalty, got %v", got)
	}

	// Losses below the threshold stay free.
	for i := 1; i < fixtures.TiltRunStart; i++ {
		ps.Record("defeat")
		if got := ps.Observe(day); got != 0 {
			t.Fatalf("loss run of %d is below the threshold; want no penalty, got %v", i, got)
		}
	}

	// The threshold-th consecutive same-day loss starts costing.
	ps.Record("defeat")
	tilted := ps.Observe(day)
	if tilted <= 0 {
		t.Fatalf("a %d-loss same-day run must carry a penalty, got %v", fixtures.TiltRunStart, tilted)
	}

	// An ABSOLUTE bound as well as the relative one above. Every assertion so
	// far derives its loss count from TiltRunStart, so raising that constant
	// out of reach — the way "the mechanic never fires" would look — satisfies
	// them all. A five-loss evening has to tilt whatever the threshold is
	// tuned to; a single loss never may.
	const tiltsByAnyReasonableThreshold = 5
	long := &fixtures.PlayerState{}
	long.Observe(day)
	for range tiltsByAnyReasonableThreshold {
		long.Record("defeat")
	}
	if got := long.Observe(day); got <= 0 {
		t.Fatalf("a %d-loss same-day run must tilt, got %v", tiltsByAnyReasonableThreshold, got)
	}

	one := &fixtures.PlayerState{}
	one.Observe(day)
	one.Record("defeat")
	if got := one.Observe(day); got != 0 {
		t.Fatalf("one loss is not tilt, got %v", got)
	}

	// And a win breaks the spiral rather than merely pausing it.
	ps.Record("victory")
	if got := ps.Observe(day); got != 0 {
		t.Fatalf("a win must clear the tilt run; want no penalty, got %v", got)
	}
}

// A new day is a clean slate: yesterday's losses do not follow the player into
// tonight's queue.
func TestPlayerState_TiltDoesNotCrossDays(t *testing.T) {
	t.Parallel()

	ps := &fixtures.PlayerState{}
	ps.Observe("2026-08-17")
	for range fixtures.TiltRunStart + 1 {
		ps.Record("defeat")
	}

	if got := ps.Observe("2026-08-18"); got != 0 {
		t.Fatalf("yesterday's loss run must not tilt today, got %v", got)
	}
}
