package fixtures

import (
	"math/rand"
	"strings"

	"recall/pkg/db"
)

// This file models a realistic competitive-rank climb for the seed generator.
// Each role/queue track walks the ladder from a staggered start toward a hidden
// skill ceiling under an ELO win rate — high when underranked (up to ~70%),
// regressing to 50% where you belong — so climbing gets harder the higher you
// go. The meter moves ±19–23% per game (±4–9% at the Bronze/Champion extremes,
// ±26–30% on a 6+ streak), surfacing an old-cadence rank card every 5 wins / 15
// losses. It replaces the previous per-match random rank, which teleported the
// trend (e.g. Gold 1 → Grandmaster 3 between adjacent matches).

// ladderPos is a point on the OW2 ladder, mirroring the frontend ladderScore
// encoding: tier index 0..7, division 1..5 (1 = TOP of the tier — climb 5→1
// then promote), progress 0..100 within the division.
type ladderPos struct {
	tier int
	div  int
	prog int
}

// tierNames indexes tier → the lowercase tier string stored in data.rank
// (identical to the frontend TIER_ORDER and the parser's knownRanks).
var tierNames = []string{
	"bronze", "silver", "gold", "platinum", "diamond", "master", "grandmaster", "champion",
}

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

// rankCeilings is each track's hidden skill ceiling — the rank where its win
// rate has regressed to 50% and the climb plateaus. Set ABOVE every start so
// all tracks begin underranked (win rate > 50%, climbing) and gradually
// equalize as they approach it. This is what makes climbing get harder the
// higher you go. DPS's ceiling is the highest (it's the main role).
var rankCeilings = map[string]ladderPos{
	"tank":    {tier: 2, div: 1, prog: 0}, // Gold 1
	"dps":     {tier: 4, div: 2, prog: 0}, // Diamond 2
	"support": {tier: 3, div: 3, prog: 0}, // Platinum 3
	"open":    {tier: 3, div: 3, prog: 0}, // Platinum 3
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

	// Win-rate model (ELO equilibrium): the rate regresses to wrEqualize at the
	// track's skill ceiling — where you belong — and rises the further BELOW it
	// you sit, capped at wrCeiling and floored at wrFloor. A player placed far
	// under their true rank wins big and climbs fast (up to ~70%); as they reach
	// where they belong the rate GRADUALLY descends to 50% and the climb
	// plateaus. wrSlopePerDiv is rate-points per division of headroom (the cap is
	// reached ~13 divisions below the ceiling). drawRate is the ~1% draw share.
	wrEqualize    = 0.50
	wrCeiling     = 0.70
	wrFloor       = 0.48
	wrSlopePerDiv = 0.015
	drawRate      = 0.01
	// wrSteer pulls a track's realized win rate back toward its position's ELO
	// win-prob using a short moving average of recent results, so a short track
	// (few games) can't get unlucky enough to dip below 50% and sink — every
	// track climbs. Gentle (0.3) so short win/loss streaks still form; the EMA
	// is RECENT (not cumulative) so it corrects local dips without fighting the
	// natural WR descent as the track climbs.
	wrSteer    = 0.3
	wrEMAAlpha = 0.15
)

// ladderScore is the monotonic ladder position (matches the frontend encoding),
// used to size win-rate headroom in divisions.
func ladderScore(p ladderPos) float64 {
	return float64(p.tier*5+(5-p.div)) + float64(p.prog)/100
}

// winProb is the decisive win rate at a position given the track's skill
// ceiling: 50% at the ceiling, rising with headroom below it, clamped to
// [wrFloor, wrCeiling]. Above the ceiling it dips below 50% (a gradual decline
// back toward equilibrium), so the climb self-corrects rather than running away.
func winProb(pos, ceiling ladderPos) float64 {
	wr := wrEqualize + wrSlopePerDiv*(ladderScore(ceiling)-ladderScore(pos))
	return max(wrFloor, min(wrCeiling, wr))
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

// srFromLadder maps a ladder position to a plausible 4-digit SR that tracks the
// ladder monotonically (~1000 at Bronze 5 to ~4400 at Champion 1). Shown only
// in the per-match detail block; never charted.
func srFromLadder(p ladderPos) int {
	score := p.tier*5 + (5 - p.div) // 0..39 — the ladderScore integer part
	return 1000 + score*85 + p.prog*85/100
}

// rankTrackKey maps a match's queue + primary hero to its rank track, mirroring
// the frontend roleBucket: open queue is one combined track; role queue splits
// by the primary hero's role. Returns "" when the role can't be resolved.
func rankTrackKey(queueType, primaryHero string) string {
	if queueType == "open" {
		return "open"
	}
	role := roleOfHero(primaryHero)
	if _, ok := rankStartPositions[role]; ok {
		return role
	}
	return ""
}

// rankCard is one emitted rank reading before projection onto a db.RankRow.
type rankCard struct {
	pos           ladderPos
	changePercent int
	sr            int
	srChange      int
	modifiers     []string
}

// toRankRow projects a card onto a db.RankRow for the given match.
func (c rankCard) toRankRow(matchKey, ts, hero, result string) db.RankRow {
	return db.RankRow{
		Filename:      "rank-" + ts + ".png",
		MatchKey:      matchKey,
		Rank:          tierNames[c.pos.tier],
		Level:         c.pos.div,
		RankProgress:  c.pos.prog,
		ChangePercent: c.changePercent,
		Result:        result,
		Modifiers:     c.modifiers,
		SR:            []db.HeroSR{{Hero: hero, SR: c.sr, Change: c.srChange}},
	}
}

// trackWalk threads one rank track's climbing state across the chronological
// match sequence. The streak counter (consecutive same-result games) is
// independent of the 5-win/15-loss card counter.
type trackWalk struct {
	pos                ladderPos
	ceiling            ladderPos // skill ceiling — where the win rate hits 50%
	grace              bool
	streak             int
	lastResult         string
	games              int
	recentWR           float64 // EMA of recent decisive results — steers realized WR to the ELO curve
	winsSinceCard      int
	lossSinceCard      int
	netSinceCard       int
	graceUsedSinceCard bool
	lastSR             int
}

// drawResult picks a game's outcome: ~1% draw, else a win with the position's
// ELO win-prob, steered by the track's running record so realized WR tracks the
// curve (every track climbs, the descent to 50% is clean) without heavy
// variance. Updates the running record.
func (w *trackWalk) drawResult(rng *rand.Rand) string {
	if rng.Float64() < drawRate {
		return "draw"
	}
	target := winProb(w.pos, w.ceiling)
	p := max(wrFloor, min(wrCeiling, target+wrSteer*(target-w.recentWR)))
	win := rng.Float64() < p
	outcome := 0.0
	if win {
		outcome = 1.0
	}
	w.recentWR = w.recentWR*(1-wrEMAAlpha) + outcome*wrEMAAlpha
	if win {
		return "victory"
	}
	return "defeat"
}

// newTrackWalks builds one walk per track, each seeded at its staggered start
// (with fresh demotion-protection grace) and its skill ceiling.
func newTrackWalks() map[string]*trackWalk {
	walks := make(map[string]*trackWalk, len(rankStartPositions))
	for key, start := range rankStartPositions {
		ceiling := rankCeilings[key]
		walks[key] = &trackWalk{
			pos: start, ceiling: ceiling, grace: true,
			lastSR:   srFromLadder(start),
			recentWR: winProb(start, ceiling), // seed the EMA at the starting win-prob
		}
	}
	return walks
}

// updateStreak advances the consecutive same-result run (0 after a draw).
func (w *trackWalk) updateStreak(result string) {
	switch result {
	case "draw":
		w.streak = 0
	case w.lastResult:
		w.streak++
	default:
		w.streak = 1
	}
	w.lastResult = result
}

// updateGrace refreshes demotion protection on entering a tier and clears it
// when a floor defence consumed it.
func (w *trackWalk) updateGrace(preTier int, graceUsed bool) {
	switch {
	case graceUsed:
		w.grace = false
		w.graceUsedSinceCard = true
	case w.pos.tier != preTier:
		w.grace = true
	}
}

// cadenceFired increments the card counters for a decisive game and reports
// whether a 5-win / 15-loss trigger hit.
func (w *trackWalk) cadenceFired(result string) bool {
	switch result {
	case "victory":
		w.winsSinceCard++
	case "defeat":
		w.lossSinceCard++
	}
	return w.winsSinceCard >= cardWinTrigger || w.lossSinceCard >= cardLossTrigger
}

// step advances the track by one competitive game and returns a rank card iff a
// cadence trigger fired on this game (else nil).
func (w *trackWalk) step(rng *rand.Rand, result string) *rankCard {
	w.games++
	w.updateStreak(result)
	modifier := pickModifier(rng, result, w.streak, w.games)
	delta := perMatchDelta(rng, w.pos.tier, w.streak, result, modifier)
	preTier := w.pos.tier
	newPos, graceUsed := advance(w.pos, delta, w.grace)
	w.pos = newPos
	w.netSinceCard += delta
	w.updateGrace(preTier, graceUsed)
	if !w.cadenceFired(result) {
		return nil
	}
	card := w.emitCard(result, modifier)
	return &card
}

// emitCard snapshots the current position + net movement as a card, then resets
// the per-card counters.
func (w *trackWalk) emitCard(result, modifier string) rankCard {
	sr := srFromLadder(w.pos)
	card := rankCard{
		pos:           w.pos,
		changePercent: w.netSinceCard,
		sr:            sr,
		srChange:      sr - w.lastSR,
		modifiers:     w.cardModifiers(result, modifier),
	}
	w.winsSinceCard, w.lossSinceCard, w.netSinceCard = 0, 0, 0
	w.graceUsedSinceCard = false
	w.lastSR = sr
	return card
}

// cardModifiers builds the pill set stored on a card: the result pill, the
// triggering game's modifier (deduped), and demotion protection if a tier floor
// was defended since the last card. All values are in the schema CHECK enum.
func (w *trackWalk) cardModifiers(result, modifier string) []string {
	mods := []string{result} // "victory" or "defeat" — both in the enum
	if modifier != "" && modifier != result {
		mods = append(mods, modifier)
	}
	if w.graceUsedSinceCard {
		mods = append(mods, "demotion protection")
	}
	return mods
}

// applyRankProgression builds the per-track rank climb AND decides each
// competitive match's result. It walks the chronological, index-aligned
// fx.Summaries (playModes/queueTypes are the parallel per-summary slices):
// each competitive match's win/loss is drawn from its track's ELO win rate at
// its current position and written back onto the summary, then the track's
// meter advances and an old-cadence rank card is emitted onto triggering
// matches. Quickplay results (set by pickWeightedResult at build time) are left
// untouched. Deterministic via the unused seed+8 sub-stream.
//
// PRECONDITION: fx.Summaries is time-sorted (planMatchTimestamps guarantees it)
// and index-aligned with playModes/queueTypes.
func applyRankProgression(fx *Fixture, seed int64, playModes, queueTypes []string) {
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	rng := rand.New(rand.NewSource(seed + 8))
	walks := newTrackWalks()
	fx.Ranks = fx.Ranks[:0]
	for i := range fx.Summaries {
		if i >= len(playModes) || i >= len(queueTypes) || playModes[i] != "competitive" {
			continue
		}
		s := &fx.Summaries[i]
		walk := walks[rankTrackKey(queueTypes[i], s.Hero)]
		if walk == nil {
			continue
		}
		// The result is the track's ELO win rate at its current position — the
		// summary is rewritten to agree with the climb it drives.
		s.Result = walk.drawResult(rng)
		if card := walk.step(rng, s.Result); card != nil {
			fx.Ranks = append(fx.Ranks, card.toRankRow(s.MatchKey, rankTS(s.Filename), s.Hero, s.Result))
		}
	}
}

// rankTS extracts the timestamp core from a summary filename
// ("summary-<ts>.png" → "<ts>") so the rank row shares the match's stamp.
func rankTS(summaryFilename string) string {
	return strings.TrimSuffix(strings.TrimPrefix(summaryFilename, "summary-"), ".png")
}
