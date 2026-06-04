package app

import (
	"fmt"
	"math"
	"math/rand"
	"sort"
	"time"

	"recall/pkg/db"
)

// Fixture is the bundle of synthetic per-screenshot-type rows returned
// by GenerateMatchFixture. The dev seed tool (cmd/seed-dev) feeds each
// slice into the matching Store.Upsert* method; tests can do the same
// against a dbtest.Fake without duplicating fixture-builder code.
type Fixture struct {
	Summaries   []db.SummaryRow
	Scoreboards []db.ScoreboardRow
	Personals   []db.PersonalRow
	Ranks       []db.RankRow
	// Reviews names the subset of match_keys that should carry a
	// review row (`self` or `coach`). Empty for the vast majority of
	// matches — fed into Store.SetReview by the seed tool.
	Reviews []ReviewSeed
}

// ReviewSeed pairs a match_key with the reviewer kind ("self" or
// "coach") for the seed tool to upsert via Store.SetReview.
type ReviewSeed struct {
	MatchKey   string
	ReviewedBy string
}

// Date range the synthetic corpus covers. Hardcoded to a year-to-date
// window so the seeded data lands inside the period a manual test
// session expects to see; bump if the "season" you want to test
// against shifts.
const (
	fixtureDateStart = "2026-01-01"
	fixtureDateEnd   = "2026-06-03"
)

// Variation pools. Lower-case to match parse.go and the e2e stub at
// frontend/tests/e2e/matches-set-workspace.spec.ts. Short on purpose —
// the dossier reads meaningfully from even a 5-per-role pool.
var (
	fixtureMaps = []string{
		"lijiang tower", "rialto", "kings row", "hanamura",
		"dorado", "ilios", "oasis", "numbani",
		"route 66", "blizzard world", "junkertown", "havana",
	}
	fixtureModes   = []string{"control", "escort", "hybrid", "push", "flashpoint", "clash"}
	fixtureResults = []string{"victory", "defeat", "draw"}
	fixtureRanks   = []string{"bronze", "silver", "gold", "platinum", "diamond"}

	fixtureTanks    = []string{"reinhardt", "winston", "dva", "orisa", "sigma"}
	fixtureSupports = []string{"lucio", "mercy", "ana", "moira", "kiriko"}
	fixtureDPS      = []string{"soldier", "tracer", "genji", "ashe", "reaper"}
)

// fixtureHourWeights bias the hour-of-day distribution toward evening
// without making mornings / afternoons impossible. Index = hour (0-23).
// Values are arbitrary scalars; we normalize at sample time.
var fixtureHourWeights = [24]float64{
	0.4, 0.3, 0.2, 0.1, 0.1, 0.1, // 0-5  late-night / very early
	0.2, 0.4, 0.6, 0.8, 1.0, 1.2, // 6-11 morning
	1.5, 1.7, 1.9, 2.1, 2.3, 3.0, // 12-17 afternoon
	5.0, 6.0, 6.5, 6.0, 4.0, 1.5, // 18-23 evening peak
}

// playStyle is the seeded player's hero-pick shape. Picked once per
// GenerateMatchFixture call so a corpus reads as "this one player's
// season" rather than a uniform spray across every hero. Different
// seeds → different styles → different UI shapes (some "all juno",
// some "tank main with occasional flex", some "true flex").
type playStyle int

const (
	styleOneTrick playStyle = iota
	styleOneRole
	styleFlex
)

type playerProfile struct {
	style        playStyle
	mainRole     string
	mainPool     []string
	favoriteHero string   // for one-tricks
	flexHeroes   []string // for flex players: 2-3 mains per role
	offMains     []string // for flex players: heroes outside flexHeroes
}

// parsePlayStyle converts the seed-dev --style flag (and the
// equivalent Makefile STYLE var) into a playStyle. Empty string and
// "flex" both produce the flex player — flex is the default because
// it's the only style whose corpus naturally covers every role +
// most heroes, which is what edge-case eyeballing wants. "random"
// preserves the original per-seed style picker so a multi-seed sweep
// can still hit one-trick and one-role corpuses.
func parsePlayStyle(rng *rand.Rand, s string) playStyle {
	switch s {
	case "", "flex":
		return styleFlex
	case "one-trick":
		return styleOneTrick
	case "one-role":
		return styleOneRole
	case "random":
		switch r := rng.Float64(); {
		case r < 0.2:
			return styleOneTrick
		case r < 0.5:
			return styleOneRole
		default:
			return styleFlex
		}
	default:
		return styleFlex
	}
}

func roleOfHero(hero string) string {
	for _, h := range fixtureTanks {
		if h == hero {
			return "tank"
		}
	}
	for _, h := range fixtureSupports {
		if h == hero {
			return "support"
		}
	}
	return "dps"
}

func newPlayerProfile(rng *rand.Rand, style playStyle) playerProfile {
	roles := []string{"tank", "support", "dps"}
	mainRole := roles[rng.Intn(len(roles))]
	var mainPool []string
	switch mainRole {
	case "tank":
		mainPool = fixtureTanks
	case "support":
		mainPool = fixtureSupports
	default:
		mainPool = fixtureDPS
	}

	p := playerProfile{style: style, mainRole: mainRole, mainPool: mainPool}
	switch style {
	case styleOneTrick:
		p.favoriteHero = mainPool[rng.Intn(len(mainPool))]
	case styleFlex:
		// 2-3 main heroes per role (6-9 total) — flex players carry
		// preferences within each role, not "anybody, anywhere."
		for _, pool := range [][]string{fixtureTanks, fixtureSupports, fixtureDPS} {
			perRole := 2 + rng.Intn(2) // 2 or 3
			perm := rng.Perm(len(pool))
			for i := 0; i < perRole && i < len(pool); i++ {
				p.flexHeroes = append(p.flexHeroes, pool[perm[i]])
			}
		}
		// off-mains = pool heroes the player didn't pick. Drives the
		// 10% experiment path so off-mains get the occasional touch
		// (and the per-seed-coverage pass has something realistic
		// to lean on when an off-main never came up naturally).
		for _, pool := range [][]string{fixtureTanks, fixtureSupports, fixtureDPS} {
			for _, h := range pool {
				if !containsHero(p.flexHeroes, h) {
					p.offMains = append(p.offMains, h)
				}
			}
		}
	case styleOneRole:
		// No extra state — the main-pool seam already drives picks.
	}
	return p
}

// pickHero returns the role + hero for the next match. prevHero (the
// hero from the previous match THIS DAY — reset across day boundaries)
// drives the streak probability so a session of repeated picks like
// lucio-lucio-reaper-lucio can form naturally.
func (p playerProfile) pickHero(rng *rand.Rand, prevHero string) (role, hero string) {
	switch p.style {
	case styleOneTrick:
		if rng.Float64() < 0.95 {
			return p.mainRole, p.favoriteHero
		}
		// 5% experiment with another hero in their main role
		return p.mainRole, p.mainPool[rng.Intn(len(p.mainPool))]

	case styleOneRole:
		// In-role streak: 40% chance of repeating the previous hero
		if prevHero != "" && roleOfHero(prevHero) == p.mainRole && rng.Float64() < 0.4 {
			return p.mainRole, prevHero
		}
		// 85% main role, 15% off-role experiment
		if rng.Float64() < 0.85 {
			return p.mainRole, p.mainPool[rng.Intn(len(p.mainPool))]
		}
		offPools := offRolePools(p.mainRole)
		off := offPools[rng.Intn(len(offPools))]
		h := off[rng.Intn(len(off))]
		return roleOfHero(h), h

	default: // styleFlex
		// 25% streak on previous hero
		if prevHero != "" && containsHero(p.flexHeroes, prevHero) && rng.Float64() < 0.25 {
			return roleOfHero(prevHero), prevHero
		}
		// 10% off-main experiment — keeps off-mains in the corpus
		// without the coverage pass having to do all the work.
		if len(p.offMains) > 0 && rng.Float64() < 0.10 {
			h := p.offMains[rng.Intn(len(p.offMains))]
			return roleOfHero(h), h
		}
		h := p.flexHeroes[rng.Intn(len(p.flexHeroes))]
		return roleOfHero(h), h
	}
}

func offRolePools(mainRole string) [][]string {
	out := make([][]string, 0, 2)
	if mainRole != "tank" {
		out = append(out, fixtureTanks)
	}
	if mainRole != "support" {
		out = append(out, fixtureSupports)
	}
	if mainRole != "dps" {
		out = append(out, fixtureDPS)
	}
	return out
}

func containsHero(pool []string, h string) bool {
	for _, x := range pool {
		if x == h {
			return true
		}
	}
	return false
}

// pickWeightedResult biases the match-result distribution toward what
// a real player's history looks like: ~49.5% wins, ~49.5% losses,
// ~1% draws. Uniform random across {victory, defeat, draw} would
// produce a 33/33/33 split that reads as wrong at any N. Consumes one
// rng.Float64() call — same entropy budget as the previous
// fixtureResults[rng.Intn(...)] form, so swapping in this helper
// doesn't shift downstream RNG state.
func pickWeightedResult(rng *rand.Rand) string {
	switch r := rng.Float64(); {
	case r < 0.495:
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
//   - Dates: random over [fixtureDateStart, fixtureDateEnd] with
//     per-day activity weights — ~40% of days inactive, a long tail
//     of small/medium days, occasional marathon days. Sessions cluster
//     naturally because the sample-per-day count varies.
//   - Time of day: weighted toward evening (18-22h) but with morning,
//     afternoon, and late-night samples (see fixtureHourWeights).
//   - Maps: per-seed shuffled order + exponential decay weights
//     (top-heavy: a handful dominate, the tail tapers off).
//   - Heroes: per playStyle (see above) plus same-day streak bias.
//
// Every match emits one Summary + one Scoreboard. Personal lands on
// ~60% of matches, Rank on ~40% — mirrors what the production parser
// actually persists. All four rows for one match share a single
// MatchKey minted via NewTrackedMatchKey.
//
// The generator is pure data construction — never touches a Store or
// filesystem — so tests can exercise it without setup beyond stdlib.
func GenerateMatchFixture(n int, seed int64, style string) Fixture {
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	rng := rand.New(rand.NewSource(seed))

	rangeStart, _ := time.Parse("2006-01-02", fixtureDateStart)
	rangeEnd, _ := time.Parse("2006-01-02", fixtureDateEnd)
	totalDays := int(rangeEnd.Sub(rangeStart).Hours()/24) + 1

	// Per-day activity weights. ~40% inactive; rest get a long-tail
	// weight with an occasional spike day (marathon session).
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

	// Sample n match timestamps.
	planned := make([]time.Time, n)
	for i := 0; i < n; i++ {
		dayIdx := sampleWeightedIndex(rng, dayWeights, totalDayW)
		day := rangeStart.AddDate(0, 0, dayIdx)
		h := pickWeightedHour(rng)
		m := rng.Intn(60)
		s := rng.Intn(60)
		planned[i] = time.Date(day.Year(), day.Month(), day.Day(), h, m, s, 0, time.UTC)
	}
	sort.Slice(planned, func(i, j int) bool { return planned[i].Before(planned[j]) })
	// Dedupe: bump duplicates so every match_key is unique. Bump
	// resolution is one minute; under the year-to-date range with
	// n in the low hundreds, collisions are vanishingly rare.
	for i := 1; i < len(planned); i++ {
		for !planned[i].After(planned[i-1]) {
			planned[i] = planned[i-1].Add(time.Minute)
		}
	}

	profile := newPlayerProfile(rng, parsePlayStyle(rng, style))

	// Per-seed top-heavy map distribution. Shuffle the pool so
	// different seeds emphasize different maps, then weight by
	// position via exponential decay — the top ~3 maps carry most
	// of the corpus while the tail tapers off. The coverage pass
	// below catches any map the tail missed.
	shuffledMaps := append([]string(nil), fixtureMaps...)
	rng.Shuffle(len(shuffledMaps), func(i, j int) {
		shuffledMaps[i], shuffledMaps[j] = shuffledMaps[j], shuffledMaps[i]
	})
	mapWeights := make([]float64, len(shuffledMaps))
	totalMapW := 0.0
	for i := range mapWeights {
		w := math.Pow(0.75, float64(i))
		mapWeights[i] = w
		totalMapW += w
	}

	fx := Fixture{
		Summaries:   make([]db.SummaryRow, 0, n),
		Scoreboards: make([]db.ScoreboardRow, 0, n),
		Personals:   make([]db.PersonalRow, 0, n*6/10),
		Ranks:       make([]db.RankRow, 0, n*4/10),
	}

	var prevDay, prevHero string
	for _, t := range planned {
		day := t.Format("2006-01-02")
		if day != prevDay {
			prevHero = ""
			prevDay = day
		}
		role, hero := profile.pickHero(rng, prevHero)
		prevHero = hero

		ts := t.Format("2006-01-02T15-04-05")
		finishedAt := t.Format("15:04:05")
		key := NewTrackedMatchKey(ts).String()

		gameMap := shuffledMaps[sampleWeightedIndex(rng, mapWeights, totalMapW)]
		mode := fixtureModes[rng.Intn(len(fixtureModes))]
		result := pickWeightedResult(rng)

		elims := 6 + rng.Intn(20)
		assists := 4 + rng.Intn(12)
		deaths := 2 + rng.Intn(9)
		gameMinutes := 8 + rng.Intn(12)
		gameLength := fmt.Sprintf("%02d:%02d", gameMinutes, rng.Intn(60))

		fx.Summaries = append(fx.Summaries, db.SummaryRow{
			Filename:               "summary-" + ts + ".png",
			MatchKey:               key,
			Map:                    gameMap,
			Mode:                   mode,
			Hero:                   hero,
			Result:                 result,
			FinalScore:             fmt.Sprintf("%d-%d", rng.Intn(5), rng.Intn(5)),
			Date:                   day,
			FinishedAt:             finishedAt,
			GameLength:             gameLength,
			PerfElimTotal:          elims,
			PerfElimAvgPer10Min:    float64(elims) * 10.0 / float64(gameMinutes),
			PerfAssistsTotal:       assists,
			PerfAssistsAvgPer10Min: float64(assists) * 10.0 / float64(gameMinutes),
			PerfDeathsTotal:        deaths,
			PerfDeathsAvgPer10Min:  float64(deaths) * 10.0 / float64(gameMinutes),
			HeroesPlayed: []db.SummaryHeroPlayed{{
				Hero:          hero,
				PercentPlayed: 100,
				PlayTime:      gameLength,
			}},
		})

		damage := 4000 + rng.Intn(12000)
		healing := 0
		mitigation := 0
		switch role {
		case "support":
			healing = 6000 + rng.Intn(8000)
		case "tank":
			mitigation = 5000 + rng.Intn(12000)
		}
		fx.Scoreboards = append(fx.Scoreboards, db.ScoreboardRow{
			Filename:     "scoreboard-" + ts + ".png",
			MatchKey:     key,
			Map:          gameMap,
			Mode:         mode,
			Hero:         hero,
			Eliminations: elims,
			Assists:      assists,
			Deaths:       deaths,
			Damage:       damage,
			Healing:      healing,
			Mitigation:   mitigation,
		})

		if rng.Float64() < 0.6 {
			fx.Personals = append(fx.Personals, db.PersonalRow{
				Filename: "personal-" + ts + ".png",
				MatchKey: key,
				Hero:     hero,
				HeroStats: []db.HeroStat{
					{Hero: hero, StatKey: "eliminations", StatValue: elims},
					{Hero: hero, StatKey: "deaths", StatValue: deaths},
					{Hero: hero, StatKey: "damage", StatValue: damage},
				},
			})
		}

		if rng.Float64() < 0.4 {
			fx.Ranks = append(fx.Ranks, db.RankRow{
				Filename:      "rank-" + ts + ".png",
				MatchKey:      key,
				Rank:          fixtureRanks[rng.Intn(len(fixtureRanks))],
				Level:         1 + rng.Intn(5),
				RankProgress:  rng.Intn(100),
				ChangePercent: rng.Intn(40) - 20,
				Result:        result,
				SR: []db.HeroSR{{
					Hero:   hero,
					SR:     2000 + rng.Intn(2000),
					Change: rng.Intn(40) - 20,
				}},
			})
		}
	}

	// Coverage pass (flex only): ensure every map AND every hero
	// in the pools appears at least once. Edge-case eyeballing
	// against the dossier / leaves / Campaign Log wants to see every
	// icon and label render, but the top-heavy map weights + 6-9
	// flex mains naturally miss a handful per run. We patch by
	// overwriting random matches' Map / Hero in lockstep on Summary
	// + Scoreboard so the read-time fold sees consistent values.
	// Skipped for one-trick / one-role — they can't cover everything
	// by definition.
	if profile.style == styleFlex && len(fx.Summaries) > 0 {
		ensureCoverage(rng, &fx)
	}

	// Reviews: ~1.5% of matches get a review row. ~70% of those are
	// self-reviews (the player's own retrospective), ~30% coach.
	// Uses a derived seed (seed+2) so changing the review rate
	// doesn't shift the main corpus's heroes / maps / dates.
	// #nosec G404 -- deterministic dev fixture, not security-sensitive
	reviewRng := rand.New(rand.NewSource(seed + 2))
	for _, s := range fx.Summaries {
		if reviewRng.Float64() >= 0.015 {
			continue
		}
		reviewedBy := "self"
		if reviewRng.Float64() < 0.3 {
			reviewedBy = "coach"
		}
		fx.Reviews = append(fx.Reviews, ReviewSeed{
			MatchKey:   s.MatchKey,
			ReviewedBy: reviewedBy,
		})
	}

	return fx
}

// ensureCoverage patches the fixture so every map in fixtureMaps
// and every hero across the three role pools appears in at least one
// summary. Called only for flex corpuses (the other styles can't
// satisfy this by definition).
//
// Strategy: scan once for what's present, build a list of missing
// values, then pick random summary indices (without replacement) and
// overwrite their Map / Hero in lockstep on the matching scoreboard.
// We don't touch personal / rank rows — those are role-stats and a
// minor inconsistency on the patched matches reads as "the player
// tried something off-spec" rather than as a bug.
func ensureCoverage(rng *rand.Rand, fx *Fixture) {
	mapsSeen := make(map[string]bool, len(fixtureMaps))
	heroesSeen := make(map[string]bool, len(fixtureTanks)+len(fixtureSupports)+len(fixtureDPS))
	for _, s := range fx.Summaries {
		mapsSeen[s.Map] = true
		heroesSeen[s.Hero] = true
	}

	var missingMaps []string
	for _, m := range fixtureMaps {
		if !mapsSeen[m] {
			missingMaps = append(missingMaps, m)
		}
	}
	var missingHeroes []string
	for _, pool := range [][]string{fixtureTanks, fixtureSupports, fixtureDPS} {
		for _, h := range pool {
			if !heroesSeen[h] {
				missingHeroes = append(missingHeroes, h)
			}
		}
	}
	if len(missingMaps) == 0 && len(missingHeroes) == 0 {
		return
	}

	scoreboardByKey := make(map[string]int, len(fx.Scoreboards))
	for i, sb := range fx.Scoreboards {
		scoreboardByKey[sb.MatchKey] = i
	}

	// One permutation, consumed by map patches first then hero
	// patches, so the two passes don't clobber each other.
	patchOrder := rng.Perm(len(fx.Summaries))
	cursor := 0

	apply := func(rewrite func(s *db.SummaryRow, sb *db.ScoreboardRow)) bool {
		if cursor >= len(patchOrder) {
			return false
		}
		idx := patchOrder[cursor]
		cursor++
		s := &fx.Summaries[idx]
		var sb *db.ScoreboardRow
		if sbIdx, ok := scoreboardByKey[s.MatchKey]; ok {
			sb = &fx.Scoreboards[sbIdx]
		}
		rewrite(s, sb)
		return true
	}

	for _, m := range missingMaps {
		gameMap := m
		if !apply(func(s *db.SummaryRow, sb *db.ScoreboardRow) {
			s.Map = gameMap
			if sb != nil {
				sb.Map = gameMap
			}
		}) {
			break
		}
	}
	for _, h := range missingHeroes {
		hero := h
		if !apply(func(s *db.SummaryRow, sb *db.ScoreboardRow) {
			s.Hero = hero
			if sb != nil {
				sb.Hero = hero
			}
			// Update the primary heroes_played child so the leaves
			// list's "played as" badge matches the new hero.
			if len(s.HeroesPlayed) > 0 {
				s.HeroesPlayed[0].Hero = hero
			}
		}) {
			break
		}
	}
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
