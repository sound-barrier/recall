package matchedit_test

import (
	"errors"
	"testing"

	"recall/pkg/matchedit"
)

func TestSetReview_PersistsValidReviewer(t *testing.T) {
	fake := seeded("m1", "m2")
	mustNoErr(t, matchedit.SetReview(fake, "m1", "self"))
	mustNoErr(t, matchedit.SetReview(fake, "m2", "coach"))
	got, _ := fake.LoadReviews()
	if got["m1"].ReviewedBy != "self" || got["m2"].ReviewedBy != "coach" {
		t.Errorf("reviews map wrong: %+v", got)
	}
}

func TestSetReview_RejectsInvalidReviewer(t *testing.T) {
	fake := seeded("m1")
	for _, c := range []string{"", "user", "other", "SELF", "coach "} {
		if err := matchedit.SetReview(fake, "m1", c); !errors.Is(err, matchedit.ErrInvalidReviewedBy) {
			t.Errorf("SetReview(%q): err = %v, want ErrInvalidReviewedBy", c, err)
		}
	}
}

func TestSetReview_OverwritesExisting(t *testing.T) {
	fake := seeded("m1")
	mustNoErr(t, matchedit.SetReview(fake, "m1", "self"))
	mustNoErr(t, matchedit.SetReview(fake, "m1", "coach"))
	got, _ := fake.LoadReviews()
	if got["m1"].ReviewedBy != "coach" {
		t.Errorf("after overwrite, m1 = %q, want coach", got["m1"].ReviewedBy)
	}
}

func TestClearReview_IsIdempotent(t *testing.T) {
	fake := seeded("m1")
	// Clear on empty state — no error.
	mustNoErr(t, matchedit.ClearReview(fake, "never-reviewed"))
	mustNoErr(t, matchedit.SetReview(fake, "m1", "self"))
	mustNoErr(t, matchedit.ClearReview(fake, "m1"))
	got, _ := fake.LoadReviews()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should be cleared, got %+v", got["m1"])
	}
	// Clear again — still no error.
	mustNoErr(t, matchedit.ClearReview(fake, "m1"))
}

func TestReviewWrites_RequireAMatchKey(t *testing.T) {
	fake := seeded()
	if err := matchedit.SetReview(fake, "", "self"); err == nil {
		t.Error("expected error for empty match_key")
	}
	if err := matchedit.ClearReview(fake, ""); err == nil {
		t.Error("expected error for empty match_key on clear")
	}
}
