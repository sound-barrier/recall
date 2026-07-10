package fixtures

import (
	"testing"
)

// The tour tuple — MUST mirror pkg/app/profile_app.go (testProfileSeed /
// testProfileMatches, style "flex"). The story tests below pin the SHIPPED
// realization: the seeded sample profile is a curated demo, so the account
// it tells — a slow, streaky, net-positive climb by a DPS main who bleeds
// rank when swapping or playing off-pool — is asserted here, not hoped for.
const (
	tourSeed = int64(8)
	tourN    = 1300
)

// tourStory bundles the per-match facts the assertions below slice.
type tourStory struct {
	fx        Fixture
	queueOf   map[string]string // match_key → role|open
	compRole  []int             // indices of competitive role-queue summaries
	comp      []int             // indices of all competitive summaries
	dpsCards  []ladderPos       // chronological rank cards on the dps track
	dpsFracs  []float64         // season fraction of each dps card's match
	dpsGames  []string          // chronological results of dps role-queue games
	heroGames map[string]int    // per-primary-hero competitive game counts
}

// tourStoryCache memoizes the corpus across the story tests — package tests
// run sequentially, and regenerating 1300 matches per assertion is pure waste
// under -race.
var tourStoryCache *tourStory

func buildTourStory(t *testing.T) tourStory {
	t.Helper()
	if tourStoryCache != nil {
		return *tourStoryCache
	}
	fx := GenerateMatchFixture(tourN, tourSeed, "flex")
	st := tourStory{fx: fx, queueOf: map[string]string{}, heroGames: map[string]int{}}
	for _, q := range fx.Queues {
		st.queueOf[q.MatchKey] = q.QueueType
	}
	playModeOf := map[string]string{}
	for _, pm := range fx.PlayModes {
		playModeOf[pm.MatchKey] = pm.PlayMode
	}
	cardByKey := map[string]ladderPos{}
	for _, r := range fx.Ranks {
		cardByKey[r.MatchKey] = ladderPos{tier: tierIndex(r.Rank), div: r.Level, prog: r.RankProgress}
	}
	total := len(fx.Summaries)
	for i, s := range fx.Summaries {
		if playModeOf[s.MatchKey] != "competitive" {
			continue
		}
		st.comp = append(st.comp, i)
		st.heroGames[s.Hero]++
		if st.queueOf[s.MatchKey] != "role" {
			continue
		}
		st.compRole = append(st.compRole, i)
		if roleOfHero(s.Hero) != "dps" {
			continue
		}
		st.dpsGames = append(st.dpsGames, s.Result)
		if pos, ok := cardByKey[s.MatchKey]; ok {
			st.dpsCards = append(st.dpsCards, pos)
			st.dpsFracs = append(st.dpsFracs, float64(i)/float64(total-1))
		}
	}
	tourStoryCache = &st
	return st
}

func tierIndex(name string) int {
	for i, t := range tierNames {
		if t == name {
			return i
		}
	}
	return -1
}

func winrate(results []string) (pct float64, decisive int) {
	wins := 0
	for _, r := range results {
		switch r {
		case "victory":
			wins++
			decisive++
		case "defeat":
			decisive++
		}
	}
	if decisive == 0 {
		return 0, 0
	}
	return float64(wins) / float64(decisive) * 100, decisive
}

// ── Volume: about 10 hours of games a week ─────────────────────────────

func TestTourStory_WeeklyVolume(t *testing.T) {
	st := buildTourStory(t)
	// 10 h/week self-reported play ≈ 65-75% in-match at ~11 min/game →
	// ~33-42 matches/week over the ~34.8-week season window.
	weeks := 8 * 30.44 / 7
	perWeek := float64(len(st.fx.Summaries)) / weeks
	if perWeek < 33 || perWeek > 42 {
		t.Fatalf("matches per week = %.1f; want ~10h/week ≈ [33, 42]", perWeek)
	}
}

// ── Role split: DPS 85 / tank 10 / support 5 in competitive ────────────

func TestTourStory_CompetitiveRoleSplit(t *testing.T) {
	st := buildTourStory(t)
	counts := map[string]int{}
	for _, i := range st.compRole {
		counts[roleOfHero(st.fx.Summaries[i].Hero)]++
	}
	total := float64(len(st.compRole))
	if total == 0 {
		t.Fatal("no competitive role-queue matches")
	}
	dps := float64(counts["dps"]) / total * 100
	tank := float64(counts["tank"]) / total * 100
	support := float64(counts["support"]) / total * 100
	if dps < 80 || dps > 90 {
		t.Errorf("dps share = %.1f%%; want 85 ± 5", dps)
	}
	if tank < 6 || tank > 14 {
		t.Errorf("tank share = %.1f%%; want 10 ± 4", tank)
	}
	if support < 2 || support > 9 {
		t.Errorf("support share = %.1f%%; want 5 ± 4", support)
	}
}

// ── Hero-count mix and its cost ────────────────────────────────────────

func TestTourStory_MultiHeroShareAndCost(t *testing.T) {
	st := buildTourStory(t)
	var few, many []string // results for 1-2 vs 3+ meaningfully-played heroes
	for _, i := range st.comp {
		s := st.fx.Summaries[i]
		meaningful := 0
		for _, hp := range s.HeroesPlayed {
			if hp.PercentPlayed >= meaningfulHeroPct {
				meaningful++
			}
		}
		if meaningful >= 3 {
			many = append(many, s.Result)
		} else {
			few = append(few, s.Result)
		}
	}
	share := float64(len(many)) / float64(len(st.comp)) * 100
	if share < 10 || share > 20 {
		t.Errorf("3+-hero share of comp = %.1f%%; want [10, 20]", share)
	}
	manyWR, manyN := winrate(many)
	fewWR, _ := winrate(few)
	if manyN < 50 {
		t.Fatalf("only %d decisive 3+-hero games — too thin to mean anything", manyN)
	}
	if manyWR > 40 {
		t.Errorf("3+-hero win rate = %.1f%%; 'usually a loss' wants ≤ 40", manyWR)
	}
	if fewWR-manyWR < 12 {
		t.Errorf("WR(1-2 heroes) %.1f%% − WR(3+) %.1f%% = %.1f; want ≥ 12 pts", fewWR, manyWR, fewWR-manyWR)
	}
}

// ── Off-pool primary heroes bleed rank ─────────────────────────────────

func TestTourStory_OffPoolCost(t *testing.T) {
	st := buildTourStory(t)
	// Pool membership read empirically: mains soak up dozens of games each,
	// off-pool experiments a handful. Only 1-2-hero games are compared so
	// the hero-count penalty can't contaminate the read.
	var pool, off []string
	for _, i := range st.comp {
		s := st.fx.Summaries[i]
		if len(s.HeroesPlayed) >= 3 {
			continue
		}
		if st.heroGames[s.Hero] >= 15 {
			pool = append(pool, s.Result)
		} else if st.heroGames[s.Hero] <= 8 {
			off = append(off, s.Result)
		}
	}
	poolWR, _ := winrate(pool)
	offWR, offN := winrate(off)
	if offN < 25 {
		t.Fatalf("only %d decisive off-pool games — distribution drifted", offN)
	}
	if poolWR-offWR < 4 {
		t.Errorf("WR(pool) %.1f%% − WR(off) %.1f%% = %.1f; want ≥ 4 pts", poolWR, offWR, poolWR-offWR)
	}
}

// ── The climb: slow, streaky, net-positive, mean-reverting ─────────────

func TestTourStory_SlowClimbWithDrawdown(t *testing.T) {
	st := buildTourStory(t)
	if len(st.dpsCards) < 30 {
		t.Fatalf("only %d dps rank cards; the main track should print plenty", len(st.dpsCards))
	}
	first := ladderScore(st.dpsCards[0])
	last := ladderScore(st.dpsCards[len(st.dpsCards)-1])
	net := last - first
	if net < 3 || net > 8 {
		t.Errorf("dps net climb = %.2f divisions; want slow growth in [3, 8]", net)
	}
	// Ends around Platinum 4: at or above Plat 5 (15), at or below Plat 2 (18).
	if last < 15 || last > 18 {
		t.Errorf("dps season end = %.2f (ladderScore); want [15, 18] ≈ Plat 5..Plat 2", last)
	}
	// A real slump: some card sits ≥ 0.6 divisions below the running peak.
	runningMax, maxDrawdown := first, 0.0
	for _, c := range st.dpsCards {
		score := ladderScore(c)
		runningMax = max(runningMax, score)
		maxDrawdown = max(maxDrawdown, runningMax-score)
	}
	if maxDrawdown < 0.6 {
		t.Errorf("max drawdown = %.2f divisions; want ≥ 0.6 (a visible slump)", maxDrawdown)
	}
	// Overall comp WR: a grinder's record, not a smurf's.
	var results []string
	for _, i := range st.comp {
		results = append(results, st.fx.Summaries[i].Result)
	}
	wr, _ := winrate(results)
	if wr < 50.5 || wr > 55 {
		t.Errorf("overall comp win rate = %.1f%%; want [50.5, 55]", wr)
	}
}

func TestTourStory_StreaksExist(t *testing.T) {
	st := buildTourStory(t)
	longestWin, longestLoss, run := 0, 0, 0
	last := ""
	for _, r := range st.dpsGames {
		if r != "victory" && r != "defeat" {
			continue
		}
		if r == last {
			run++
		} else {
			run = 1
			last = r
		}
		if r == "victory" {
			longestWin = max(longestWin, run)
		} else {
			longestLoss = max(longestLoss, run)
		}
	}
	if longestWin < 5 {
		t.Errorf("longest dps win streak = %d; want ≥ 5", longestWin)
	}
	if longestLoss < 4 {
		t.Errorf("longest dps loss streak = %d; want ≥ 4", longestLoss)
	}
}

// ── Breaks, rust, and tilt queues ──────────────────────────────────────

func TestTourStory_BreaksAndRustyReturns(t *testing.T) {
	st := buildTourStory(t)
	// Replay the model's own player state over the competitive sequence so
	// the measurement flags EXACTLY the games the model played rusty.
	ps := &playerState{}
	gaps := 0
	var rusty, rest []string
	for _, i := range st.comp {
		s := st.fx.Summaries[i]
		if ps.lastDay != "" && s.Date != ps.lastDay && daysBetween(ps.lastDay, s.Date) >= rustGapDays {
			gaps++
		}
		pen := ps.observe(s.Date)
		// Strong-rust games only (first half of the fade), tilt excluded so
		// the read isn't contaminated.
		if ps.dayLossRun < tiltRunStart && pen > rustMaxPts/2 {
			rusty = append(rusty, s.Result)
		} else if pen == 0 {
			rest = append(rest, s.Result)
		}
		ps.record(s.Result)
	}
	if gaps < 1 {
		t.Fatalf("season has no %d+ day break — vacations should be carved into the calendar", rustGapDays)
	}
	rustyWR, rustyN := winrate(rusty)
	restWR, _ := winrate(rest)
	if rustyN < 8 {
		t.Fatalf("only %d decisive strong-rust games measured — break carving drifted", rustyN)
	}
	if restWR-rustyWR < 3 {
		t.Errorf("WR in the first games back = %.1f%% vs %.1f%% otherwise; rust should cost ≥ 3 pts", rustyWR, restWR)
	}
}

func TestTourStory_TiltRunsExist(t *testing.T) {
	st := buildTourStory(t)
	// 5+ consecutive same-day competitive losses — the tilt-queue pattern
	// the app flags — must actually occur in the demo season.
	episodes, run := 0, 0
	day := ""
	counted := false
	for _, i := range st.comp {
		s := st.fx.Summaries[i]
		if s.Date != day {
			day = s.Date
			run = 0
			counted = false
		}
		switch s.Result {
		case "defeat":
			run++
			if run >= 5 && !counted {
				episodes++
				counted = true
			}
		case "victory":
			run = 0
			counted = false
		}
	}
	if episodes < 2 {
		t.Errorf("only %d same-day 5+ loss runs; the tilt-queue flag needs material (want ≥ 2)", episodes)
	}
}

func TestTourStory_MeanRevertsAroundSkillLine(t *testing.T) {
	st := buildTourStory(t)
	// Local maxima fall back, local minima recover: the position must cross
	// its true-skill line repeatedly and overshoot in BOTH directions.
	crossings, lastSign := 0, 0
	maxAbove, maxBelow := 0.0, 0.0
	for i, c := range st.dpsCards {
		gap := ladderScore(c) - trueSkillAt("dps", st.dpsFracs[i])
		maxAbove = max(maxAbove, gap)
		maxBelow = max(maxBelow, -gap)
		sign := 0
		if gap > 0 {
			sign = 1
		} else if gap < 0 {
			sign = -1
		}
		if sign != 0 && lastSign != 0 && sign != lastSign {
			crossings++
		}
		if sign != 0 {
			lastSign = sign
		}
	}
	if crossings < 3 {
		t.Errorf("position crossed the skill line %d times; want ≥ 3 (local minima AND maxima)", crossings)
	}
	if maxAbove < 0.5 {
		t.Errorf("max overshoot above the line = %.2f divisions; want ≥ 0.5 (peaks that fall back)", maxAbove)
	}
	if maxBelow < 0.5 {
		t.Errorf("max dip below the line = %.2f divisions; want ≥ 0.5 (dips that recover)", maxBelow)
	}
}
