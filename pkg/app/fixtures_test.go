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
