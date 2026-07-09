package fixtures

import (
	"math/rand"
	"time"
)

// Date range the synthetic corpus covers: a ROLLING window ending today
// and reaching back fixtureWindowMonths, so seeded data always lands in
// the recent period a session (or the in-app sample "test" profile)
// expects to see — instead of a hardcoded calendar window that goes stale.
const fixtureWindowMonths = 8

// fixtureNow is a seam so tests can pin "today" deterministically.
var fixtureNow = time.Now

// fixtureDateRange returns the [start, end] day-boundary window the corpus
// spans: end = today (UTC date), start = end minus fixtureWindowMonths.
func fixtureDateRange() (start, end time.Time) {
	now := fixtureNow().UTC()
	end = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	start = end.AddDate(0, -fixtureWindowMonths, 0)
	return start, end
}

// fixtureHourWeights bias the hour-of-day distribution toward evening
// without making mornings / afternoons impossible. Index = hour (0-23).
// Values are arbitrary scalars; we normalize at sample time.
var fixtureHourWeights = [24]float64{
	0.4, 0.3, 0.2, 0.1, 0.1, 0.1, // 0-5  late-night / very early
	0.2, 0.4, 0.6, 0.8, 1.0, 1.2, // 6-11 morning
	1.5, 1.7, 1.9, 2.1, 2.3, 3.0, // 12-17 afternoon
	5.0, 6.0, 6.5, 6.0, 4.0, 1.5, // 18-23 evening peak
}

// pickWeightedResult biases the match-result distribution toward a climbing
// player's history: ~58.4% wins, ~40.6% losses, ~1% draws. Draws excluded,
// that is a 59% decisive win rate (0.584 / (0.584 + 0.406)) — the rate the seed
// walks up the ladder with, so the tour shows an honest ~59% climb rather than
// a flat coin-flip. Consumes one rng.Float64() call.
func pickWeightedResult(rng *rand.Rand) string {
	switch r := rng.Float64(); {
	case r < 0.584:
		return "victory"
	case r < 0.99:
		return "defeat"
	default:
		return "draw"
	}
}

func pickWeightedHour(rng *rand.Rand) int {
	total := 0.0
	for _, w := range fixtureHourWeights {
		total += w
	}
	r := rng.Float64() * total
	accum := 0.0
	for i, w := range fixtureHourWeights {
		accum += w
		if r < accum {
			return i
		}
	}
	return 23
}

// sampleWeightedIndex returns an index into weights drawn proportional
// to each entry's weight. total must equal sum(weights). O(len(weights))
// per call — fine at the scale we use it (a few hundred days, a few
// hundred matches).
func sampleWeightedIndex(rng *rand.Rand, weights []float64, total float64) int {
	r := rng.Float64() * total
	accum := 0.0
	for i, w := range weights {
		accum += w
		if r < accum {
			return i
		}
	}
	return len(weights) - 1
}
