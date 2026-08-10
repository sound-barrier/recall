package db_test

import (
	"strings"
	"testing"

	"recall/pkg/db"
)

// ApplyAmbiguity wipes the filename's candidate rows and re-inserts the new
// set inside one transaction. The rollback is what makes a rejected write
// harmless: the candidate rows ARE the ambiguity flag, so a failure that
// committed the DELETE and lost the INSERT would leave the screenshot wearing
// an "ambiguous-" match_key with no candidates behind it — a match stuck in
// the review queue that no resolve can ever clear.
func TestSQLStore_ApplyAmbiguity_RejectedSetLeavesThePreviousOneIntact(t *testing.T) {
	s := openMemory(t)
	mustNoErr(t, s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
		{MatchKey: "match-2026-01-01T12-00-00", DistanceSeconds: 60},
	}))

	// The same candidate twice collides on the (filename, match_key) PK.
	err := s.ApplyAmbiguity("pending.png", []db.AmbiguousCandidate{
		{MatchKey: "match-2026-01-01T12-30-00", DistanceSeconds: 120},
		{MatchKey: "match-2026-01-01T12-30-00", DistanceSeconds: 240},
	})
	if err == nil {
		t.Fatal("duplicate candidate keys were accepted, want a primary-key violation")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "constraint") {
		t.Errorf("error = %q, want it to name the constraint", err)
	}

	cands, err := s.LoadAmbiguousCandidatesFor("pending.png")
	mustNoErr(t, err)
	if len(cands) != 1 || cands[0].MatchKey != "match-2026-01-01T12-00-00" {
		t.Fatalf("candidates = %+v, want the pre-rejection set — the flag was cleared by a failed write", cands)
	}
}

// Same shape on the demote path, which the end-of-parse duplicate sweep drives:
// a rejected candidate set must also leave the parent rows on their original
// key. Rewriting them onto the sentinel and then failing to record candidates
// would hide a real match behind an unresolvable review entry.
func TestSQLStore_DemoteMatchToAmbiguous_RejectedSetLeavesTheMatchKeyed(t *testing.T) {
	s := openMemory(t)
	const key = "match-2026-01-01T12-00-00"
	mustNoErr(t, s.UpsertUnknown(db.UnknownRow{Filename: "dup.png", MatchKey: key}))

	ok, err := s.DemoteMatchToAmbiguous(key, "ambiguous-ZHVwLnBuZw", "dup.png", []db.AmbiguousCandidate{
		{MatchKey: "match-2026-01-01T11-30-00", DistanceSeconds: 1800},
		{MatchKey: "match-2026-01-01T11-30-00", DistanceSeconds: 3600},
	})
	if ok || err == nil {
		t.Fatalf("demote with duplicate candidates = (%v, %v), want (false, an error)", ok, err)
	}

	snap, err := s.LoadAll()
	mustNoErr(t, err)
	if len(snap.Unknowns) != 1 || snap.Unknowns[0].MatchKey != key {
		t.Errorf("parent rows = %+v, want %q — a failed demote re-keyed the match anyway", snap.Unknowns, key)
	}
	if cands, _ := s.LoadAmbiguousCandidatesFor("dup.png"); len(cands) != 0 {
		t.Errorf("candidates = %+v, want none recorded for a failed demote", cands)
	}
}
