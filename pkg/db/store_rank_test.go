package db_test

import (
	"strings"
	"testing"

	"recall/pkg/db"
)

// The rank_modifiers.modifier CHECK constrains the column to the OW2 modifier
// vocabulary, so a parser bug writing an unknown modifier fails loudly instead
// of persisting silently. Mirrors the queue_type / play_mode enum-CHECK tests.
func TestSQLStore_RankModifiers_CheckConstraintRejectsBadValue(t *testing.T) {
	s := openMemory(t)

	// A known modifier inserts fine.
	if err := s.UpsertRank(db.RankRow{
		Filename: "ok.png", MatchKey: "k1",
		Modifiers: []string{"demotion protection"},
	}); err != nil {
		t.Fatalf("valid modifier should insert: %v", err)
	}

	// An unknown modifier trips the CHECK.
	err := s.UpsertRank(db.RankRow{
		Filename: "bad.png", MatchKey: "k2",
		Modifiers: []string{"unranked yolo"},
	})
	if err == nil {
		t.Fatal("expected CHECK constraint violation for unknown modifier, got nil")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "check") &&
		!strings.Contains(strings.ToLower(err.Error()), "constraint") {
		t.Errorf("error should mention CHECK/constraint, got %v", err)
	}
}
