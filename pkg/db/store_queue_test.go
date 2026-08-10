package db_test

import (
	"strings"
	"testing"
)

func TestSQLStore_MatchQueue_SetLoadClearRoundTrip(t *testing.T) {
	s := openMemory(t)

	mustNoErr(t, s.SetMatchQueue("match-A", "role"))
	mustNoErr(t, s.SetMatchQueue("match-B", "open"))

	got, err := s.LoadMatchQueues()
	mustNoErr(t, err)
	if got["match-A"].QueueType != "role" || got["match-B"].QueueType != "open" {
		t.Errorf("after seed, got %+v", got)
	}
	if got["match-A"].OverriddenAt == "" || got["match-B"].OverriddenAt == "" {
		t.Errorf("overridden_at should be populated, got %+v", got)
	}

	// Idempotent upsert.
	mustNoErr(t, s.SetMatchQueue("match-A", "role"))

	// Overwrite to the other queue.
	mustNoErr(t, s.SetMatchQueue("match-A", "open"))
	got, _ = s.LoadMatchQueues()
	if got["match-A"].QueueType != "open" {
		t.Errorf("after overwrite, match-A = %q, want open", got["match-A"])
	}

	// Clear one; the other survives.
	mustNoErr(t, s.ClearMatchQueue("match-A"))
	got, _ = s.LoadMatchQueues()
	if _, ok := got["match-A"]; ok {
		t.Errorf("match-A should be cleared, got %+v", got)
	}
	if got["match-B"].QueueType != "open" {
		t.Errorf("match-B should survive Clear of match-A, got %+v", got)
	}

	// Clear on absent key — no error.
	mustNoErr(t, s.ClearMatchQueue("never-set"))
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
