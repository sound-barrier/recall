package coachreturn_test

import (
	"testing"

	"recall/pkg/coachreturn"
)

// A second notes file that carries the same note: a coach re-exported a
// corrected review, a day later, with different words.
func correctedNotes(t *testing.T, sessionDate, text string) []byte {
	t.Helper()
	f := validNotesFile()
	f.SessionDate = sessionDate
	f.Notes[0].Text = text
	return writeNotes(t, f)
}

// Skipping a note in one return must not reach a block a DIFFERENT return's
// accept wrote. Two returns share a note_id whenever a coach re-exports, and
// the skip used to delete by note_id alone.
func TestDecide_SkipInAnotherReturnKeepsTheBlockItDidNotWrite(t *testing.T) {
	st := seededStore(t)
	first := stageReturn(t, st, returnedNotes(t), "Sable")
	decide(t, st, first.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})
	second := stageReturn(t, st, correctedNotes(t, "2026-08-16", "hold the high ground, again"), "Sable")

	decide(t, st, second.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionSkipped})

	if got := blockWithNoteID(t, st, keyIlios, noteIDOne).Text; got != "hold high ground" {
		t.Errorf("block text = %q, want the first return's accept to survive a skip in the second", got)
	}
}

// Skipping in the return that wrote the block still removes it.
func TestDecide_SkipInTheSameReturnRemovesItsOwnBlock(t *testing.T) {
	st := seededStore(t)
	first := stageReturn(t, st, returnedNotes(t), "Sable")
	second := stageReturn(t, st, correctedNotes(t, "2026-08-16", "newer words"), "Sable")
	decide(t, st, second.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})
	decide(t, st, first.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionSkipped})
	if got := blockWithNoteID(t, st, keyIlios, noteIDOne).Text; got != "newer words" {
		t.Fatalf("block text = %q, want the second return's block untouched by the first's skip", got)
	}

	decide(t, st, second.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionSkipped})

	if ids := noteIDsOf(blocksOn(t, st, keyIlios)); len(ids) != 1 || ids[0] != receivedNoteID {
		t.Errorf("blocks on Ilios = %v, want the skip to remove the block its own return wrote", ids)
	}
}

// Accepting an older return after a newer one must not put the older words
// back over the newer ones.
func TestDecide_AcceptingAnOlderReturnKeepsTheNewerText(t *testing.T) {
	st := seededStore(t)
	newer := stageReturn(t, st, correctedNotes(t, "2026-08-20", "the corrected review"), "Sable")
	older := stageReturn(t, st, returnedNotes(t), "Sable")
	decide(t, st, newer.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})

	got := decide(t, st, older.ID, coachreturn.Verdict{NoteID: noteIDOne, Decision: coachreturn.DecisionAccepted})

	if text := blockWithNoteID(t, st, keyIlios, noteIDOne).Text; text != "the corrected review" {
		t.Errorf("block text = %q, want the newer return's words kept", text)
	}
	if statusesOf(got)[noteIDOne] != coachreturn.StatusAccepted {
		t.Errorf("status = %q, want the older accept still recorded", statusesOf(got)[noteIDOne])
	}
}

// A coach item belongs to the return that first carried it. Re-staging the
// same item in a newer file used to move it there, so discarding the newer
// file deleted an item the player had been working on all along.
func TestStage_ReStagingDoesNotMoveAReceivedItemToTheNewerReturn(t *testing.T) {
	st := seededStore(t)
	first := stageReturn(t, st, returnedNotes(t), "Sable")
	second := stageReturn(t, st, correctedNotes(t, "2026-08-16", "newer words"), "Sable")

	if err := st.DeleteCoachReturn(second.ID); err != nil {
		t.Fatalf("DeleteCoachReturn: %v", err)
	}

	items, err := st.LoadReceivedFocusItems()
	if err != nil {
		t.Fatalf("LoadReceivedFocusItems: %v", err)
	}
	if len(items) != 1 || items[0].ReturnID != first.ID {
		t.Errorf("received items = %+v, want the item still on return %d", items, first.ID)
	}
}
