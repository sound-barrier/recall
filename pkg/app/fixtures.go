package app

import (
	"fmt"
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
	flexHeroes   []string // for flex players
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

func newPlayerProfile(rng *rand.Rand) playerProfile {
	var style playStyle
	switch r := rng.Float64(); {
	case r < 0.2:
		style = styleOneTrick
	case r < 0.5:
		style = styleOneRole
	default:
		style = styleFlex
	}

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
		all := append(append(append([]string(nil), fixtureTanks...), fixtureSupports...), fixtureDPS...)
		perm := rng.Perm(len(all))
		keep := 4 + rng.Intn(3) // 4-6 heroes across all roles
		if keep > len(all) {
			keep = len(all)
		}
		for i := 0; i < keep; i++ {
			p.flexHeroes = append(p.flexHeroes, all[perm[i]])
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
// the same (n, seed) twice produces byte-identical output. Pass
// time.Now().UnixNano() (or `make seed-dev SEED=time`) to get a
// different shuffle each invocation.
//
// Distribution:
//   - Dates: random over [fixtureDateStart, fixtureDateEnd] with
//     per-day activity weights — ~40% of days inactive, a long tail
//     of small/medium days, occasional marathon days. Sessions cluster
//     naturally because the sample-per-day count varies.
//   - Time of day: weighted toward evening (18-22h) but with morning,
//     afternoon, and late-night samples (see fixtureHourWeights).
//   - Heroes: one playStyle picked per seed — one-trick (95% one hero),
//     one-role (mostly main role, occasional flex), or flex (heroes
//     across all roles). Same-day streaks bias toward repeating the
//     previous hero so a session can look like real play.
//
// Every match emits one Summary + one Scoreboard. Personal lands on
// ~60% of matches, Rank on ~40% — mirrors what the production parser
// actually persists. All four rows for one match share a single
// MatchKey minted via NewTrackedMatchKey.
//
// The generator is pure data construction — never touches a Store or
// filesystem — so tests can exercise it without setup beyond stdlib.
func GenerateMatchFixture(n int, seed int64) Fixture {
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

	profile := newPlayerProfile(rng)

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

		gameMap := fixtureMaps[rng.Intn(len(fixtureMaps))]
		mode := fixtureModes[rng.Intn(len(fixtureModes))]
		result := fixtureResults[rng.Intn(len(fixtureResults))]

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

	return fx
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
