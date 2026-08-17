package db_test

import (
	"testing"

	"recall/pkg/db"
)

// rank_percentile is the season-4 "HIGHER RANKED THAN 57% OF PLAYERS" reading.
//
// It is nullable all the way down, and that is the point of these tests rather
// than an implementation detail: a placement screen shows no such caption
// because there is no settled rank to be a percentile of, and every rank
// screenshot captured before season 4 has none either. Storing 0 for those
// would assert the player is ranked above NOBODY — a plausible-looking number
// that is simply false, and one that would drag any average computed over the
// column toward zero. NULL says "this screen did not report it".
func TestUpsertRank_PercentileRoundTrips(t *testing.T) {
	s := openMemory(t)
	pct := 57
	mustNoErr(t, s.UpsertRank(db.RankRow{
		Filename: "settled.png", MatchKey: "k1", Rank: "platinum", Level: 2,
		RankProgress: 67, RankPercentile: &pct,
	}))

	got := loadOneRank(t, s)
	if got.RankPercentile == nil {
		t.Fatal("rank_percentile came back nil, want 57")
	}
	if *got.RankPercentile != 57 {
		t.Errorf("rank_percentile = %d, want 57", *got.RankPercentile)
	}
}

func TestUpsertRank_PercentileStaysNullWhenTheScreenHasNone(t *testing.T) {
	s := openMemory(t)
	mustNoErr(t, s.UpsertRank(db.RankRow{
		Filename: "placement.png", MatchKey: "k1", Rank: "platinum", Level: 4,
	}))

	got := loadOneRank(t, s)
	if got.RankPercentile != nil {
		t.Errorf("rank_percentile = %d, want nil — a placement screen reports no "+
			"percentile, and 0 would claim the player is above nobody", *got.RankPercentile)
	}
}

// A re-parse must be able to CLEAR the value, not just set it. The column is in
// the ON CONFLICT DO UPDATE set, so re-parsing a screenshot whose caption is no
// longer readable has to write NULL back rather than leaving the stale reading
// attached to a row that no longer supports it.
func TestUpsertRank_PercentileClearsOnReParse(t *testing.T) {
	s := openMemory(t)
	pct := 57
	mustNoErr(t, s.UpsertRank(db.RankRow{
		Filename: "r.png", MatchKey: "k1", Rank: "platinum", Level: 2, RankPercentile: &pct,
	}))
	mustNoErr(t, s.UpsertRank(db.RankRow{
		Filename: "r.png", MatchKey: "k1", Rank: "platinum", Level: 2,
	}))

	if got := loadOneRank(t, s); got.RankPercentile != nil {
		t.Errorf("rank_percentile = %d after a re-parse that read none, want nil",
			*got.RankPercentile)
	}
}
