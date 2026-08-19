package profiles_test

import (
	"errors"
	"slices"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/profiles"
)

// The self-review sitting's edges under a move: one over keys that stay
// home is not touched, a stale twin on the target is replaced by the copy
// being carried, and a member the source no longer holds does not wedge the
// sitting out of the move.

const (
	sittingKeyA = "match-2026-03-01T12-00-00"
	sittingKeyB = "match-2026-03-02T12-00-00"
	sittingKeyC = "match-2026-03-03T12-00-00"
)

// twoFakes returns a source holding A, B and C and an empty target.
func twoFakes(t *testing.T) (src, target *dbtest.Fake) {
	t.Helper()
	src, target = &dbtest.Fake{}, &dbtest.Fake{}
	for _, k := range []string{sittingKeyA, sittingKeyB, sittingKeyC} {
		mustNoErr(t, src.UpsertSummary(db.SummaryRow{Filename: k + ".png", MatchKey: k, Map: "rialto"}))
	}
	return src, target
}

func seedSittingWithNotes(t *testing.T, s db.Store, reviewID string, keys ...string) {
	t.Helper()
	_, err := s.CreateSelfReview(db.SelfReview{ReviewID: reviewID, MatchKeys: keys, Title: "Sitting " + reviewID})
	mustNoErr(t, err)
	for _, k := range keys {
		_, err = s.UpsertSelfReviewNote(db.SelfReviewNote{ReviewID: reviewID, MatchKey: k, Kind: "note", Text: "on " + k})
		mustNoErr(t, err)
	}
}

func TestMove_LeavesAnUnrelatedSittingHome(t *testing.T) {
	src, target := twoFakes(t)
	seedSittingWithNotes(t, src, "solo", sittingKeyC)

	mustNoErr(t, profiles.Move(src, target, []string{sittingKeyA}))

	stayed, ok, err := src.LoadSelfReview("solo")
	mustNoErr(t, err)
	if !ok || !slices.Equal(stayed.MatchKeys, []string{sittingKeyC}) || stayed.Notes[sittingKeyC].Text != "on "+sittingKeyC {
		t.Errorf("the unrelated sitting on the source = %+v (ok=%v), want it untouched", stayed, ok)
	}
	if _, onTarget, _ := target.LoadSelfReview("solo"); onTarget {
		t.Error("a sitting over a key that stayed home was created on the target")
	}
}

// A twin already on the target under the same id (a bundle imported into
// both profiles, a retry after a failed phase 2) is the stale one; the copy
// being carried replaces it rather than being skipped, or its newer notes
// would vanish with the source in phase 2.
func TestMove_ReplacesAStaleTwinOnTheTarget(t *testing.T) {
	src, target := twoFakes(t)
	seedSittingWithNotes(t, src, "pair", sittingKeyA, sittingKeyB)
	_, err := target.CreateSelfReview(db.SelfReview{ReviewID: "pair", MatchKeys: []string{sittingKeyA}, Title: "stale"})
	mustNoErr(t, err)

	mustNoErr(t, profiles.Move(src, target, []string{sittingKeyA, sittingKeyB}))

	moved, ok, err := target.LoadSelfReview("pair")
	mustNoErr(t, err)
	if !ok || moved.Title != "Sitting pair" || len(moved.Notes) != 2 || moved.Notes[sittingKeyB].Text != "on "+sittingKeyB {
		t.Errorf("sitting on the target = %+v (ok=%v), want the source's copy with both notes", moved, ok)
	}
	if left, _ := src.LoadSelfReviews(); len(left) != 0 {
		t.Errorf("the source kept the moved sitting: %+v", left)
	}
}

// A member whose parent rows are gone from the source (a manual match whose
// data was reset) keeps its membership row but is not live, so it neither
// comes nor stays: moving the live member carries the sitting.
func TestMove_CarriesASittingWhosePhantomMemberIsNotLive(t *testing.T) {
	src, target := twoFakes(t)
	seedSittingWithNotes(t, src, "pair", sittingKeyA, sittingKeyB)
	src.Summaries = slices.DeleteFunc(src.Summaries, func(row db.SummaryRow) bool { return row.MatchKey == sittingKeyB })

	if err := profiles.Move(src, target, []string{sittingKeyA}); err != nil {
		if errors.Is(err, profiles.ErrMoveSplitsSelfReview) {
			t.Fatalf("a phantom member wedged the sitting out of the move: %v", err)
		}
		t.Fatal(err)
	}
	moved, ok, err := target.LoadSelfReview("pair")
	mustNoErr(t, err)
	if !ok || !slices.Contains(moved.MatchKeys, sittingKeyA) || moved.Notes[sittingKeyA].Text != "on "+sittingKeyA {
		t.Errorf("sitting on the target = %+v (ok=%v), want it carried with A's note", moved, ok)
	}
	if left, _ := src.LoadSelfReviews(); len(left) != 0 {
		t.Errorf("the source kept the moved sitting: %+v", left)
	}
}
