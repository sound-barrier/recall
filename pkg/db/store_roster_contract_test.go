package db_test

import (
	"testing"
	"time"

	"recall/pkg/db"
)

// The saved roster: BattleTag -> the name the player actually calls that
// teammate. Held to the same contract on both implementations, because the
// Fake is what every app- and handler-level roster test runs against.

func TestStoreContract_RosterRoundTripsAndOrders(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.SetRosterMember(db.RosterMember{Tag: "Zed#2100", DisplayName: "Zed", Note: "main tank"}))
			mustNoErr(t, s.SetRosterMember(db.RosterMember{Tag: "Ari#1234", DisplayName: "Ari"}))

			got, err := s.LoadRoster()
			mustNoErr(t, err)
			if len(got) != 2 {
				t.Fatalf("roster = %d rows, want 2", len(got))
			}
			// Ordered by display name so the completion list is stable and
			// alphabetical rather than insertion-ordered.
			if got[0].Tag != "Ari#1234" || got[1].Tag != "Zed#2100" {
				t.Fatalf("roster order = %q, %q", got[0].Tag, got[1].Tag)
			}
			if got[1].DisplayName != "Zed" || got[1].Note != "main tank" {
				t.Fatalf("roster row = %+v", got[1])
			}
			if _, err := time.Parse(time.RFC3339, got[1].AddedAt); err != nil {
				t.Fatalf("AddedAt %q is not RFC3339: %v", got[1].AddedAt, err)
			}
		})
	}
}

func TestStoreContract_RosterMemberIsUpsertedByTag(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.SetRosterMember(db.RosterMember{Tag: "Zed#2100", DisplayName: "Zed"}))
			mustNoErr(t, s.SetRosterMember(db.RosterMember{Tag: "Zed#2100", DisplayName: "Zeddy", Note: "off-tank now"}))

			got, err := s.LoadRoster()
			mustNoErr(t, err)
			if len(got) != 1 {
				t.Fatalf("roster = %d rows, want 1 — the tag is the identity", len(got))
			}
			if got[0].DisplayName != "Zeddy" || got[0].Note != "off-tank now" {
				t.Fatalf("roster row = %+v, want the rename applied", got[0])
			}
		})
	}
}

func TestStoreContract_RosterMemberDeletes(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.SetRosterMember(db.RosterMember{Tag: "Zed#2100", DisplayName: "Zed"}))
			mustNoErr(t, s.DeleteRosterMember("Zed#2100"))
			got, err := s.LoadRoster()
			mustNoErr(t, err)
			if len(got) != 0 {
				t.Fatalf("roster = %d rows after delete, want 0", len(got))
			}
			// Deleting a tag that was never rostered is not an error — the
			// caller's intent ("this teammate is not on my roster") holds
			// either way.
			mustNoErr(t, s.DeleteRosterMember("Nobody#0000"))
		})
	}
}

// Clear() wipes match history. The roster is the player's own list of people,
// not match history — same reasoning that keeps the coach-authored family out
// of Clear — so it must SURVIVE, on both implementations. An omission
// identical in the two of them passes every other test in this package.
func TestStoreContract_RosterSurvivesClear(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			mustNoErr(t, s.SetRosterMember(db.RosterMember{Tag: "Zed#2100", DisplayName: "Zed"}))
			mustNoErr(t, s.Clear())
			got, err := s.LoadRoster()
			mustNoErr(t, err)
			if len(got) != 1 {
				t.Fatalf("roster = %d rows after Clear, want 1 — a roster is not match history", len(got))
			}
		})
	}
}
