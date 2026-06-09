package db

import (
	"strings"
	"testing"
)

func TestSQLStore_MatchQueue_SetLoadClearRoundTrip(t *testing.T) {
	s := openMemory(t)

	if err := s.SetMatchQueue("match-A", "role"); err != nil {
		t.Fatalf("SetMatchQueue role: %v", err)
	}
	if err := s.SetMatchQueue("match-B", "open"); err != nil {
		t.Fatalf("SetMatchQueue open: %v", err)
	}

	got, err := s.LoadMatchQueues()
	if err != nil {
		t.Fatalf("LoadMatchQueues: %v", err)
	}
	if got["match-A"].QueueType != "role" || got["match-B"].QueueType != "open" {
		t.Errorf("after seed, got %+v", got)
	}
	if got["match-A"].OverriddenAt == "" || got["match-B"].OverriddenAt == "" {
		t.Errorf("overridden_at should be populated, got %+v", got)
	}

	// Idempotent upsert.
	if err := s.SetMatchQueue("match-A", "role"); err != nil {
		t.Fatalf("re-set same value: %v", err)
	}

	// Overwrite to the other queue.
	if err := s.SetMatchQueue("match-A", "open"); err != nil {
		t.Fatalf("overwrite: %v", err)
	}
	got, _ = s.LoadMatchQueues()
	if got["match-A"].QueueType != "open" {
		t.Errorf("after overwrite, match-A = %q, want open", got["match-A"])
	}

	// Clear one; the other survives.
	if err := s.ClearMatchQueue("match-A"); err != nil {
		t.Fatalf("Clear: %v", err)
	}
	got, _ = s.LoadMatchQueues()
	if _, ok := got["match-A"]; ok {
		t.Errorf("match-A should be cleared, got %+v", got)
	}
	if got["match-B"].QueueType != "open" {
		t.Errorf("match-B should survive Clear of match-A, got %+v", got)
	}

	// Clear on absent key — no error.
	if err := s.ClearMatchQueue("never-set"); err != nil {
		t.Fatalf("Clear absent: %v", err)
	}
}

func TestSQLStore_MatchQueue_CheckConstraintRejectsBadValue(t *testing.T) {
	s := openMemory(t)
	err := s.SetMatchQueue("match-A", "ranked") // not in CHECK enum
	if err == nil {
		t.Fatal("expected CHECK constraint violation for invalid queue_type, got nil")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "check") &&
		!strings.Contains(strings.ToLower(err.Error()), "constraint") {
		t.Errorf("error should mention CHECK/constraint, got %v", err)
	}
}
