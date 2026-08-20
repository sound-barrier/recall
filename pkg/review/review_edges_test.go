package review_test

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"recall/pkg/db"
	"recall/pkg/matchedit"
	"recall/pkg/review"
)

// The edges of the sitting: what an edit replaces, the bounds on the
// summary and the set, and a member the registry no longer holds.

// A moment edit under the same id replaces the text — not only its place in
// the reading order — and the read-back agrees with the write's return.
func TestPutMoment_EditReplacesTheText(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA)
	mustPutMoment(t, s, r.ReviewID, "m-1", matchedit.MomentInput{MatchClock: "04:45", Text: "first"})
	edited := mustPutMoment(t, s, r.ReviewID, "m-1", matchedit.MomentInput{MatchClock: "04:45", Text: "first, reworded"})
	if edited.Text != "first, reworded" {
		t.Errorf("edit returned text %q, want the new words", edited.Text)
	}
	moments := mustGet(t, s, r.ReviewID).Notes[keyA].Moments
	if len(moments) != 1 || moments[0].Text != "first, reworded" {
		t.Errorf("moments after edit = %+v, want the one moment reworded", moments)
	}
}

func TestUpdate_RefusesATitlePastTheBound(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA)
	long := strings.Repeat("x", review.MaxTitleRunes+1)
	if _, err := review.Update(s, r.ReviewID, review.UpdateInput{Title: long}); !errors.Is(err, review.ErrTitleInvalid) {
		t.Errorf("title past the bound = %v, want ErrTitleInvalid", err)
	}
	if got := mustGet(t, s, r.ReviewID); got.Title == long {
		t.Error("a refused update wrote the title")
	}
}

func TestCreate_RefusesASetPastTheCeiling(t *testing.T) {
	s := storeWithMatches(t)
	keys := make([]string, 0, review.MaxMatchesPerReview+1)
	for i := range review.MaxMatchesPerReview + 1 {
		k := fmt.Sprintf("match-2026-01-01T00-%02d-%02d", i/60, i%60)
		mustNoErr(t, s.UpsertSummary(db.SummaryRow{Filename: k + ".png", MatchKey: k, Map: "rialto"}))
		keys = append(keys, k)
	}
	if _, err := review.Create(s, review.CreateInput{MatchKeys: keys}); !errors.Is(err, review.ErrTooManyMatches) {
		t.Errorf("%d keys = %v, want ErrTooManyMatches", len(keys), err)
	}
	if list, _ := review.List(s); len(list) != 0 {
		t.Errorf("a refused create left a sitting behind: %d", len(list))
	}
}

// A member whose parent rows are gone (a manual match whose data was reset)
// keeps its membership row but is not in the registry; Finish must skip it
// rather than fail or plant a reviewed flag nothing reads back.
func TestFinish_SkipsAMemberTheRegistryNoLongerHolds(t *testing.T) {
	s := storeWithMatches(t)
	r := mustCreate(t, s, keyA, keyB)
	s.Summaries = slices.DeleteFunc(s.Summaries, func(row db.SummaryRow) bool { return row.MatchKey == keyB })

	done, err := review.Finish(s, r.ReviewID)
	mustNoErr(t, err)
	if done.FinishedAt == "" {
		t.Error("finish left no stamp")
	}
	flags, _ := s.LoadReviews()
	if flags[keyA].ReviewedBy != matchedit.ReviewedBySelf {
		t.Errorf("%s reviewed_by = %q, want self", keyA, flags[keyA].ReviewedBy)
	}
	if _, has := flags[keyB]; has {
		t.Errorf("%s is no longer in the registry and got a flag: %+v", keyB, flags[keyB])
	}
}
