package app

import (
	"fmt"
	"math/rand"
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

// fixtureAnchor is the most-recent match timestamp the generator emits.
// Successive matches walk backward at fixtureStride per match, so
// n=300 covers ~7 days of evening play. Kept as a const + a single
// time.Parse at call time so a future maintainer can grep one place.
const (
	fixtureAnchor = "2026-01-01T20:00:00"
	fixtureStride = 35 * time.Minute
)

// Variation pools. Kept short so the manual-testing corpus reads as a
// believable mix without trying to mirror the real OW roster. Names
// match the lower-case conventions used by parse.go and the e2e stub
// at frontend/tests/e2e/matches-set-workspace.spec.ts so the read
// path treats fixtures identically to real parses.
var (
	fixtureMaps = []string{
		"lijiang tower", "rialto", "kings row", "hanamura",
		"dorado", "ilios", "oasis", "numbani",
		"route 66", "blizzard world", "junkertown", "havana",
	}

	fixtureModes = []string{
		"control", "escort", "hybrid", "push", "flashpoint", "clash",
	}

	fixtureResults = []string{"victory", "defeat", "draw"}

	fixtureRanks = []string{"bronze", "silver", "gold", "platinum", "diamond"}

	// Subset of the OW hero roster, grouped by role. Short on purpose;
	// the dossier widgets and Campaign Log read meaningfully from even
	// a 5-per-role pool.
	fixtureTanks    = []string{"reinhardt", "winston", "dva", "orisa", "sigma"}
	fixtureSupports = []string{"lucio", "mercy", "ana", "moira", "kiriko"}
	fixtureDPS      = []string{"soldier", "tracer", "genji", "ashe", "reaper"}
)

// fixtureRole picks a role round-robin so the corpus is balanced across
// tank/support/dps without depending on the RNG to land on each.
func fixtureRole(i int) (role, hero string, pool []string) {
	switch i % 3 {
	case 0:
		return "tank", "", fixtureTanks
	case 1:
		return "support", "", fixtureSupports
	default:
		return "dps", "", fixtureDPS
	}
}

// GenerateMatchFixture builds n synthetic matches and returns them
// as four slices (one per parent screenshot table). Every choice is
// driven by a single rand.Source seeded by `seed`, so calling with
// the same (n, seed) twice produces byte-identical output.
//
// Every match emits a Summary + a Scoreboard. Personal and Rank are
// emitted probabilistically (~60% and ~40%) so the read-path fold
// handles the mixed-coverage shape the production pipeline actually
// sees. All four rows for one match share a single MatchKey, minted
// via NewTrackedMatchKey from the match's timestamp.
//
// The generator is pure data construction — it never touches a Store
// or filesystem — so tests can exercise it without setup beyond the
// stdlib.
func GenerateMatchFixture(n int, seed int64) Fixture {
	// #nosec G404 -- deterministic test/dev fixture, not security-sensitive
	rng := rand.New(rand.NewSource(seed))
	anchor, _ := time.Parse("2006-01-02T15:04:05", fixtureAnchor)

	fx := Fixture{
		Summaries:   make([]db.SummaryRow, 0, n),
		Scoreboards: make([]db.ScoreboardRow, 0, n),
		Personals:   make([]db.PersonalRow, 0, n*6/10),
		Ranks:       make([]db.RankRow, 0, n*4/10),
	}

	for i := 0; i < n; i++ {
		t := anchor.Add(-time.Duration(i) * fixtureStride)
		ts := t.Format("2006-01-02T15-04-05") // dash form per match-key contract
		date := t.Format("2006-01-02")
		finishedAt := t.Format("15:04:05")
		key := NewTrackedMatchKey(ts).String()

		role, _, pool := fixtureRole(i)
		hero := pool[rng.Intn(len(pool))]
		gameMap := fixtureMaps[rng.Intn(len(fixtureMaps))]
		mode := fixtureModes[rng.Intn(len(fixtureModes))]
		result := fixtureResults[rng.Intn(len(fixtureResults))]

		elims := 6 + rng.Intn(20)
		assists := 4 + rng.Intn(12)
		deaths := 2 + rng.Intn(9)
		gameMinutes := 8 + rng.Intn(12)
		gameLength := fmt.Sprintf("%02d:%02d", gameMinutes, rng.Intn(60))

		// Summary — always emitted.
		fx.Summaries = append(fx.Summaries, db.SummaryRow{
			Filename:   "summary-" + ts + ".png",
			MatchKey:   key,
			Map:        gameMap,
			Mode:       mode,
			Hero:       hero,
			Result:     result,
			FinalScore: fmt.Sprintf("%d-%d", rng.Intn(5), rng.Intn(5)),
			Date:       date,
			FinishedAt: finishedAt,
			GameLength: gameLength,

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

		// Scoreboard — always emitted.
		damage := 4000 + rng.Intn(12000)
		healing := 0
		mitigation := 0
		if role == "support" {
			healing = 6000 + rng.Intn(8000)
		}
		if role == "tank" {
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

		// Personal — ~60% of matches.
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

		// Rank — ~40% of matches.
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
