package fixtures

import (
	"math/rand"
)

// The model that decides whether a seeded game is won, and how far it moves
// the meter.
//
// Every tuning constant in the simulation lives here, together, because they
// are read against each other: a win rate is only plausible relative to the
// gap that produced it and the meter band it feeds. Split across the files
// that USE them, they drifted out of proportion unnoticed.

// skillLine is a track's TRUE skill across the season, in ladderScore units:
// it starts a touch above the placement rank (everyone places low) and rises
// to the season-end skill. The position chases this line — never the other
// way around — so growth is skill-driven, not luck-driven.
type skillLine struct {
	start, end float64
}

// trackSkillLines: dps is the main role (85% of comp role-queue games) and
// improves ~5 divisions across the season (Gold ≈3.5 → Platinum ≈3.4); the
// thin tracks drift a little. Values are ladderScore units (tier*5 + (5-div)).
var trackSkillLines = map[string]skillLine{
	"tank":    {start: 9.3, end: 12.0},  // ~Silver 1 → ~Gold 3
	"dps":     {start: 11.5, end: 16.4}, // ~Gold 3.5 → ~Plat 3.6
	"support": {start: 12.1, end: 12.7}, // ~Gold 3 → ~Gold 2.3
	"open":    {start: 10.3, end: 14.6}, // ~Gold 4.7 → ~Plat 5.4
}

// skillPulseWaypoints shape HOW the line rises: improvement comes in pulses
// with plateaus between (frac of season → share of the total rise). During a
// plateau the position catches up to — and overshoots — the line (local
// maxima that fall back); during a pulse it lags below (local minima that
// recover at an elevated win rate).
var skillPulseWaypoints = [][2]float64{
	{0.00, 0.00}, {0.10, 0.02}, {0.30, 0.34}, {0.48, 0.40},
	{0.72, 0.78}, {0.85, 0.82}, {1.00, 1.00},
}

// skillProgress maps a season fraction onto the pulsed rise share via
// piecewise-linear interpolation of skillPulseWaypoints.
func skillProgress(frac float64) float64 {
	frac = max(0, min(1, frac))
	for i := 1; i < len(skillPulseWaypoints); i++ {
		x0, y0 := skillPulseWaypoints[i-1][0], skillPulseWaypoints[i-1][1]
		x1, y1 := skillPulseWaypoints[i][0], skillPulseWaypoints[i][1]
		if frac <= x1 {
			return y0 + (y1-y0)*(frac-x0)/(x1-x0)
		}
	}
	return 1
}

// trueSkillAt is the track's true skill at a season fraction, in ladderScore
// units. Unknown tracks read as flat mid-Gold (never happens in practice —
// rankTrackKey filters first).
func trueSkillAt(track string, frac float64) float64 {
	line, ok := trackSkillLines[track]
	if !ok {
		return 11
	}
	return line.start + (line.end-line.start)*skillProgress(frac)
}

const (
	// calibrationGames is the opening run per track carrying the "calibration"
	// pill (bigger early swings, as OW2 placement does).
	calibrationGames = 5
	// cardWinTrigger / cardLossTrigger are the old-cadence thresholds: a rank
	// card surfaces every 5 wins or every 15 losses.
	cardWinTrigger  = 5
	cardLossTrigger = 15
	// streakThreshold is the run length at which the per-game band widens and
	// the win/loss-streak pill attaches.
	streakThreshold = 6

	// Win-rate model (gap reversion): a clean game's rate is wrEqualize plus
	// gapSlope per division of (true skill − position), capped at ±wrGapCap —
	// BELOW the line you win more and recover, ABOVE it you win less and fall
	// back. wrEqualize sits ~3.5 points over 50% because the hero-cost
	// penalties below are permanent loss mass: with them folded in, a player
	// sitting ON the line wins ~50% and plateaus. The clean rate is clamped to
	// [wrFloor, wrCeiling]; the penalty applies after, floored at pFloor so
	// even a 4-hero off-pool disaster isn't a scripted loss. drawRate is the
	// ~1% draw share.
	wrEqualize = 0.55
	gapSlope   = 0.030
	wrGapCap   = 0.08
	wrFloor    = 0.40
	wrCeiling  = 0.63
	pFloor     = 0.15
	pCeil      = 0.85
	drawRate   = 0.01
	// The form walk: an autocorrelated per-track mood in win-rate points,
	// stepped every decisive game and clamped to ±formAmpPts. Hot form pushes
	// the position over the line into a peak; cold form digs the dip the gap
	// term then climbs out of.
	formStepPts = 0.9
	formAmpPts  = 6.0

	// Per-match hero costs (win-probability points). Three heroes played
	// MEANINGFULLY in one match is a game that was going badly AND got worse —
	// "usually a loss"; four is desperation. A hero below meaningfulHeroPct is
	// a cameo (the coverage pass appends 5% touches), not a swap, and doesn't
	// count. An off-pool primary bleeds a smaller, steady tax.
	multiHeroThreePenaltyPts = 21
	multiHeroFourPenaltyPts  = 26
	offPoolPenaltyPts        = 12
	meaningfulHeroPct        = 10

	// Return rust: after rustGapDays+ without a match (the carved vacation
	// windows), the first games back are played at a deficit that fades
	// linearly over rustGames — it takes time to get back into the swing,
	// and consistency is what protects the rank already earned.
	rustGapDays = 7
	rustGames   = 14
	rustMaxPts  = 20.0

	// Tilt queuing: from the tiltRunStart-th consecutive same-day loss on,
	// every further game that day is played tilted — each queue digs the
	// hole deeper until a win (or the day) breaks the spiral.
	tiltRunStart = 3
	tiltPts      = 5.0
)

// winProb is the clean-game decisive win rate: gap reversion around the true-
// skill line plus the current form, clamped to [wrFloor, wrCeiling]. Positive
// gap = underranked = elevated rate; negative = overranked = sub-50 and
// falling back toward the line.
func winProb(posScore, lineScore, formPts float64) float64 {
	gapTerm := max(-wrGapCap, min(wrGapCap, gapSlope*(lineScore-posScore)))
	return max(wrFloor, min(wrCeiling, wrEqualize+gapTerm+formPts/100))
}

// meterBand returns the [min,max] per-game swing (progress-points) for the
// pre-move tier and current same-result streak: the ladder extremes (Bronze,
// Champion) compress to 4–9; a 6+ streak widens to 26–30; standard is 19–23.
func meterBand(tier, streak int) (int, int) {
	if tier == 0 || tier == len(tierNames)-1 {
		return 4, 9
	}
	if streak >= streakThreshold {
		return 26, 30
	}
	return 19, 23
}

// modifierScale is a mild multiplier on the band magnitude for the flavor
// pills; the band itself is the real driver. Consolation softens a loss, the
// rare qualitatives nudge slightly, everything else is neutral.
func modifierScale(modifier string) float64 {
	switch modifier {
	case "consolation":
		return 0.65
	case "uphill battle", "reversal", "volatile", "calibration":
		return 1.10
	default:
		return 1.0
	}
}

// perMatchDelta is the signed per-game meter move: magnitude sampled from
// meterBand and scaled by the modifier, sign from the result. A draw never
// moves the meter.
func perMatchDelta(rng *rand.Rand, tier, streak int, result, modifier string) int {
	if result == "draw" {
		return 0
	}
	lo, hi := meterBand(tier, streak)
	mag := max(int(float64(lo+rng.Intn(hi-lo+1))*modifierScale(modifier)), 1)
	if result == "defeat" {
		return -mag
	}
	return mag
}

// pickModifier labels a game — it drives both the magnitude scale and, when a
// card fires, the stored pill. Every value is in the schema CHECK enum.
func pickModifier(rng *rand.Rand, result string, streak, games int) string {
	switch {
	case result == "draw":
		return "draw"
	case games <= calibrationGames:
		return "calibration"
	case streak >= streakThreshold && result == "victory":
		return "win streak"
	case streak >= streakThreshold:
		return "loss streak"
	case rng.Float64() < 0.06:
		return rareModifier(rng, result)
	default:
		return "expected"
	}
}

// rareModifier is the occasional flavor pill: volatile, or the
// expectation-mismatch pills (uphill battle on a win; reversal/consolation on
// a loss).
func rareModifier(rng *rand.Rand, result string) string {
	if rng.Float64() < 0.3 {
		return "volatile"
	}
	if result == "victory" {
		return "uphill battle"
	}
	if rng.Float64() < 0.5 {
		return "reversal"
	}
	return "consolation"
}
