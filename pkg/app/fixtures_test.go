package app

import (
	"reflect"
	"testing"
	"time"

	"recall/pkg/db/dbtest"
)

func TestGenerateMatchFixture_RoundTripsThroughStore(t *testing.T) {
	fx := GenerateMatchFixture(50, 42)

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
	a := GenerateMatchFixture(10, 7)
	b := GenerateMatchFixture(10, 7)

	if !reflect.DeepEqual(a.Summaries[0], b.Summaries[0]) {
		t.Fatalf("Summaries[0] differ between identical seeds:\n a=%+v\n b=%+v", a.Summaries[0], b.Summaries[0])
	}
	if !reflect.DeepEqual(a.Scoreboards[0], b.Scoreboards[0]) {
		t.Fatal("Scoreboards[0] differ between identical seeds")
	}
}

func TestGenerateMatchFixture_DatesWithinRange(t *testing.T) {
	fx := GenerateMatchFixture(200, 1)

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
	a := GenerateMatchFixture(10, 1)
	b := GenerateMatchFixture(10, 2)
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
	fx := GenerateMatchFixture(n, 1)

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

func TestGenerateMatchFixture_ReviewRate(t *testing.T) {
	// ~1.5% of matches should carry a review. At N=10000, 4-sigma
	// bounds are roughly [120, 180]; we use [50, 300] as a loose
	// "rate is in the right ballpark" check that catches "0% reviewed"
	// and "everything reviewed" regressions without flaking.
	const n = 10000
	fx := GenerateMatchFixture(n, 1)

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
