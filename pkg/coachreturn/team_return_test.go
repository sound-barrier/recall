package coachreturn_test

import (
	"testing"

	"recall/pkg/coachreturn"
	"recall/pkg/db"
)

// A block accepted from a TEAM file says who it was written for. Without
// that, a captain's match carries "— Ordo · 2026-08-15" and nothing that
// distinguishes the team's review from a note about them personally —
// which is the one thing a team review IS.
func TestDecide_AnAcceptedTeamBlockNamesTheTeam(t *testing.T) {
	st := seededStore(t)
	f := validNotesFile()
	f.Player.Handle = "Sound Barrier"
	f.Player.Kind = db.CoachKindTeam
	sheet := stageReturn(t, st, writeNotes(t, f), "Sable")

	verdicts := make([]coachreturn.Verdict, 0, len(sheet.Notes))
	for _, item := range sheet.Notes {
		verdicts = append(verdicts, coachreturn.Verdict{
			NoteID: item.NoteID, Decision: coachreturn.DecisionAccepted,
		})
	}
	decide(t, st, sheet.ID, verdicts...)

	blocks, err := st.LoadMatchCoachNotes()
	if err != nil {
		t.Fatalf("LoadMatchCoachNotes: %v", err)
	}
	found := false
	for _, rows := range blocks {
		for _, row := range rows {
			if row.ForTeam == "Sound Barrier" {
				found = true
			}
		}
	}
	if !found {
		t.Errorf("no accepted block names the team; blocks = %+v", blocks)
	}
}
