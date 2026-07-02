package db_test

import (
	"testing"

	"recall/pkg/db"
)

// A hard-deleted match must vanish from the ambiguity surface too: rows
// where it was a resolution candidate would let the user resolve a pending
// screenshot onto the deleted key, resurrecting its identity.
func TestSQLStore_HardDeleteMatch_RemovesMatchFromCandidateSets(t *testing.T) {
	s := openMemory(t)
	if err := s.UpsertUnknown(db.UnknownRow{Filename: "pending.png", MatchKey: "ambiguous-cGVuZGluZy5wbmc"}); err != nil {
		t.Fatal(err)
	}
	if err := s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
		{MatchKey: "match-20260101120000", DistanceSeconds: 90},
		{MatchKey: "match-20260101124500", DistanceSeconds: 300},
	}); err != nil {
		t.Fatal(err)
	}

	if err := s.HardDeleteMatch("match-20260101120000"); err != nil {
		t.Fatalf("HardDeleteMatch: %v", err)
	}

	cands, err := s.LoadAmbiguousCandidatesFor("pending.png")
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 1 || cands[0].MatchKey != "match-20260101124500" {
		t.Fatalf("candidates after hard delete = %+v, want only match-20260101124500", cands)
	}
}

// Hard-deleting the ambiguous sentinel itself must clear its screenshot's
// candidate set — otherwise the rows are stranded forever (the
// presence-is-the-flag invariant points at nothing once the parent rows die).
func TestSQLStore_HardDeleteMatch_ClearsOwnCandidateSetForSentinelKey(t *testing.T) {
	s := openMemory(t)
	const sentinel = "ambiguous-cGVuZGluZy5wbmc"
	if err := s.UpsertUnknown(db.UnknownRow{Filename: "pending.png", MatchKey: sentinel}); err != nil {
		t.Fatal(err)
	}
	if err := s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
		{MatchKey: "match-20260101120000", DistanceSeconds: 90},
	}); err != nil {
		t.Fatal(err)
	}

	if err := s.HardDeleteMatch(sentinel); err != nil {
		t.Fatalf("HardDeleteMatch: %v", err)
	}

	cands, err := s.LoadAmbiguousCandidatesFor("pending.png")
	if err != nil {
		t.Fatal(err)
	}
	if len(cands) != 0 {
		t.Fatalf("candidates after deleting the sentinel = %+v, want none", cands)
	}
}
