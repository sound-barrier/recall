package app

import (
	"reflect"
	"testing"
	"time"

	"recall/pkg/db/dbtest"
)

func TestGenerateMatchFixture_RoundTripsThroughStore(t *testing.T) {
	fx := GenerateMatchFixture(50, 42, "")

	if got := len(fx.Summaries); got != 50 {
		t.Fatalf("Summaries: got %d, want 50", got)
	}
	if got := len(fx.Scoreboards); got != 50 {
		t.Fatalf("Scoreboards: got %d, want 50", got)
	}

	seen := make(map[string]struct{}, len(fx.Summaries))
	for _, s := range fx.Summaries {
		seen[s.MatchKey] = struct{}{}
	}
	if len(seen) != 50 {
		t.Fatalf("expected 50 unique match keys, got %d", len(seen))
	}

	fs := dbtest.New()
	for _, r := range fx.Summaries {
		if err := fs.UpsertSummary(r); err != nil {
			t.Fatalf("UpsertSummary(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Scoreboards {
		if err := fs.UpsertScoreboard(r); err != nil {
			t.Fatalf("UpsertScoreboard(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Personals {
		if err := fs.UpsertPersonal(r); err != nil {
			t.Fatalf("UpsertPersonal(%s): %v", r.MatchKey, err)
		}
	}
	for _, r := range fx.Ranks {
		if err := fs.UpsertRank(r); err != nil {
			t.Fatalf("UpsertRank(%s): %v", r.MatchKey, err)
		}
	}
}

func TestGenerateMatchFixture_IsDeterministic(t *testing.T) {
	a := GenerateMatchFixture(10, 7, "")
	b := GenerateMatchFixture(10, 7, "")

	if !reflect.DeepEqual(a.Summaries[0], b.Summaries[0]) {
		t.Fatalf("Summaries[0] differ between identical seeds:\n a=%+v\n b=%+v", a.Summaries[0], b.Summaries[0])
	}
	if !reflect.DeepEqual(a.Scoreboards[0], b.Scoreboards[0]) {
		t.Fatal("Scoreboards[0] differ between identical seeds")
	}
}

func TestGenerateMatchFixture_DatesWithinRange(t *testing.T) {
	fx := GenerateMatchFixture(200, 1, "")

	start, _ := time.Parse("2006-01-02", fixtureDateStart)
	// Allow a small overflow window past the upper bound — the dedupe
	// pass bumps colliding timestamps by +1 minute, which can spill a
	// match past midnight on the last day. A 3-day buffer is more than
	// enough at our scale.
	end, _ := time.Parse("2006-01-02", fixtureDateEnd)
	end = end.AddDate(0, 0, 3)

	for _, s := range fx.Summaries {
		d, err := time.Parse("2006-01-02", s.Date)
		if err != nil {
			t.Fatalf("bad date %q on match_key %s: %v", s.Date, s.MatchKey, err)
		}
		if d.Before(start) || d.After(end) {
			t.Fatalf("date %s on match_key %s outside [%s, %s]", s.Date, s.MatchKey, fixtureDateStart, fixtureDateEnd)
		}
	}
}

func TestGenerateMatchFixture_DifferentSeedsDiffer(t *testing.T) {
	// Sanity check: two different seeds should produce visibly
	// different first matches (proves the seed actually influences
	// every choice, not just one path).
	a := GenerateMatchFixture(10, 1, "")
	b := GenerateMatchFixture(10, 2, "")
	if reflect.DeepEqual(a.Summaries[0], b.Summaries[0]) {
		t.Fatal("Summaries[0] identical across different seeds — seed isn't doing anything")
	}
}

func TestGenerateMatchFixture_ResultDistribution(t *testing.T) {
	// Realistic player history: ~49.5% W, ~49.5% L, ~1% D. Uniform
	// would produce 33/33/33 — wrong at any N. At N=10000 the law of
	// large numbers tightens the spread enough that we can assert on
	// the bands directly without re-running multiple seeds.
	const n = 10000
	fx := GenerateMatchFixture(n, 1, "")

	counts := map[string]int{}
	for _, s := range fx.Summaries {
		counts[s.Result]++
	}

	w := counts["victory"]
	l := counts["defeat"]
	d := counts["draw"]

	// Each of W and L should land in [47%, 51%]. Draws in [0.5%, 1.5%].
	if w < n*47/100 || w > n*51/100 {
		t.Errorf("victory rate %.2f%% outside [47%%, 51%%]", float64(w)/float64(n)*100)
	}
	if l < n*47/100 || l > n*51/100 {
		t.Errorf("defeat rate %.2f%% outside [47%%, 51%%]", float64(l)/float64(n)*100)
	}
	if d < n*5/1000 || d > n*15/1000 {
		t.Errorf("draw rate %.2f%% outside [0.5%%, 1.5%%]", float64(d)/float64(n)*100)
	}
}

func TestGenerateMatchFixture_FlexCoversEveryMapAndHero(t *testing.T) {
	// Default style (flex) must surface every map in fixtureMaps AND
	// every hero across the three role pools at least once — that's
	// what the coverage pass exists for. Without it, top-heavy map
	// weights + 6-9 flex mains miss a handful of tail values per
	// run, blinding eyeball UI testing to icons / labels for the
	// missing entries.
	const n = 100
	fx := GenerateMatchFixture(n, 1, "")

	seenMaps := map[string]bool{}
	seenHeroes := map[string]bool{}
	for _, s := range fx.Summaries {
		seenMaps[s.Map] = true
		// Scan every hero in HeroesPlayed — primary AND cameos.
		// The coverage pass patches missing heroes as 5% cameos so
		// the primary distribution stays believable.
		for _, hp := range s.HeroesPlayed {
			seenHeroes[hp.Hero] = true
		}
	}
	for _, m := range fixtureMaps {
		if !seenMaps[m] {
			t.Errorf("map %q missing from default-flex corpus", m)
		}
	}
	allHeroes := make([]string, 0, len(fixtureTanks)+len(fixtureSupports)+len(fixtureDPS))
	allHeroes = append(allHeroes, fixtureTanks...)
	allHeroes = append(allHeroes, fixtureSupports...)
	allHeroes = append(allHeroes, fixtureDPS...)
	for _, h := range allHeroes {
		if !seenHeroes[h] {
			t.Errorf("hero %q missing from default-flex corpus", h)
		}
	}
}

func TestGenerateMatchFixture_FlexSwapsMostMatches(t *testing.T) {
	// Real players swap heroes mid-match most games — only ~10% stick
	// with one hero start-to-finish. At N=500 the binomial spread is
	// tight enough to assert single-hero matches fall in [5%, 20%].
	const n = 500
	fx := GenerateMatchFixture(n, 1, "flex")

	single := 0
	for _, s := range fx.Summaries {
		if len(s.HeroesPlayed) == 1 {
			single++
		}
	}
	if single*100 < n*5 || single*100 > n*20 {
		t.Errorf("single-hero matches %d/%d (%.1f%%) outside [5%%, 20%%]",
			single, n, float64(single)*100/float64(n))
	}
}

func TestGenerateMatchFixture_OneTrickNeverSwaps(t *testing.T) {
	// One-tricks by definition never swap mid-match. Every summary's
	// HeroesPlayed must have exactly one entry.
	const n = 200
	fx := GenerateMatchFixture(n, 1, "one-trick")

	for i, s := range fx.Summaries {
		if len(s.HeroesPlayed) != 1 {
			t.Fatalf("one-trick summary %d has %d heroes_played entries; expected 1",
				i, len(s.HeroesPlayed))
		}
	}
}

func TestGenerateMatchFixture_HeroPercentsSumTo100(t *testing.T) {
	// Every match's percent_played must sum to 100 — coverage cameos
	// dock the primary by exactly the cameo amount so the invariant
	// holds even on patched matches. A few percent off is fine
	// (cameo floor + cap interactions); blow up if we land outside
	// [95, 105].
	fx := GenerateMatchFixture(200, 1, "")

	for _, s := range fx.Summaries {
		sum := 0
		for _, hp := range s.HeroesPlayed {
			sum += hp.PercentPlayed
		}
		if sum < 95 || sum > 105 {
			t.Errorf("match %s: percent_played sums to %d, expected ~100", s.MatchKey, sum)
		}
	}
}

func TestGenerateMatchFixture_OneTrickStaysOneTrick(t *testing.T) {
	// Sanity: the coverage pass is flex-only. one-trick corpuses
	// should stay concentrated on the player's favorite hero
	// (95% main, 5% experiments). Catches a regression where the
	// coverage pass would accidentally fire for non-flex styles.
	const n = 200
	fx := GenerateMatchFixture(n, 1, "one-trick")

	heroes := map[string]int{}
	for _, s := range fx.Summaries {
		heroes[s.Hero]++
	}
	var maxCount int
	for _, c := range heroes {
		if c > maxCount {
			maxCount = c
		}
	}
	if maxCount < n*85/100 {
		t.Errorf("expected ≥85%% of matches on the one-trick's main hero; got max %d/%d", maxCount, n)
	}
}

func TestGenerateMatchFixture_MapsAreTopHeavy(t *testing.T) {
	// The map distribution should be visibly top-heavy: the most
	// played map should carry significantly more matches than the
	// median. At N=500 with weight-decay 0.75, the top map's share
	// is ~22% of an even split's ~8% — easily 2x the median.
	const n = 500
	fx := GenerateMatchFixture(n, 1, "")

	counts := map[string]int{}
	for _, s := range fx.Summaries {
		counts[s.Map]++
	}
	values := make([]int, 0, len(counts))
	for _, c := range counts {
		values = append(values, c)
	}
	if len(values) < 2 {
		t.Fatalf("expected multiple maps in corpus; got %d", len(values))
	}
	// Find max + median.
	var maxV int
	for _, v := range values {
		if v > maxV {
			maxV = v
		}
	}
	if maxV*100 < n*15 {
		t.Errorf("top map carries %d/%d (%.1f%%) — expected at least 15%% (top-heavy distribution)",
			maxV, n, float64(maxV)*100/float64(n))
	}
}

func TestGenerateMatchFixture_ReviewRate(t *testing.T) {
	// ~1.5% of matches should carry a review. At N=10000, 4-sigma
	// bounds are roughly [120, 180]; we use [50, 300] as a loose
	// "rate is in the right ballpark" check that catches "0% reviewed"
	// and "everything reviewed" regressions without flaking.
	const n = 10000
	fx := GenerateMatchFixture(n, 1, "")

	if len(fx.Reviews) < 50 || len(fx.Reviews) > 300 {
		t.Errorf("expected ~1.5%% of %d matches reviewed (50-300 range); got %d", n, len(fx.Reviews))
	}

	// Each review should target a real match_key from the corpus.
	keys := make(map[string]bool, len(fx.Summaries))
	for _, s := range fx.Summaries {
		keys[s.MatchKey] = true
	}
	for _, r := range fx.Reviews {
		if !keys[r.MatchKey] {
			t.Fatalf("review references unknown match_key %s", r.MatchKey)
		}
		if r.ReviewedBy != "self" && r.ReviewedBy != "coach" {
			t.Fatalf("review carries invalid ReviewedBy %q (must be self or coach)", r.ReviewedBy)
		}
	}
}
