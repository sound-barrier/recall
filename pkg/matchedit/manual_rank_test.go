package matchedit_test

import (
	"errors"
	"slices"
	"testing"

	"recall/pkg/match"
	"recall/pkg/matchedit"
)

// The manual-entry rank block. The create path echoes these values straight
// back into the MatchResult response, so both the mapping (what lands where)
// and the bounds (what is refused) are response-schema contracts.

func manualWithRank(rank *match.ManualRankInput) match.ManualMatchInput {
	in := manualInput("ilios", "victory")
	in.Rank = rank
	return in
}

func TestCreateManual_AppliesTheRankOverride(t *testing.T) {
	fake := seeded()
	key, err := matchedit.CreateManual(fake, manualWithRank(&match.ManualRankInput{
		Tier: "platinum", Division: 3, Progress: 40, ChangePercent: -12,
		DemotionProtection: true,
	}))
	mustNoErr(t, err)

	row := fake.UserMatchData[key]
	if row.Rank == nil || *row.Rank != "platinum" || row.Level == nil || *row.Level != 3 {
		t.Errorf("rank/level = %v/%v, want platinum/3", row.Rank, row.Level)
	}
	if row.RankProgress == nil || *row.RankProgress != 40 {
		t.Errorf("RankProgress = %v, want 40", row.RankProgress)
	}
	if row.ChangePercent == nil || *row.ChangePercent != -12 {
		t.Errorf("ChangePercent = %v, want -12", row.ChangePercent)
	}
	if !slices.Contains(row.Modifiers, "demotion protection") {
		t.Errorf("Modifiers = %v, want the demotion-protection marker", row.Modifiers)
	}
}

// A rank entered without a tier (the user knows they dropped 12% but not which
// tier the game showed) must leave the tier unset rather than writing an empty
// one — an empty tier renders as a blank rank pill instead of "no rank".
func TestCreateManual_OmittedTierStaysUnset(t *testing.T) {
	fake := seeded()
	key, err := matchedit.CreateManual(fake, manualWithRank(&match.ManualRankInput{
		Division: 2, Progress: 55, ChangePercent: 9,
	}))
	mustNoErr(t, err)

	row := fake.UserMatchData[key]
	if row.Rank != nil {
		t.Errorf("Rank = %v, want it left unset when no tier was entered", row.Rank)
	}
	if row.RankProgress == nil || *row.RankProgress != 55 || row.Level == nil || *row.Level != 2 {
		t.Errorf("progress/level = %v/%v, want 55/2 — the rest of the block still applies",
			row.RankProgress, row.Level)
	}
	if len(row.Modifiers) != 0 {
		t.Errorf("Modifiers = %v, want none without demotion protection", row.Modifiers)
	}
}

// An omitted rank block writes no rank columns at all — a manual match without
// a rank must not claim level 0 at 0%.
func TestCreateManual_OmittedRankBlockWritesNothing(t *testing.T) {
	fake := seeded()
	key, err := matchedit.CreateManual(fake, manualInput("ilios", "victory"))
	mustNoErr(t, err)

	row := fake.UserMatchData[key]
	if row.Rank != nil || row.Level != nil || row.RankProgress != nil || row.ChangePercent != nil {
		t.Errorf("rank columns = %v/%v/%v/%v, want all nil",
			row.Rank, row.Level, row.RankProgress, row.ChangePercent)
	}
}

// Bounds documented on the MatchResult response: division 0-5, progress 0-100,
// change_percent ±1_000_000. The create path echoes the input verbatim, so an
// unchecked value would emit a schema-violating record.
func TestCreateManual_RankBoundsAreInclusiveAndEnforced(t *testing.T) {
	accepted := []struct {
		name string
		rank match.ManualRankInput
	}{
		{"lower edge", match.ManualRankInput{Division: 0, Progress: 0, ChangePercent: -1_000_000}},
		{"upper edge", match.ManualRankInput{Division: 5, Progress: 100, ChangePercent: 1_000_000}},
	}
	for _, tc := range accepted {
		t.Run("accepts "+tc.name, func(t *testing.T) {
			if _, err := matchedit.CreateManual(seeded(), manualWithRank(&tc.rank)); err != nil {
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
			assertRankRejected(t, tc.rank, matchedit.ErrInvalidRank)
		})
	}
}

// The tier is matched against the same ladder the parser and the charts use.
// The bug this guard exists for: the form used to submit the DISPLAY case. It
// is spec-valid free text, so nothing rejected it, and the match silently fell
// off every rank chart because the ladder is keyed on the lowercase form.
func TestCreateManual_RejectsATierOffTheLadder(t *testing.T) {
	for _, bad := range []string{"notatier", "Platinum", "PLATINUM"} {
		t.Run(bad, func(t *testing.T) {
			assertRankRejected(t, match.ManualRankInput{Tier: bad, Division: 3, Progress: 50},
				matchedit.ErrUnknownRank)
		})
	}
}

// assertRankRejected pins both halves of the rejection contract: the sentinel
// the HTTP layer maps to a 4xx, and that nothing was persisted — validation
// runs before any write, so a refused create must leave no override row behind.
func assertRankRejected(t *testing.T, rank match.ManualRankInput, want error) {
	t.Helper()
	fake := seeded()
	if _, err := matchedit.CreateManual(fake, manualWithRank(&rank)); !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
	if len(fake.UserMatchData) != 0 {
		t.Errorf("rejected create still wrote an override row: %v", fake.UserMatchData)
	}
}
