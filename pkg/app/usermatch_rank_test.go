package app_test

import (
	"errors"
	"slices"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
)

// The manual-entry rank block. The create path echoes these values straight
// back into the MatchResult response, so both the mapping (what lands where)
// and the bounds (what is refused) are response-schema contracts.

func manualWithRank(rank *match.ManualRankInput) match.ManualMatchInput {
	return match.ManualMatchInput{
		Map:      "ilios",
		Result:   "victory",
		PlayedAt: "2026-06-15T14:30:00Z",
		Rank:     rank,
	}
}

func TestCreateManualMatch_AppliesRankOverride(t *testing.T) {
	a := app.NewWithStore(dbtest.New())

	rec, err := a.CreateManualMatch(manualWithRank(&match.ManualRankInput{
		Tier: "platinum", Division: 3, Progress: 40, ChangePercent: -12,
		DemotionProtection: true,
	}))
	mustNoErr(t, err)

	if rec.Data.Rank != "platinum" || rec.Data.Level != 3 {
		t.Errorf("rank/level = %q/%d, want platinum/3", rec.Data.Rank, rec.Data.Level)
	}
	if rec.Data.RankProgress != 40 || rec.Data.ChangePercent != -12 {
		t.Errorf("progress/change = %d/%d, want 40/-12", rec.Data.RankProgress, rec.Data.ChangePercent)
	}
	if !slices.Contains(rec.Data.Modifiers, "demotion protection") {
		t.Errorf("Modifiers = %v, want the demotion-protection marker", rec.Data.Modifiers)
	}
}

// A rank entered without a tier (the user knows they dropped 12% but not which
// tier the game showed) must leave the tier unset rather than writing an empty
// one — an empty tier renders as a blank rank pill instead of "no rank".
func TestCreateManualMatch_OmittedTierStaysUnset(t *testing.T) {
	a := app.NewWithStore(dbtest.New())

	rec, err := a.CreateManualMatch(manualWithRank(&match.ManualRankInput{
		Division: 2, Progress: 55, ChangePercent: 9,
	}))
	mustNoErr(t, err)

	if rec.Data.Rank != "" {
		t.Errorf("Rank = %q, want it left unset when no tier was entered", rec.Data.Rank)
	}
	if rec.Data.RankProgress != 55 || rec.Data.Level != 2 {
		t.Errorf("progress/level = %d/%d, want 55/2 — the rest of the block still applies",
			rec.Data.RankProgress, rec.Data.Level)
	}
	if len(rec.Data.Modifiers) != 0 {
		t.Errorf("Modifiers = %v, want none without demotion protection", rec.Data.Modifiers)
	}
}

// Bounds documented on the MatchResult response: division 0-5, progress 0-100,
// change_percent ±1_000_000. The create path echoes the input verbatim, so an
// unchecked value would emit a schema-violating record.
func TestCreateManualMatch_RankBoundsAreInclusiveAndEnforced(t *testing.T) {
	accepted := []struct {
		name string
		rank match.ManualRankInput
	}{
		{"lower edge", match.ManualRankInput{Division: 0, Progress: 0, ChangePercent: -1_000_000}},
		{"upper edge", match.ManualRankInput{Division: 5, Progress: 100, ChangePercent: 1_000_000}},
	}
	for _, tc := range accepted {
		t.Run("accepts "+tc.name, func(t *testing.T) {
			a := app.NewWithStore(dbtest.New())
			if _, err := a.CreateManualMatch(manualWithRank(&tc.rank)); err != nil {
				t.Errorf("boundary value rejected: %v", err)
			}
		})
	}

	rejected := []struct {
		name string
		rank match.ManualRankInput
	}{
		{"division above 5", match.ManualRankInput{Division: 6}},
		{"negative division", match.ManualRankInput{Division: -1}},
		{"progress above 100", match.ManualRankInput{Progress: 101}},
		{"negative progress", match.ManualRankInput{Progress: -1}},
		{"change above the cap", match.ManualRankInput{ChangePercent: 1_000_001}},
		{"change below the cap", match.ManualRankInput{ChangePercent: -1_000_001}},
	}
	for _, tc := range rejected {
		t.Run("rejects "+tc.name, func(t *testing.T) {
			assertRankRejected(t, tc.rank)
		})
	}
}

// assertRankRejected pins both halves of the rejection contract: the sentinel
// the HTTP layer maps to 400, and that nothing was persisted — validation runs
// before any write, so a refused create must leave no override row behind.
func assertRankRejected(t *testing.T, rank match.ManualRankInput) {
	t.Helper()
	fake := dbtest.New()
	a := app.NewWithStore(fake)
	_, err := a.CreateManualMatch(manualWithRank(&rank))
	if !errors.Is(err, app.ErrInvalidRank) {
		t.Fatalf("err = %v, want ErrInvalidRank", err)
	}
	if len(fake.UserMatchData) != 0 {
		t.Errorf("rejected create still wrote an override row: %v", fake.UserMatchData)
	}
}
