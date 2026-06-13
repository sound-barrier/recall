package db_test

import (
	"strings"
	"testing"
)

func TestSQLStore_Review_SetLoadClearRoundTrip(t *testing.T) {
	s := openMemory(t)

	if err := s.SetReview("match-A", "self"); err != nil {
		t.Fatalf("SetReview self: %v", err)
	}
	if err := s.SetReview("match-B", "coach"); err != nil {
		t.Fatalf("SetReview coach: %v", err)
	}

	got, err := s.LoadReviews()
	if err != nil {
		t.Fatalf("LoadReviews: %v", err)
	}
	if got["match-A"].ReviewedBy != "self" || got["match-B"].ReviewedBy != "coach" {
		t.Errorf("after seed, got %+v", got)
	}
	// reviewed_at is server-stamped via CURRENT_TIMESTAMP — should
	// roundtrip non-empty for every persisted row. The dossier's
	// "days since last review" computation reads this field.
	if got["match-A"].ReviewedAt == "" || got["match-B"].ReviewedAt == "" {
		t.Errorf("reviewed_at should be populated, got %+v", got)
	}

	// Idempotent upsert: same value, no error.
	if err := s.SetReview("match-A", "self"); err != nil {
		t.Fatalf("re-set same value: %v", err)
	}

	// Overwrite to a different reviewer.
	if err := s.SetReview("match-A", "coach"); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	got, _ = s.LoadReviews()
	if got["match-A"].ReviewedBy != "coach" {
		t.Errorf("after overwrite, match-A = %q, want coach", got["match-A"])
	}

	// Clear one; the other survives.
	if err := s.ClearReview("match-A"); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	got, _ = s.LoadReviews()
	if _, ok := got["match-A"]; ok {
		t.Errorf("match-A should be cleared, got %+v", got)
	}
	if got["match-B"].ReviewedBy != "coach" {
		t.Errorf("match-B should survive Clear of match-A, got %+v", got)
	}

	// Clear on absent key — no error.
	if err := s.ClearReview("never-reviewed"); err != nil {
		t.Fatalf("Clear absent: %v", err)
	}
}

func TestSQLStore_Review_CheckConstraintRejectsBadValue(t *testing.T) {
	s := openMemory(t)
	err := s.SetReview("match-A", "user") // not in CHECK enum
	if err == nil {
		t.Fatal("expected CHECK constraint violation for invalid reviewed_by, got nil")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "check") &&
		!strings.Contains(strings.ToLower(err.Error()), "constraint") {
		t.Errorf("error should mention CHECK/constraint, got %v", err)
	}
}

func TestSQLStore_HardDeleteMatch_CascadesReview(t *testing.T) {
	s := openMemory(t)
	if err := s.SetReview("match-A", "self"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := s.HardDeleteMatch("match-A"); err != nil {
		t.Fatalf("HardDeleteMatch: %v", err)
	}
	got, _ := s.LoadReviews()
	if _, ok := got["match-A"]; ok {
		t.Errorf("HardDeleteMatch should cascade match_reviews row; got %+v", got)
	}
}
