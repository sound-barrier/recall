package db_test

import (
	"testing"

	"recall/pkg/db"
)

// StaleParseCount answers one question the user asks: "would Re-parse All
// actually improve anything?" A parser fix reaches only files parsed after it
// ships, so without this the improvement landed on new captures while the
// existing history silently kept its old readings.
//
// Every case below is run against BOTH implementations. The Fake is what the
// app-layer tests exercise, so a Fake that counted differently would let a
// green suite hide a wrong number in the shipped app.
func TestStaleParseCount_CountsMatchesNotRows(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			// Three screenshots, ONE match, all stale. The user is told about
			// matches, so this is 1 — reporting 3 would overstate the work by the
			// number of screenshots per match, which varies.
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{
				Filename: "s.png", MatchKey: "k1", ParserGeneration: 1,
			}))
			mustNoErr(t, s.UpsertRank(db.RankRow{
				Filename: "r.png", MatchKey: "k1", ParserGeneration: 1,
			}))
			mustNoErr(t, s.UpsertTeams(db.TeamsRow{
				Filename: "t.png", MatchKey: "k1", ParserGeneration: 1,
			}))

			got, err := s.StaleParseCount(2)
			mustNoErr(t, err)
			if got != 1 {
				t.Errorf("StaleParseCount = %d, want 1 — three screenshots of one match "+
					"are one match to re-parse", got)
			}
		})
	}
}

// An unstamped row predates the column entirely, so it certainly predates the
// current parser. Counting it as fresh would hide exactly the oldest history.
func TestStaleParseCount_TreatsAnUnstampedRowAsStale(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: "old.png", MatchKey: "k1"}))

			got, err := s.StaleParseCount(1)
			mustNoErr(t, err)
			if got != 1 {
				t.Errorf("StaleParseCount = %d, want 1 — a row with no generation cannot "+
					"claim to be current", got)
			}
		})
	}
}

func TestStaleParseCount_IgnoresRowsAtTheCurrentGeneration(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{
				Filename: "fresh.png", MatchKey: "k1", ParserGeneration: 3,
			}))

			got, err := s.StaleParseCount(3)
			mustNoErr(t, err)
			if got != 0 {
				t.Errorf("StaleParseCount = %d, want 0 — nothing to re-parse, so the UI "+
					"must not offer it", got)
			}
		})
	}
}

// A match is only as current as its OLDEST screenshot: re-parsing it would
// re-read the stale one, so it belongs in the count even though a sibling row
// is already current.
func TestStaleParseCount_CountsAMatchWhoseOldestRowIsStale(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{
				Filename: "fresh.png", MatchKey: "k1", ParserGeneration: 2,
			}))
			mustNoErr(t, s.UpsertRank(db.RankRow{
				Filename: "old.png", MatchKey: "k1", ParserGeneration: 1,
			}))

			got, err := s.StaleParseCount(2)
			mustNoErr(t, err)
			if got != 1 {
				t.Errorf("StaleParseCount = %d, want 1 — one of the match's screenshots "+
					"still carries an older reading", got)
			}
		})
	}
}

func TestStaleParseCount_CountsDistinctMatchesAcrossTables(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.UpsertSummary(db.SummaryRow{
				Filename: "a.png", MatchKey: "k1", ParserGeneration: 1,
			}))
			mustNoErr(t, s.UpsertRank(db.RankRow{
				Filename: "b.png", MatchKey: "k2", ParserGeneration: 1,
			}))
			mustNoErr(t, s.UpsertTeams(db.TeamsRow{
				Filename: "c.png", MatchKey: "k3", ParserGeneration: 1,
			}))

			got, err := s.StaleParseCount(2)
			mustNoErr(t, err)
			if got != 3 {
				t.Errorf("StaleParseCount = %d, want 3 distinct matches", got)
			}
		})
	}
}
