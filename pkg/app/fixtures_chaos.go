package app

import (
	"fmt"
	"math/rand"
	"strings"

	"recall/pkg/db"
)

// Chaos seeding sits on top of GenerateMatchFixture so the same
// well-formed corpus can carry pathological data shapes scattered
// through it. Exploratory: run with --chaos=0.15, click around the
// UI, see what blows up. The categories are intentionally varied so
// one chaos run probes layout, parsing, sorting, comparison, and
// aggregation simultaneously rather than asking the user to seed
// six separate profiles.

type chaosCategory int

const (
	chaosLongStrings chaosCategory = iota
	chaosUnicode
	chaosNumericExtreme
	chaosCardinality
	chaosDateExtreme
	chaosAggregationConflict
)

var allChaosCategories = []chaosCategory{
	chaosLongStrings,
	chaosUnicode,
	chaosNumericExtreme,
	chaosCardinality,
	chaosDateExtreme,
	chaosAggregationConflict,
}

// chaosEmojis + chaosZalgo are the "weird but storable" unicode shapes
// the unicode category mixes in. NUL bytes and lone surrogates are
// intentionally excluded — SQLite rejects them and the resulting error
// would mask the bug we're actually probing (frontend rendering).
var (
	chaosEmojis = []string{"💀", "🦄", "🔥", "🤖", "🌈", "👾", "🎮"}
	chaosZalgo  = "z̸̧̛̻̩̮̪̦̮a̴̩̫̲̓ḻ̷̜̇͝g̸̩̱͊͝o̶̢̟̘͒"
)

// GenerateMatchFixtureWithChaos returns the same shape as
// GenerateMatchFixture but mutates a chaosRatio fraction of matches to
// carry pathological data. chaosRatio = 0 short-circuits to the normal
// generator; chaosRatio >= 1 chaos-mutates every match. A separate RNG
// stream (seed+1) drives chaos so toggling the ratio doesn't shift
// the underlying corpus's heroes / maps / dates — same seed, same
// "season," just with weirdness layered in. style is forwarded to
// GenerateMatchFixture ("" / "flex" / "one-trick" / "one-role" /
// "random").
func GenerateMatchFixtureWithChaos(n int, seed int64, style string, chaosRatio float64) Fixture {
	fx := GenerateMatchFixture(n, seed, style)
	if chaosRatio <= 0 {
		return fx
	}
	if chaosRatio > 1 {
		chaosRatio = 1
	}
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	rng := rand.New(rand.NewSource(seed + 1))

	// Index scoreboards by match_key so chaos that touches both rows
	// (long strings, unicode, numeric, cardinality) can mutate them
	// in lockstep without an O(n²) inner scan.
	scoreboardByKey := make(map[string]int, len(fx.Scoreboards))
	for i, sb := range fx.Scoreboards {
		scoreboardByKey[sb.MatchKey] = i
	}

	// aggregation-conflict adds rows to fx.Summaries — collect them
	// in extras so the iteration below doesn't see them and chaos them
	// recursively.
	var extras []db.SummaryRow

	originalLen := len(fx.Summaries)
	for i := 0; i < originalLen; i++ {
		if rng.Float64() >= chaosRatio {
			continue
		}
		numCats := 1 + rng.Intn(2) // 1 or 2 shapes per chaotic match
		applied := make(map[chaosCategory]bool, numCats)
		for k := 0; k < numCats; k++ {
			cat := allChaosCategories[rng.Intn(len(allChaosCategories))]
			if applied[cat] {
				continue
			}
			applied[cat] = true
			applyChaosShape(rng, &fx, i, scoreboardByKey, &extras, cat)
		}
	}
	fx.Summaries = append(fx.Summaries, extras...)
	return fx
}

func applyChaosShape(
	rng *rand.Rand,
	fx *Fixture,
	summaryIdx int,
	scoreboardByKey map[string]int,
	extras *[]db.SummaryRow,
	cat chaosCategory,
) {
	s := &fx.Summaries[summaryIdx]
	var sb *db.ScoreboardRow
	if idx, ok := scoreboardByKey[s.MatchKey]; ok {
		sb = &fx.Scoreboards[idx]
	}

	switch cat {
	case chaosLongStrings:
		s.Hero = strings.Repeat("x", 200)
		s.Map = strings.Repeat("ABCDEFGHIJ", 15) // 150 chars
		if sb != nil {
			sb.Hero = s.Hero
			sb.Map = s.Map
		}

	case chaosUnicode:
		emoji := chaosEmojis[rng.Intn(len(chaosEmojis))]
		s.Map = emoji + " " + chaosZalgo + " map"
		s.Hero = emoji + " " + s.Hero
		if sb != nil {
			sb.Map = s.Map
			sb.Hero = s.Hero
		}

	case chaosNumericExtreme:
		s.PerfElimTotal = 1 << (20 + rng.Intn(8)) // 1M – 256M
		s.PerfAssistsTotal = -1 * rng.Intn(100)   // negative
		if sb != nil {
			sb.Damage = 1 << 28
			sb.Healing = -1 * rng.Intn(50000)
			sb.Eliminations = 1 << 18
		}

	case chaosCardinality:
		s.HeroesPlayed = make([]db.SummaryHeroPlayed, 0, 50)
		for i := 0; i < 50; i++ {
			s.HeroesPlayed = append(s.HeroesPlayed, db.SummaryHeroPlayed{
				Hero:          fmt.Sprintf("synthetic-hero-%02d", i),
				PercentPlayed: rng.Intn(200) - 50, // some out of [0,100]
				PlayTime:      "00:30",
			})
		}
		if sb != nil {
			sb.HeroStats = make([]db.HeroStat, 0, 200)
			for i := 0; i < 200; i++ {
				sb.HeroStats = append(sb.HeroStats, db.HeroStat{
					Hero:      fmt.Sprintf("synthetic-hero-%02d", i%50),
					StatKey:   fmt.Sprintf("stat-%d", i),
					StatValue: rng.Intn(100000),
				})
			}
		}

	case chaosDateExtreme:
		switch rng.Intn(3) {
		case 0:
			s.Date = "1970-01-01"
		case 1:
			s.Date = "2099-12-31"
		default:
			s.Date = "yesterday" // malformed; surfaces date-parsing assumptions
		}

	case chaosAggregationConflict:
		// 1-2 extra summaries sharing the same match_key but with a
		// different map / hero / result so the fold has to pick one.
		for k := 0; k <= rng.Intn(2); k++ {
			extra := *s
			extra.Filename = fmt.Sprintf("summary-conflict-%d-%s.png", k, s.MatchKey)
			extra.Map = fixtureMaps[rng.Intn(len(fixtureMaps))]
			extra.Hero = fixtureTanks[rng.Intn(len(fixtureTanks))]
			extra.Result = fixtureResults[rng.Intn(len(fixtureResults))]
			*extras = append(*extras, extra)
		}
	}
}
