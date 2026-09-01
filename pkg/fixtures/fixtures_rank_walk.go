package fixtures

import (
	"math/rand"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// One track's walk through a season: draw a result, move the position, decide
// whether this is the game that surfaces a rank card, and build the card.

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
	// The seed always knows both — it computes the ladder rather than reading it
	// off a screenshot — so these are never the nil that means "unreported".
	progress, change := c.pos.prog, c.changePercent
	return db.RankRow{
		ParserGeneration: parser.Generation,
		Filename:         "rank-" + ts + ".png",
		MatchKey:         matchKey,
		Rank:             tierNames[c.pos.tier],
		Level:            c.pos.div,
		RankProgress:     &progress,
		ChangePercent:    &change,
		// Every seeded card carries one. The real caption only exists from
		// season 4, but gating the seed on that date would leave the dossier's
		// percentile widget with a handful of points in a six-month window —
		// the absent path is covered by tests, not by starving the demo data.
		RankPercentile: &percentile,
		Result:         result,
		Modifiers:      c.modifiers,
		SR:             []db.HeroSR{{Hero: hero, SR: c.sr, Change: &c.srChange}},
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
