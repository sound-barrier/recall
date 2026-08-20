package fixtures

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
	// chaosMissingPlayMode wipes both the OCR-derived data.mode AND
	// the user-override match_play_mode row so the leaf-row chip
	// renders "Unknown mode" — exercising the empty-field path the
	// other categories never trigger.
	chaosMissingPlayMode
	// chaosMissingQueueType drops the user-override match_queue row
	// so the leaf-row chip renders "Unknown mode type." No OCR
	// source for queue exists, so this is the only path to the
	// fallback chip.
	chaosMissingQueueType
)

var allChaosCategories = []chaosCategory{
	chaosLongStrings,
	chaosUnicode,
	chaosNumericExtreme,
	chaosCardinality,
	chaosDateExtreme,
	chaosAggregationConflict,
	chaosMissingPlayMode,
	chaosMissingQueueType,
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

	// Index teams by match_key so chaos that touches both rows
	// (long strings, unicode, numeric, cardinality) can mutate them
	// in lockstep without an O(n²) inner scan.
	teamsByKey := make(map[string]int, len(fx.Teams))
	for i, sb := range fx.Teams {
		teamsByKey[sb.MatchKey] = i
	}

	// aggregation-conflict adds rows to fx.Summaries — collect them
	// in extras so the iteration below doesn't see them and chaos them
	// recursively.
	var extras []db.SummaryRow

	originalLen := len(fx.Summaries)
	for i := range originalLen {
		if rng.Float64() >= chaosRatio {
			continue
		}
		numCats := 1 + rng.Intn(2) // 1 or 2 shapes per chaotic match
		applied := make(map[chaosCategory]bool, numCats)
		for range numCats {
			cat := allChaosCategories[rng.Intn(len(allChaosCategories))]
			if applied[cat] {
				continue
			}
			applied[cat] = true
			applyChaosShape(rng, &fx, i, teamsByKey, &extras, cat)
		}
	}
	fx.Summaries = append(fx.Summaries, extras...)
	return fx
}

// chaosCtx carries what every chaos shape mutates: the summary row
// under attack (s), its optional teams sibling (sb, nil when the match
// has none), the whole fixture, the run RNG, and the accumulator for
// aggregation-conflict extra rows.
type chaosCtx struct {
	rng    *rand.Rand
	fx     *Fixture
	s      *db.SummaryRow
	sb     *db.TeamsRow
	extras *[]db.SummaryRow
}

// chaosShapes maps each category to its mutation. A map loses the
// exhaustive check a switch had, so TestChaosShapes_CoversEveryCategory
// pins registry completeness instead (the NARROW_CLAUSES pattern).
var chaosShapes = map[chaosCategory]func(*chaosCtx){
	chaosLongStrings: func(c *chaosCtx) {
		c.s.Hero = strings.Repeat("x", 200)
		c.s.Map = strings.Repeat("ABCDEFGHIJ", 15) // 150 chars
	},
	chaosUnicode: func(c *chaosCtx) {
		emoji := chaosEmojis[c.rng.Intn(len(chaosEmojis))]
		c.s.Map = emoji + " " + chaosZalgo + " map"
		c.s.Hero = emoji + " " + c.s.Hero
	},
	chaosNumericExtreme: func(c *chaosCtx) {
		c.s.Eliminations = 1 << (20 + c.rng.Intn(8)) // 1M – 256M
		c.s.Assists = -1 * c.rng.Intn(100)           // negative
		if c.sb != nil {
			c.sb.Damage = 1 << 28
			c.sb.Healing = -1 * c.rng.Intn(50000)
			c.sb.Eliminations = 1 << 18
		}
	},
	chaosCardinality: func(c *chaosCtx) {
		c.s.HeroesPlayed = make([]db.SummaryHeroPlayed, 0, 50)
		for i := range 50 {
			c.s.HeroesPlayed = append(c.s.HeroesPlayed, db.SummaryHeroPlayed{
				Hero:          fmt.Sprintf("synthetic-hero-%02d", i),
				PercentPlayed: c.rng.Intn(200) - 50, // some out of [0,100]
				PlayTime:      "00:30",
			})
		}
		if c.sb != nil {
			c.sb.HeroStats = make([]db.HeroStat, 0, 200)
			for i := range 200 {
				c.sb.HeroStats = append(c.sb.HeroStats, db.HeroStat{
					Hero:      fmt.Sprintf("synthetic-hero-%02d", i%50),
					StatKey:   fmt.Sprintf("stat-%d", i),
					StatValue: c.rng.Intn(100000),
				})
			}
		}
	},
	chaosDateExtreme: func(c *chaosCtx) {
		switch c.rng.Intn(3) {
		case 0:
			c.s.Date = "1970-01-01"
		case 1:
			c.s.Date = "2099-12-31"
		default:
			c.s.Date = "yesterday" // malformed; surfaces date-parsing assumptions
		}
	},
	chaosAggregationConflict: func(c *chaosCtx) {
		// 1-2 extra summaries sharing the same match_key but with a
		// different map / hero / result so the fold has to pick one.
		for k := 0; k <= c.rng.Intn(2); k++ {
			extra := *c.s
			extra.Filename = fmt.Sprintf("summary-conflict-%d-%s.png", k, c.s.MatchKey)
			extra.Map = fixtureMaps[c.rng.Intn(len(fixtureMaps))]
			extra.Hero = fixtureTanks[c.rng.Intn(len(fixtureTanks))]
			extra.Result = fixtureResults[c.rng.Intn(len(fixtureResults))]
			*c.extras = append(*c.extras, extra)
		}
	},
	chaosMissingPlayMode: func(c *chaosCtx) {
		// Wipe the OCR-derived mode on every screenshot row sharing
		// this match_key AND drop the user-override PlayModeSeed
		// for the same key. Result: both code paths that hand the
		// frontend a play-mode value come up empty, so the leaf-row
		// chip renders the "Unknown mode" fallback — the previously-
		// untested empty-field rendering path.
		c.s.Playlist = ""
		c.fx.PlayModes = dropPlayModeSeed(c.fx.PlayModes, c.s.MatchKey)
	},
	chaosMissingQueueType: func(c *chaosCtx) {
		// Queue type has no OCR source — it's user-override only,
		// stored as a QueueSeed by the seed tool. Dropping the seed
		// is the only path to the "Unknown mode type" chip
		// rendering.
		c.fx.Queues = dropQueueSeed(c.fx.Queues, c.s.MatchKey)
	},
}

func applyChaosShape(
	rng *rand.Rand,
	fx *Fixture,
	summaryIdx int,
	teamsByKey map[string]int,
	extras *[]db.SummaryRow,
	cat chaosCategory,
) {
	s := &fx.Summaries[summaryIdx]
	var sb *db.TeamsRow
	if idx, ok := teamsByKey[s.MatchKey]; ok {
		sb = &fx.Teams[idx]
	}
	if shape, ok := chaosShapes[cat]; ok {
		shape(&chaosCtx{rng: rng, fx: fx, s: s, sb: sb, extras: extras})
	}
}

// dropPlayModeSeed returns the seeds slice with every entry for
// matchKey removed. O(n) — the chaos category fires on a small
// subset of matches per run, so the cost is negligible against the
// surrounding generator.
func dropPlayModeSeed(seeds []PlayModeSeed, matchKey string) []PlayModeSeed {
	out := seeds[:0:len(seeds)]
	for _, p := range seeds {
		if p.MatchKey == matchKey {
			continue
		}
		out = append(out, p)
	}
	return out
}

// dropQueueSeed mirrors dropPlayModeSeed for the QueueSeeds slice.
func dropQueueSeed(seeds []QueueSeed, matchKey string) []QueueSeed {
	out := seeds[:0:len(seeds)]
	for _, q := range seeds {
		if q.MatchKey == matchKey {
			continue
		}
		out = append(out, q)
	}
	return out
}
