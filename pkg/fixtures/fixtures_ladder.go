package fixtures

import (
	"math"

	"recall/pkg/parser"
)

// The board the seeded climb is played on: where a position sits, what a
// division is worth as a percentile, and the promotion / demotion rules that
// move a player between them.

// ladderPos is a point on the OW2 ladder, mirroring the frontend ladderScore
// encoding: tier index 0..7, division 1..5 (1 = TOP of the tier — climb 5→1
// then promote), progress 0..100 within the division.
type ladderPos struct {
	tier int
	div  int
	prog int
}

// tierNames indexes tier → the lowercase tier string stored in data.rank.
// Derived from pkg/parser/ranks.yaml, the single source — this used to be a
// hand-copied literal whose comment claimed it was "identical to the frontend
// TIER_ORDER and the parser's knownRanks" with nothing enforcing it.
var tierNames = parser.Ranks()

// divisionPercentile is the share of the population at or below each ladder
// rung, in ladder order (Bronze 5 first, Champion 1 last). It exists so a
// seeded rank card can carry a rank_percentile ("HIGHER RANKED THAN N% OF
// PLAYERS") that AGREES with the tier printed beside it — a Gold card showing
// 90% would make every screenshot of the dev seed obviously fake, and the seed
// is what the onboarding tour shows a first-time user.
//
// SOURCE: the season-4 community rank survey — respondents reported their rank
// alongside the percentile the game itself printed — with a z-score curve
// fitted across the 45 rungs. That is a real measurement and a large
// improvement on the round numbers that were here before, which were invented
// and badly wrong low on the ladder (they put the top of Gold at 48% against
// the survey's 24.7%).
//
// It is NOT an official distribution, and nothing outside this dev seed should
// treat it as one. It is roughly 80 self-reported responses over three days,
// so it carries selection bias and real spread: Platinum 2 answers ranged from
// 25% to 58% around a fitted 46.5%. Real percentiles come off the screenshot
// (parser.MatchResult.RankPercentile); this table only has to make synthetic
// data look like the game.
var divisionPercentile = [...]float64{
	0.3, 0.4, 0.7, 1.0, 1.5, // bronze      5 4 3 2 1
	2.2, 3.1, 4.2, 5.8, 7.7, // silver
	10.1, 12.9, 16.3, 20.3, 24.7, // gold
	29.6, 35.0, 40.6, 46.5, 52.4, // platinum
	58.3, 64.0, 69.4, 74.4, 78.9, // emerald
	82.9, 86.4, 89.4, 91.9, 93.9, // diamond
	95.5, 96.7, 97.7, 98.4, 98.9, // master
	99.3, 99.5, 99.7, 99.8, 99.9, // grandmaster
	99.9, 100.0, 100.0, 100.0, 100.0, // champion
}

// percentile maps a ladder position onto the population share below it,
// interpolating toward the next rung by progress so the number climbs with
// every point of the meter rather than stepping once per division.
func (p ladderPos) percentile() int {
	// div 5 is the BOTTOM of a tier and div 1 the top, so (5-div) counts
	// divisions climbed within it.
	idx := p.tier*divisionsPerTier + (divisionsPerTier - p.div)
	if idx < 0 {
		return 0
	}
	if idx >= len(divisionPercentile) {
		return 100
	}
	lo := divisionPercentile[idx]
	hi := 100.0
	if idx+1 < len(divisionPercentile) {
		hi = divisionPercentile[idx+1]
	}
	prog := min(max(p.prog, 0), 100)
	return int(math.Round(lo + (hi-lo)*float64(prog)/100))
}

// divisionsPerTier mirrors the frontend's DIVISIONS_PER_TIER; the ladder is
// five divisions to a tier everywhere.
const divisionsPerTier = 5

// rankStartPositions is each track's staggered starting rank. DPS is the main
// role (OW's most-played, and flex gives the main role 60% of role queue), so
// it starts mid-Gold and, with the most games, climbs highest. Div 1 = top, so
// Silver 1 sits just below Gold 5.
var rankStartPositions = map[string]ladderPos{
	"tank":    {tier: 1, div: 1, prog: 0}, // Silver 1
	"dps":     {tier: 2, div: 4, prog: 0}, // Gold 4
	"support": {tier: 2, div: 3, prog: 0}, // Gold 3
	"open":    {tier: 2, div: 5, prog: 0}, // Gold 5
}

// ladderScore is the monotonic ladder position (matches the frontend encoding),
// used to size the position↔skill gap in divisions.
func ladderScore(p ladderPos) float64 {
	return float64(p.tier*5+(5-p.div)) + float64(p.prog)/100
}

// carryUp resolves progress at/above 100 by promoting: division 5→1 within a
// tier, then to the next tier at division 5. Caps at Champion 1 @ 100%.
func carryUp(p ladderPos) ladderPos {
	for p.prog >= 100 {
		switch {
		case p.div > 1:
			p.div--
			p.prog -= 100
		case p.tier < len(tierNames)-1:
			p.tier++
			p.div = 5
			p.prog -= 100
		default:
			p.prog = 100
			return p
		}
	}
	return p
}

// carryDown resolves negative progress by demoting: within-tier division drops
// happen unconditionally; a tier-floor crossing is absorbed once when grace is
// set (demotion protection), otherwise drops to division 1 of the tier below.
// Floors at Bronze 5. Reports whether grace was consumed.
func carryDown(p ladderPos, grace bool) (ladderPos, bool) {
	for p.prog < 0 {
		switch {
		case p.div < 5:
			p.div++
			p.prog += 100
		case p.tier == 0:
			p.prog = 0
			return p, false
		case grace:
			p.prog = 0
			return p, true
		default:
			p.tier--
			p.div = 1
			p.prog += 100
		}
	}
	return p, false
}

// advance moves a ladder position by delta progress-points (signed), resolving
// any division/tier boundary crossing in either direction. Returns the new
// position and whether demotion-protection grace was spent.
func advance(p ladderPos, delta int, grace bool) (ladderPos, bool) {
	p.prog += delta
	switch {
	case p.prog >= 100:
		return carryUp(p), false
	case p.prog < 0:
		return carryDown(p, grace)
	default:
		return p, false
	}
}

// srFromLadder maps a ladder position to a plausible 4-digit SR that tracks the
// ladder monotonically (~1000 at Bronze 5 to ~4400 at Champion 1). Shown only
// in the per-match detail block; never charted.
func srFromLadder(p ladderPos) int {
	score := p.tier*5 + (5 - p.div) // 0..39 — the ladderScore integer part
	return 1000 + score*85 + p.prog*85/100
}
