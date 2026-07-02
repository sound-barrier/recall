package db_test

import (
	"testing"

	"recall/pkg/db"
)

// user_match_rank_modifiers must enforce the same modifier vocabulary as its
// OCR twin rank_modifiers — otherwise a typo'd or stale modifier string
// persists silently in the override layer while the identical value would be
// rejected on the parse path.
func TestSQLStore_UserMatchModifiers_RejectsUnknownModifier(t *testing.T) {
	s := openMemory(t)
	if err := s.UpsertUserMatchData(db.UserMatchData{
		MatchKey:  "match-20260101120000",
		Modifiers: []string{"overcharge"}, // not in the rank_modifiers vocabulary
	}); err == nil {
		t.Fatal("UpsertUserMatchData accepted an unknown rank modifier, want CHECK violation")
	}
}

func TestSQLStore_UserMatchModifiers_AcceptsKnownVocabulary(t *testing.T) {
	s := openMemory(t)
	want := []string{"demotion protection", "win streak"}
	if err := s.UpsertUserMatchData(db.UserMatchData{
		MatchKey:  "match-20260101120000",
		Modifiers: want,
	}); err != nil {
		t.Fatalf("UpsertUserMatchData with known modifiers: %v", err)
	}
	all, err := s.LoadAllUserMatchData()
	if err != nil {
		t.Fatal(err)
	}
	got := all["match-20260101120000"].Modifiers
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("Modifiers round-trip = %v, want %v", got, want)
	}
}
