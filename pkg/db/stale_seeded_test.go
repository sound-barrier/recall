package db_test

import (
	"testing"

	"recall/pkg/db"
	"recall/pkg/fixtures"
	"recall/pkg/parser"
)

// The banner the tour showed, at the layer that computes it.
//
// StaleParseCount is what feeds "N matches were read by an older parser — a
// re-parse would correct them". Run it over the sample corpus the tour seeds
// and the honest answer is zero: nothing read those matches, and there is no
// screenshot behind them for Re-parse All to read again.
//
// Against both store implementations, because the Fake answers this query too
// and a divergence here would mean the app-level tests measure a different
// staleness from the one users see.
func TestStaleParseCount_IgnoresASeededCorpus(t *testing.T) {
	fx := fixtures.GenerateMatchFixture(80, 3, "")

	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			seedRows(t, s, fx)

			n, err := s.StaleParseCount(parser.Generation)
			if err != nil {
				t.Fatalf("StaleParseCount: %v", err)
			}
			if n != 0 {
				t.Errorf("a freshly seeded corpus reports %d matches as read by an "+
					"older parser, want 0", n)
			}
		})
	}
}

func seedRows(t *testing.T, s db.Store, fx fixtures.Fixture) {
	t.Helper()
	for _, r := range fx.Summaries {
		if err := s.UpsertSummary(r); err != nil {
			t.Fatalf("UpsertSummary: %v", err)
		}
	}
	for _, r := range fx.Teams {
		if err := s.UpsertTeams(r); err != nil {
			t.Fatalf("UpsertTeams: %v", err)
		}
	}
	for _, r := range fx.Ranks {
		if err := s.UpsertRank(r); err != nil {
			t.Fatalf("UpsertRank: %v", err)
		}
	}
}
