package fixtures

import (
	"math"
	"math/rand"
	"strings"
	"time"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// This file models a realistic competitive-rank climb for the seed generator.
// Each role/queue track walks the ladder around a slowly RISING true-skill
// line: the win rate responds to the gap between position and line (below it
// → elevated and recovering, above it → under 50% and falling back), so the
// season prints local minima that bounce and local maxima that correct — mean
// reversion around real skill. An autocorrelated form walk layers hot streaks
// and cold slumps on top, and per-match hero costs (3+ heroes swapped, or an
// off-pool primary) subtract win probability — the seeded account loses the
// games a real player loses. The meter moves ±19–23% per game (±4–9% at the
// Bronze/Champion extremes, ±26–30% on a 6+ streak), surfacing an old-cadence
// rank card every 5 wins / 15 losses.

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

// tierPercentileCeiling is the share of the population at or below the TOP of
// each tier, indexed like tierNames. It exists so a seeded rank card can carry
// a rank_percentile ("HIGHER RANKED THAN N% OF PLAYERS") that AGREES with the
// tier it is printed beside — a Gold player showing 90% would make every
// screenshot of the dev seed obviously fake.
//
// SYNTHETIC. Blizzard publishes no distribution, which is precisely why
// commit a928122f deleted the old Elo population card. These are plausible
// round numbers with a bell-ish shape (the mass sits in gold/platinum), not a
// measurement, and nothing outside the dev seed may treat them as one. They
// are calibrated only loosely: the season-4 fixtures read 57-61% around
// Platinum 1-2, and this curve puts that region in the same neighborhood.
//
// Length is pinned to the tier ladder by a test, so adding a tier fails loudly
// here rather than silently reusing its neighbor's ceiling.
var tierPercentileCeiling = []int{
	8,   // bronze
	22,  // silver
	48,  // gold
	68,  // platinum
	82,  // emerald
	92,  // diamond
	97,  // master
	99,  // grandmaster
	100, // champion
}

// percentile maps a ladder position onto the population share below it,
// interpolating within the tier so the number climbs with every division and
// every point of progress rather than stepping once per tier.
func (p ladderPos) percentile() int {
	if p.tier < 0 || p.tier >= len(tierPercentileCeiling) {
		return 0
	}
	floor := 0
	if p.tier > 0 {
		floor = tierPercentileCeiling[p.tier-1]
	}
	ceiling := tierPercentileCeiling[p.tier]
	// div 5 is the BOTTOM of a tier and div 1 the top, so (5-div) counts
	// divisions climbed; prog carries the fraction of the current one.
	climbed := (float64(5-p.div) + float64(p.prog)/100) / 5
	return floor + int(math.Round(float64(ceiling-floor)*climbed))
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

// ladderScore is the monotonic ladder position (matches the frontend encoding),
// used to size the position↔skill gap in divisions.
func ladderScore(p ladderPos) float64 {
	return float64(p.tier*5+(5-p.div)) + float64(p.prog)/100
}

// winProb is the clean-game decisive win rate: gap reversion around the true-
// skill line plus the current form, clamped to [wrFloor, wrCeiling]. Positive
// gap = underranked = elevated rate; negative = overranked = sub-50 and
// falling back toward the line.
func winProb(posScore, lineScore, formPts float64) float64 {
	gapTerm := max(-wrGapCap, min(wrGapCap, gapSlope*(lineScore-posScore)))
	return max(wrFloor, min(wrCeiling, wrEqualize+gapTerm+formPts/100))
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
	percentile := c.pos.percentile()
	return db.RankRow{
		Filename:      "rank-" + ts + ".png",
		MatchKey:      matchKey,
		Rank:          tierNames[c.pos.tier],
		Level:         c.pos.div,
		RankProgress:  c.pos.prog,
		ChangePercent: c.changePercent,
		// Every seeded card carries one. The real caption only exists from
		// season 4, but gating the seed on that date would leave the dossier's
		// percentile widget with a handful of points in a six-month window —
		// the absent path is covered by tests, not by starving the demo data.
		RankPercentile: &percentile,
		Result:         result,
		Modifiers:      c.modifiers,
		SR:             []db.HeroSR{{Hero: hero, SR: c.sr, Change: c.srChange}},
	}
}

// trackWalk threads one rank track's climbing state across the chronological
// match sequence. The streak counter (consecutive same-result games) is
// independent of the 5-win/15-loss card counter.
type trackWalk struct {
	pos                ladderPos
	grace              bool
	streak             int
	lastResult         string
	games              int
	form               float64 // autocorrelated mood, win-rate points, ±formAmpPts
	winsSinceCard      int
	lossSinceCard      int
	netSinceCard       int
	graceUsedSinceCard bool
	lastSR             int
}

// drawResult picks a game's outcome: ~1% draw, else a win with the gap-
// reversion probability at the track's position against its true-skill line,
// shifted by the rolling form walk and the match's hero-cost penalty.
func (w *trackWalk) drawResult(rng *rand.Rand, lineScore, penaltyPts float64) string {
	if rng.Float64() < drawRate {
		return "draw"
	}
	w.form = max(-formAmpPts, min(formAmpPts, w.form+rng.NormFloat64()*formStepPts))
	p := winProb(ladderScore(w.pos), lineScore, w.form) - penaltyPts/100
	p = max(pFloor, min(pCeil, p))
	if rng.Float64() < p {
		return "victory"
	}
	return "defeat"
}

// newTrackWalks builds one walk per track, seeded at its staggered start with
// fresh demotion-protection grace and neutral form.
func newTrackWalks() map[string]*trackWalk {
	walks := make(map[string]*trackWalk, len(rankStartPositions))
	for key, start := range rankStartPositions {
		walks[key] = &trackWalk{
			pos: start, grace: true,
			lastSR: srFromLadder(start),
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
// when a floor defense consumed it.
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

// matchPenaltyPts is the match's hero-cost tax in win-probability points
// (≥ 0; drawResult subtracts it). Swapping to a third hero marks a game that
// was going badly and got worse; a fourth is desperation. An off-pool primary
// stacks its own smaller tax on top.
func matchPenaltyPts(s *db.SummaryRow, isPoolHero func(string) bool) float64 {
	meaningful := 0
	for _, hp := range s.HeroesPlayed {
		if hp.PercentPlayed >= meaningfulHeroPct {
			meaningful++
		}
	}
	pts := 0.0
	switch {
	case meaningful >= 4:
		pts += multiHeroFourPenaltyPts
	case meaningful == 3:
		pts += multiHeroThreePenaltyPts
	}
	if !isPoolHero(s.Hero) {
		pts += offPoolPenaltyPts
	}
	return pts
}

// playerState is the cross-track, per-day human state the walk pass threads
// through the chronological summaries: how rusty the player still is after a
// break, and how tilted today's queue has become.
type playerState struct {
	lastDay    string
	rustLeft   int
	dayLossRun int
}

// observe updates the state for the next competitive match's date and
// returns the rust+tilt penalty (win-probability points) it plays under.
func (ps *playerState) observe(day string) float64 {
	if ps.lastDay != "" && day != ps.lastDay {
		if gap := daysBetween(ps.lastDay, day); gap >= rustGapDays {
			ps.rustLeft = rustGames
		}
		ps.dayLossRun = 0
	}
	ps.lastDay = day
	penalty := 0.0
	if ps.rustLeft > 0 {
		penalty += rustMaxPts * float64(ps.rustLeft) / rustGames
		ps.rustLeft--
	}
	if ps.dayLossRun >= tiltRunStart {
		penalty += tiltPts
	}
	return penalty
}

// record folds the game's outcome into the tilt run (draws leave it be).
func (ps *playerState) record(result string) {
	switch result {
	case "victory":
		ps.dayLossRun = 0
	case "defeat":
		ps.dayLossRun++
	}
}

// daysBetween is the calendar-day distance between two YYYY-MM-DD dates;
// zero when either fails to parse (synthetic dates never do).
func daysBetween(a, b string) int {
	ta, errA := time.Parse("2006-01-02", a)
	tb, errB := time.Parse("2006-01-02", b)
	if errA != nil || errB != nil {
		return 0
	}
	return int(tb.Sub(ta).Hours() / 24)
}

// applyRankProgression builds the per-track rank climb AND decides each
// competitive match's result. It walks the chronological, index-aligned
// fx.Summaries (playModes/queueTypes are the parallel per-summary slices):
// each competitive match's win/loss is drawn from its track's gap-reversion
// rate against the season's true-skill line (index fraction ≈ season time,
// since summaries are time-sorted), shifted by form and the match's hero
// costs, and written back onto the summary; then the track's meter advances
// and an old-cadence rank card is emitted onto triggering matches. Quickplay
// results (set by pickWeightedResult at build time) are left untouched.
// Deterministic via the seed+8 sub-stream.
//
// PRECONDITION: fx.Summaries is time-sorted (planMatchTimestamps guarantees it)
// and index-aligned with playModes/queueTypes.
func applyRankProgression(fx *Fixture, seed int64, playModes, queueTypes []string, isPoolHero func(string) bool) {
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	rng := rand.New(rand.NewSource(seed + 8))
	walks := newTrackWalks()
	human := &playerState{}
	fx.Ranks = fx.Ranks[:0]
	lastIdx := max(len(fx.Summaries)-1, 1)
	for i := range fx.Summaries {
		if i >= len(playModes) || i >= len(queueTypes) || playModes[i] != "competitive" {
			continue
		}
		s := &fx.Summaries[i]
		track := rankTrackKey(queueTypes[i], s.Hero)
		walk := walks[track]
		if walk == nil {
			continue
		}
		line := trueSkillAt(track, float64(i)/float64(lastIdx))
		penalty := matchPenaltyPts(s, isPoolHero) + human.observe(s.Date)
		s.Result = walk.drawResult(rng, line, penalty)
		human.record(s.Result)
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
