package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/match"
)

func TestSetMatchReview_PersistsValidReviewer(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	if err := a.SetMatchReview("m1", "self"); err != nil {
		t.Fatalf("SetMatchReview self: %v", err)
	}
	if err := a.SetMatchReview("m2", "coach"); err != nil {
		t.Fatalf("SetMatchReview coach: %v", err)
	}
	got, _ := fs.LoadReviews()
	if got["m1"].ReviewedBy != "self" || got["m2"].ReviewedBy != "coach" {
		t.Errorf("reviews map wrong: %+v", got)
	}
}

func TestSetMatchReview_RejectsInvalidReviewer(t *testing.T) {
	a := app.NewWithStore(&fakeStore{})
	cases := []string{"", "user", "other", "SELF", "coach "}
	for _, c := range cases {
		err := a.SetMatchReview("m1", c)
		if !errors.Is(err, app.ErrInvalidReviewedBy) {
			t.Errorf("SetMatchReview(%q): err = %v, want ErrInvalidReviewedBy", c, err)
		}
	}
}

func TestSetMatchReview_OverwritesExisting(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	if err := a.SetMatchReview("m1", "self"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := a.SetMatchReview("m1", "coach"); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	got, _ := fs.LoadReviews()
	if got["m1"].ReviewedBy != "coach" {
		t.Errorf("after overwrite, m1 = %q, want coach", got["m1"].ReviewedBy)
	}
}

func TestClearMatchReview_IsIdempotent(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	// Clear on empty state — no error.
	if err := a.ClearMatchReview("never-reviewed"); err != nil {
		t.Fatalf("clear on empty: %v", err)
	}
	// Set then clear.
	_ = a.SetMatchReview("m1", "self")
	if err := a.ClearMatchReview("m1"); err != nil {
		t.Fatalf("clear: %v", err)
	}
	got, _ := fs.LoadReviews()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should be cleared, got %q", got["m1"])
	}
	// Clear again — still no error.
	if err := a.ClearMatchReview("m1"); err != nil {
		t.Fatalf("clear twice: %v", err)
	}
}

func TestSetMatchReview_RequiresMatchKey(t *testing.T) {
	a := app.NewWithStore(&fakeStore{})
	if err := a.SetMatchReview("", "self"); err == nil {
		t.Error("expected error for empty match_key")
	}
	if err := a.ClearMatchReview(""); err == nil {
		t.Error("expected error for empty match_key on clear")
	}
}

func TestAttachReviews_PopulatesReviewedByAndAt(t *testing.T) {
	reviews := map[string]db.ReviewState{
		"k1": {ReviewedBy: "self", ReviewedAt: "2026-06-01T10:00:00Z"},
		"k3": {ReviewedBy: "coach", ReviewedAt: "2026-05-30T08:15:00Z"},
	}
	recs := []match.MatchRecord{
		{MatchKey: "k1"},
		{MatchKey: "k2"},
		{MatchKey: "k3"},
	}
	app.AttachReviews(recs, reviews)
	if recs[0].ReviewedBy != "self" || recs[0].ReviewedAt != "2026-06-01T10:00:00Z" {
		t.Errorf("k1: %+v", recs[0])
	}
	if recs[1].ReviewedBy != "" || recs[1].ReviewedAt != "" {
		t.Errorf("k2 should stay unreviewed, got %+v", recs[1])
	}
	if recs[2].ReviewedBy != "coach" || recs[2].ReviewedAt != "2026-05-30T08:15:00Z" {
		t.Errorf("k3: %+v", recs[2])
	}
}

func TestAggregateAll_AttachesReviews(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	// Seed one summary row + a review tag.
	if err := fs.SetReview("m1", "coach"); err != nil {
		t.Fatalf("seed review: %v", err)
	}
	// Need at least one screenshot row carrying the same key so
	// the aggregator emits a record.
	fs.Summaries = append(fs.Summaries, db.SummaryRow{
		ID: 1, Filename: "s.png", MatchKey: "m1",
		Map: "rialto", Result: "victory",
	})

	recs, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("len(recs) = %d, want 1", len(recs))
	}
	if recs[0].ReviewedBy != "coach" {
		t.Errorf("recs[0].ReviewedBy = %q, want coach", recs[0].ReviewedBy)
	}
}

func TestHardDeleteMatch_CascadesReview(t *testing.T) {
	fs := &fakeStore{}
	a := app.NewWithStore(fs)
	_ = a.SetMatchReview("m1", "self")
	if err := a.HardDeleteMatch("m1"); err != nil {
		t.Fatalf("HardDeleteMatch: %v", err)
	}
	got, _ := fs.LoadReviews()
	if _, ok := got["m1"]; ok {
		t.Errorf("review row should be cascaded; got %+v", got)
	}
}
