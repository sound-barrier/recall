package db_test

import (
	"strings"
	"testing"
)

func TestSQLStore_MatchPlayMode_SetLoadClearRoundTrip(t *testing.T) {
	s := openMemory(t)

	mustNoErr(t, s.SetMatchPlayMode("match-A", "competitive"))
	mustNoErr(t, s.SetMatchPlayMode("match-B", "quickplay"))

	got, err := s.LoadMatchPlayModes()
	mustNoErr(t, err)
	if got["match-A"].PlayMode != "competitive" || got["match-B"].PlayMode != "quickplay" {
		t.Errorf("after seed, got %+v", got)
	}
	if got["match-A"].OverriddenAt == "" || got["match-B"].OverriddenAt == "" {
		t.Errorf("overridden_at should be populated, got %+v", got)
	}

	// Idempotent upsert.
	mustNoErr(t, s.SetMatchPlayMode("match-A", "competitive"))

	// Overwrite to the other mode.
	mustNoErr(t, s.SetMatchPlayMode("match-A", "quickplay"))
	got, _ = s.LoadMatchPlayModes()
	if got["match-A"].PlayMode != "quickplay" {
		t.Errorf("after overwrite, match-A = %q, want quickplay", got["match-A"])
	}

	// Clear one; the other survives.
	mustNoErr(t, s.ClearMatchPlayMode("match-A"))
	got, _ = s.LoadMatchPlayModes()
	if _, ok := got["match-A"]; ok {
		t.Errorf("match-A should be cleared, got %+v", got)
	}
	if got["match-B"].PlayMode != "quickplay" {
		t.Errorf("match-B should survive Clear of match-A, got %+v", got)
	}

	// Clear on absent key — no error.
	mustNoErr(t, s.ClearMatchPlayMode("never-set"))
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
