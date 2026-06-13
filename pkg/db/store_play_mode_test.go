package db_test

import (
	"strings"
	"testing"
)

func TestSQLStore_MatchPlayMode_SetLoadClearRoundTrip(t *testing.T) {
	s := openMemory(t)

	if err := s.SetMatchPlayMode("match-A", "competitive"); err != nil {
		t.Fatalf("SetMatchPlayMode competitive: %v", err)
	}
	if err := s.SetMatchPlayMode("match-B", "quickplay"); err != nil {
		t.Fatalf("SetMatchPlayMode quickplay: %v", err)
	}

	got, err := s.LoadMatchPlayModes()
	if err != nil {
		t.Fatalf("LoadMatchPlayModes: %v", err)
	}
	if got["match-A"].PlayMode != "competitive" || got["match-B"].PlayMode != "quickplay" {
		t.Errorf("after seed, got %+v", got)
	}
	if got["match-A"].OverriddenAt == "" || got["match-B"].OverriddenAt == "" {
		t.Errorf("overridden_at should be populated, got %+v", got)
	}

	// Idempotent upsert.
	if err := s.SetMatchPlayMode("match-A", "competitive"); err != nil {
		t.Fatalf("re-set same value: %v", err)
	}

	// Overwrite to the other mode.
	if err := s.SetMatchPlayMode("match-A", "quickplay"); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	got, _ = s.LoadMatchPlayModes()
	if got["match-A"].PlayMode != "quickplay" {
		t.Errorf("after overwrite, match-A = %q, want quickplay", got["match-A"])
	}

	// Clear one; the other survives.
	if err := s.ClearMatchPlayMode("match-A"); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	got, _ = s.LoadMatchPlayModes()
	if _, ok := got["match-A"]; ok {
		t.Errorf("match-A should be cleared, got %+v", got)
	}
	if got["match-B"].PlayMode != "quickplay" {
		t.Errorf("match-B should survive Clear of match-A, got %+v", got)
	}

	// Clear on absent key — no error.
	if err := s.ClearMatchPlayMode("never-set"); err != nil {
		t.Fatalf("Clear absent: %v", err)
	}
}

func TestSQLStore_MatchPlayMode_CheckConstraintRejectsBadValue(t *testing.T) {
	s := openMemory(t)
	err := s.SetMatchPlayMode("match-A", "unranked") // not in CHECK enum
	if err == nil {
		t.Fatal("expected CHECK constraint violation for invalid play_mode, got nil")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "check") &&
		!strings.Contains(strings.ToLower(err.Error()), "constraint") {
		t.Errorf("error should mention CHECK/constraint, got %v", err)
	}
}
