package fixtures

import (
	"math"
	"math/rand"
	"sort"
	"time"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// Fixture is the bundle of synthetic per-screenshot-type rows returned
// by GenerateMatchFixture. The dev seed tool (cmd/seed-dev) feeds each
// slice into the matching Store.Upsert* method; tests can do the same
// against a dbtest.Fake without duplicating fixture-builder code.
type Fixture struct {
	Summaries []db.SummaryRow
	Teams     []db.TeamsRow
	Personals []db.PersonalRow
	Ranks     []db.RankRow
	// Reviews names the subset of match_keys that should carry a
	// review row (`self` or `coach`). Empty for the vast majority of
	// matches — fed into Store.SetReview by the seed tool.
	Reviews []ReviewSeed
	// Queues names every match_key whose queue_type the seed tool
	// should upsert via Store.SetMatchQueue. ~80% role, ~20% open
	// (matches real OW play distribution) so the new toggle + filter
	// have meaningful data to eyeball against.
	Queues []QueueSeed
	// PlayModes names every match_key whose play_mode the seed tool
	// should upsert via Store.SetMatchPlayMode. ~90% competitive,
	// ~10% quickplay — users of this tool skew comp. Set on every
	// match (no fallback through the aggregator's data.mode →
	// rank-presence chain — the seeded corpus uses the override path
	// exclusively so the aux table populates predictably).
	PlayModes []PlayModeSeed
	// Unknowns are screenshots the parser couldn't classify — modeled
	// as ~2% of N. The seed tool inserts each via Store.UpsertUnknown
	// so the Unknown tab has something to render for triage-flow
	// eyeballing. Each gets an `unmatched-<filename>` match key.
	Unknowns []db.UnknownRow
	// Ambiguous are teams-class screenshots whose match resolver
	// landed on multiple candidate matches — modeled as ~1% of N. The
	// seed tool inserts the teams via UpsertTeams with an
	// `ambiguous-<filename>` match key AND calls Store.ApplyAmbiguity
	// to populate the candidate list. Each carries 2-3 candidates
	// pointing at real seeded match_keys so the resolver UI has
	// realistic ties to disambiguate.
	Ambiguous []AmbiguousSeed
	// UserData seeds the user-override layer so a seeded profile exercises
	// all three provenance states: an edited OCR match (override row over an
	// existing screenshot-backed key → ocr_edited) and hand-entered matches
	// (override row whose key has no screenshot row → manual). The seed tool
	// inserts each via Store.UpsertUserMatchData; manual keys also get
	// Queue / PlayMode seeds so they read like real matches.
	UserData []db.UserMatchData
}

// ReviewSeed pairs a match_key with the reviewer kind ("self" or
// "coach") for the seed tool to upsert via Store.SetReview.
type ReviewSeed struct {
	MatchKey   string
	ReviewedBy string
}

// QueueSeed pairs a match_key with the queue kind ("role" or "open")
// for the seed tool to upsert via Store.SetMatchQueue.
type QueueSeed struct {
	MatchKey  string
	QueueType string
}

// PlayModeSeed pairs a match_key with the play-mode kind
// ("quickplay" or "competitive") for the seed tool to upsert via
// Store.SetMatchPlayMode.
type PlayModeSeed struct {
	MatchKey string
	PlayMode string
}

// AmbiguousSeed pairs an `ambiguous-<filename>` screenshot's filename
// with the candidate match list the seed tool should write via
// Store.ApplyAmbiguity. The accompanying teams row is emitted
// into Fixture.Teams with match_key = "ambiguous-" + Filename so
// the read path attaches the candidates to it.
type AmbiguousSeed struct {
	Filename   string
	Candidates []db.AmbiguousCandidate
}

// Variation pools. Hero + map pools are derived from the parser's
// canonical YAML data at init() time — adding a new OW hero or map
// to pkg/parser/heroes.yaml / maps.yaml auto-populates the fixture
// without a duplicate edit here. Names are normalized to lower-case
// + diacritic-strip + colon-strip to match what the real parser
// writes to data.hero / data.map (and what the frontend's
// `useOWData.heroDisplayName(stored)` lookup expects on the input
// side). Game type is derived from the map name at read time via
// parser.MapGameMode — no fixture-side game-type list.
var (
	fixtureMaps     []string
	fixtureTanks    []string
	fixtureSupports []string
	fixtureDPS      []string

	fixtureResults = []string{"victory", "defeat", "draw"}
	fixtureRanks   = []string{"bronze", "silver", "gold", "platinum", "diamond"}
)

func init() {
	heroes := parser.HeroesByRole()
	fixtureTanks = normalizeAll(heroes["tank"])
	fixtureSupports = normalizeAll(heroes["support"])
	fixtureDPS = normalizeAll(heroes["dps"])
	// Flatten MapsByGameMode into a single pool. The order across game
	// types is stable per Go's map iteration is not — but we shuffle
	// per seed downstream anyway, so the source order doesn't matter
	// for determinism (the shuffle is rng-driven).
	for _, gameModeMaps := range parser.MapsByGameMode() {
		fixtureMaps = append(fixtureMaps, normalizeAll(gameModeMaps)...)
	}
	// Sort the map pool so subsequent runs see the same source order
	// before the per-seed shuffle — keeps GenerateMatchFixture
	// byte-deterministic across processes.
	sort.Strings(fixtureMaps)
}

// normalizeAll converts a slice of canonical OW names (from the
// parser's embedded YAML) into the normalized keys the real parser
// stores in data.hero / data.map.
func normalizeAll(canonical []string) []string {
	out := make([]string, len(canonical))
	for i, c := range canonical {
		out[i] = parser.Normalize(c)
	}
	return out
}

// GenerateMatchFixture builds n synthetic matches and returns them as
// four slices (one per parent screenshot table). Every choice is
// driven by a single rand.Source seeded by `seed`, so calling with
// the same (n, seed, style) tuple twice produces byte-identical
// output. Pass time.Now().UnixNano() (or `make seed-dev SEED=time`)
// to get a different shuffle each invocation.
//
// style controls the synthetic player's hero-pick shape:
//   - "" / "flex" (default): 2-3 main heroes per role + 10% off-main
//     experiments, plus a post-pass that ensures every map AND every
//     hero in the pools appears at least once — edge-case eyeballing
//     against a corpus that exercises every icon / label / sort key.
//   - "one-trick": 95% the same hero in the player's main role,
//     occasional experiments. No coverage forcing — one-trickers by
//     definition can't cover every hero.
//   - "one-role": mostly main-role heroes with same-hero streaks,
//     15% off-role experiments. No coverage forcing.
//   - "random": per-seed RNG picks one of the three styles (20% /
//     30% / 50%). Preserved for multi-seed sweeps that want variety.
//
// Distribution:
//   - Dates: random over the rolling [today-8mo, today] window with
//     per-day activity weights — ~40% of days inactive, a long tail
//     of small/medium days, occasional marathon days. Sessions cluster
//     naturally because the sample-per-day count varies.
//   - Time of day: weighted toward evening (18-22h) but with morning,
//     afternoon, and late-night samples (see fixtureHourWeights).
//   - Maps: per-seed shuffled order + exponential decay weights
//     (top-heavy: a handful dominate, the tail tapers off).
//   - Heroes: per playStyle (see above) plus same-day streak bias.
//
// Every match emits one Summary + one Teams. Personal lands on
// ~60% of matches, Rank on ~40% — mirrors what the production parser
// actually persists. All four rows for one match share a single
// MatchKey minted via match.NewTrackedMatchKey.
//
// The generator is pure data construction — never touches a Store or
// filesystem — so tests can exercise it without setup beyond stdlib.
func GenerateMatchFixture(n int, seed int64, style string) Fixture {
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	rng := rand.New(rand.NewSource(seed))

	rangeStart, rangeEnd := fixtureDateRange()
	totalDays := int(rangeEnd.Sub(rangeStart).Hours()/24) + 1

	dayWeights, totalDayW := fixtureDayWeights(rng, totalDays)
	planned := planMatchTimestamps(rng, rangeStart, dayWeights, totalDayW, n)
	profile := newPlayerProfile(rng, parsePlayStyle(rng, style))
	md := fixtureMapDistribution(rng)
	playModes, queueTypes := precomputePerMatchModes(seed, n)

	fx := Fixture{
		Summaries: make([]db.SummaryRow, 0, n),
		Teams:     make([]db.TeamsRow, 0, n),
		Personals: make([]db.PersonalRow, 0, n*6/10),
		Ranks:     make([]db.RankRow, 0, n*4/10),
		PlayModes: make([]PlayModeSeed, 0, n),
	}

	// Per-summary parallel slices for queue type + play mode. Built
	// during the main loop so summary index → planned[] index stays
	// aligned even when the per-match dice rolls drop summaries (the
	// pre-computed queueTypes/playModes slices are indexed by planned[],
	// not by fx.Summaries — using them by summary index would silently
	// miscount once dice rolls land).
	summaryQueueTypes := make([]string, 0, n)
	summaryPlayModes := make([]string, 0, n)

	var prevDay, prevHero string
	for i, t := range planned {
		day := t.Format("2006-01-02")
		if day != prevDay {
			prevHero = ""
			prevDay = day
		}
		prevHero = fx.appendGeneratedMatch(rng, profile, md, t, playModes[i], queueTypes[i], prevHero, &summaryQueueTypes, &summaryPlayModes)
	}

	// Coverage pass (flex only): ensure every map AND every hero in the
	// pools appears at least once — the top-heavy map weights + 6-9 flex
	// mains naturally miss a handful per run, but edge-case eyeballing of
	// the dossier / leaves / Campaign Log wants to see every icon render.
	// Skipped for one-trick / one-role (they can't cover everything by
	// definition).
	if profile.style == styleFlex && len(fx.Summaries) > 0 {
		ensureCoverage(rng, &fx, summaryQueueTypes)
	}

	// Clash is quickplay-only — normalize after the loop + coverage pass, both
	// of which pick the play mode without consulting the map.
	forceClashQuickplay(&fx, summaryPlayModes)

	fx.appendReviewSeeds(seed)
	fx.appendQueueAndPlayModeSeeds(summaryQueueTypes, summaryPlayModes)
	fx.appendUnknownScreenshots(seed, n, rangeStart, dayWeights, totalDayW)
	fx.appendAmbiguousScreenshots(seed, n, rangeStart, dayWeights, totalDayW)
	fx.appendUserMatchVariants(seed)

	return fx
}

// forceClashQuickplay normalizes every Clash match to quickplay. Clash is a
// quickplay-only mode, but the per-match play-mode roll AND the coverage
// map-patch are both map-blind, so a Clash map can land on a "competitive"
// summary (with a competitive override seed, and even a rank screenshot).
// Rewrite after the fact: quickplay playlist + override seed, and drop any rank
// row keyed to a Clash match (rank screens only exist for competitive play).
// summaryPlayModes is index-aligned with fx.Summaries.
func forceClashQuickplay(fx *Fixture, summaryPlayModes []string) {
	clashKeys := make(map[string]bool)
	for i := range fx.Summaries {
		s := &fx.Summaries[i]
		if parser.MapGameMode(s.Map) != "clash" {
			continue
		}
		s.Playlist = "quickplay"
		if i < len(summaryPlayModes) {
			summaryPlayModes[i] = "quickplay"
		}
		clashKeys[s.MatchKey] = true
	}
	if len(clashKeys) == 0 {
		return
	}
	kept := fx.Ranks[:0]
	for _, r := range fx.Ranks {
		if !clashKeys[r.MatchKey] {
			kept = append(kept, r)
		}
	}
	fx.Ranks = kept
}

// fixtureDayWeights builds per-day activity weights: ~40% inactive; the
// rest get a long-tail weight with an occasional spike day (marathon
// session). A pathological all-inactive seed falls back to one mid-range
// active day so the corpus is never empty.
func fixtureDayWeights(rng *rand.Rand, totalDays int) ([]float64, float64) {
	dayWeights := make([]float64, totalDays)
	totalDayW := 0.0
	for i := range dayWeights {
		if rng.Float64() < 0.4 {
			continue
		}
		w := 1.0 + rng.Float64()*3
		if rng.Float64() < 0.08 {
			w *= 5
		}
		dayWeights[i] = w
		totalDayW += w
	}
	if totalDayW == 0 { // guard pathological seeds
		dayWeights[totalDays/2] = 1.0
		totalDayW = 1.0
	}
	return dayWeights, totalDayW
}

// planMatchTimestamps samples n match timestamps weighted by day + hour,
// sorts them, and bumps duplicates by a minute so every match_key is
// unique (collisions are vanishingly rare at the scale we use).
func planMatchTimestamps(rng *rand.Rand, rangeStart time.Time, dayWeights []float64, totalDayW float64, n int) []time.Time {
	planned := make([]time.Time, n)
	for i := range n {
		dayIdx := sampleWeightedIndex(rng, dayWeights, totalDayW)
		day := rangeStart.AddDate(0, 0, dayIdx)
		h := pickWeightedHour(rng)
		m := rng.Intn(60)
		s := rng.Intn(60)
		planned[i] = time.Date(day.Year(), day.Month(), day.Day(), h, m, s, 0, time.UTC)
	}
	sort.Slice(planned, func(i, j int) bool { return planned[i].Before(planned[j]) })
	for i := 1; i < len(planned); i++ {
		for !planned[i].After(planned[i-1]) {
			planned[i] = planned[i-1].Add(time.Minute)
		}
	}
	return planned
}

// mapDistribution is a per-seed top-heavy map weighting: the pool is
// shuffled so different seeds emphasize different maps, then weighted by
// position via exponential decay (the top ~3 maps carry most of the
// corpus while the tail tapers off).
type mapDistribution struct {
	maps    []string
	weights []float64
	total   float64
}

func (md mapDistribution) pick(rng *rand.Rand) string {
	return md.maps[sampleWeightedIndex(rng, md.weights, md.total)]
}

func fixtureMapDistribution(rng *rand.Rand) mapDistribution {
	shuffled := append([]string(nil), fixtureMaps...)
	rng.Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})
	weights := make([]float64, len(shuffled))
	total := 0.0
	for i := range weights {
		w := math.Pow(0.75, float64(i))
		weights[i] = w
		total += w
	}
	return mapDistribution{maps: shuffled, weights: weights, total: total}
}

// precomputePerMatchModes pre-rolls per-match play modes (10% quickplay)
// and queue types (~80% role) using derived RNGs (seed+4 / seed+3) so
// toggling either rate doesn't shift the main corpus, and so the
// hero-picker can honor the role-queue single-role constraint.
func precomputePerMatchModes(seed int64, n int) (playModes, queueTypes []string) {
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	playModeRng := rand.New(rand.NewSource(seed + 4))
	playModes = make([]string, n)
	for i := range playModes {
		if playModeRng.Float64() < 0.10 {
			playModes[i] = "quickplay"
		} else {
			playModes[i] = "competitive"
		}
	}
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	queueRng := rand.New(rand.NewSource(seed + 3))
	queueTypes = make([]string, n)
	for i := range queueTypes {
		if queueRng.Float64() < 0.2 {
			queueTypes[i] = "open"
		} else {
			queueTypes[i] = "role"
		}
	}
	return playModes, queueTypes
}
