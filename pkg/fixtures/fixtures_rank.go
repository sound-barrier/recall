package fixtures

import (
	"math/rand"
	"strings"
	"time"

	"recall/pkg/db"
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
//
// The mechanisms live in siblings, each of which can be tuned without reading
// the others: fixtures_ladder.go is the board (positions, promotion, demotion
// grace), fixtures_skill.go is the model that decides whether a game is won
// (the rising skill line, the gap-reversion win rate, and every tuning
// constant), and fixtures_rank_walk.go is the per-track walk that plays the
// season out and emits the rank cards.

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
