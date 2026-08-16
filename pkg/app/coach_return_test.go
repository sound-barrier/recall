package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/bundle"
	"recall/pkg/coach"
	"recall/pkg/db"
)

// The player's side: the same Import… affordance takes either archive, and
// a coach's notes stage for per-note decisions instead of merging.

// stagedReturn imports a coach's notes into a player's App and returns the
// sheet, the App, and their store.
func stagedReturn(t *testing.T) (*app.App, *db.CoachReturn, coach.ReturnSheet) {
	t.Helper()
	payload := notesArchive(t)
	a, store := playerApp(t)
	outcome, err := a.ImportMatches(payload)
	mustNoErr(t, err)
	if outcome.Kind != app.ImportKindCoachNotes || outcome.Return == nil {
		t.Fatalf("import outcome = %+v, want a staged coach_notes return", outcome)
	}
	if len(store.CoachReturns) != 1 {
		t.Fatalf("staged returns = %d, want 1", len(store.CoachReturns))
	}
	return a, &store.CoachReturns[0], *outcome.Return
}

func TestImportMatches_StagesACoachNotesArchive(t *testing.T) {
	_, _, sheet := stagedReturn(t)
	if sheet.CoachName != coachName || sheet.PlayerHandle != playerHandle {
		t.Errorf("sheet attribution = %q / %q, want %q / %q",
			sheet.CoachName, sheet.PlayerHandle, coachName, playerHandle)
	}
	if len(sheet.Notes) != 1 || sheet.Pending != 1 {
		t.Fatalf("sheet notes = %+v (pending %d), want one pending note", sheet.Notes, sheet.Pending)
	}
	if sheet.Notes[0].Status != coach.StatusPending {
		t.Errorf("note status = %q, want %q", sheet.Notes[0].Status, coach.StatusPending)
	}
}

func TestImportMatches_MergesAPlainBundle(t *testing.T) {
	isolateInstall(t)
	payload := plainBundle(t)
	a, _ := coachApp(t)
	outcome, err := a.ImportMatches(payload)
	mustNoErr(t, err)
	if outcome.Kind != app.ImportKindBundle {
		t.Fatalf("outcome kind = %q, want %q", outcome.Kind, app.ImportKindBundle)
	}
	if outcome.Imported != 3 || outcome.Return != nil {
		t.Errorf("outcome = %+v, want 3 imported and no return sheet", outcome)
	}
}

// A bundle a player shared FOR coaching must never merge into the coach's
// own history — a mis-clicked Import says so instead.
func TestImportMatches_RefusesAShareBundle(t *testing.T) {
	isolateInstall(t)
	payload := shareBundle(t)
	a, _ := coachApp(t)
	if _, err := a.ImportMatches(payload); !errors.Is(err, bundle.ErrCoachBundle) {
		t.Errorf("ImportMatches(share bundle) = %v, want bundle.ErrCoachBundle", err)
	}
}

// Accept writes the coach's block onto the match and marks it reviewed by
// coach; skip removes a block an earlier accept wrote.
func TestDecideCoachReturn_AcceptThenSkip(t *testing.T) {
	a, staged, sheet := stagedReturn(t)
	noteID := sheet.Notes[0].NoteID

	accepted, err := a.DecideCoachReturn(staged.ID, []coach.Decision{{NoteID: noteID, Decision: coach.DecisionAccepted}})
	mustNoErr(t, err)
	if accepted.Pending != 0 || accepted.Notes[0].Status != coach.StatusAccepted {
		t.Fatalf("after accept: pending %d, status %q", accepted.Pending, accepted.Notes[0].Status)
	}
	blocks, err := app.Store(a).LoadMatchCoachNotes()
	mustNoErr(t, err)
	if len(blocks[playerMatchRialto]) != 1 {
		t.Fatalf("accepted blocks on %s = %+v, want one", playerMatchRialto, blocks[playerMatchRialto])
	}
	reviews, err := app.Store(a).LoadReviews()
	mustNoErr(t, err)
	if reviews[playerMatchRialto].ReviewedBy != "coach" {
		t.Errorf("reviewed_by = %q, want coach", reviews[playerMatchRialto].ReviewedBy)
	}

	skipped, err := a.DecideCoachReturn(staged.ID, []coach.Decision{{NoteID: noteID, Decision: coach.DecisionSkipped}})
	mustNoErr(t, err)
	if skipped.Notes[0].Status != coach.StatusSkipped {
		t.Errorf("after skip: status %q, want %q", skipped.Notes[0].Status, coach.StatusSkipped)
	}
	blocks, err = app.Store(a).LoadMatchCoachNotes()
	mustNoErr(t, err)
	if len(blocks[playerMatchRialto]) != 0 {
		t.Errorf("skip left the block behind: %+v", blocks[playerMatchRialto])
	}
}

// The inbox lists what is staged, and a return can be dismissed whole.
func TestCoachReturns_ListGetAndDelete(t *testing.T) {
	a, staged, _ := stagedReturn(t)
	sheets, err := a.ListCoachReturns()
	mustNoErr(t, err)
	if len(sheets) != 1 || sheets[0].ID != staged.ID {
		t.Fatalf("ListCoachReturns = %+v, want the one staged return", sheets)
	}
	one, err := a.GetCoachReturn(staged.ID)
	mustNoErr(t, err)
	if one.ID != staged.ID {
		t.Errorf("GetCoachReturn id = %d, want %d", one.ID, staged.ID)
	}
	if _, err := a.GetCoachReturn(staged.ID + 999); !errors.Is(err, db.ErrCoachReturnUnknown) {
		t.Errorf("GetCoachReturn(unknown) = %v, want db.ErrCoachReturnUnknown", err)
	}
	mustNoErr(t, a.DeleteCoachReturn(staged.ID))
	sheets, err = a.ListCoachReturns()
	mustNoErr(t, err)
	if len(sheets) != 0 {
		t.Errorf("returns after delete = %+v, want none", sheets)
	}
}

// Removing an accepted block requires the note to actually be on that
// match — the id alone is not enough.
func TestDeleteMatchCoachNote_ChecksTheNoteIsOnThatMatch(t *testing.T) {
	a, staged, sheet := stagedReturn(t)
	if _, err := a.DecideCoachReturn(staged.ID,
		[]coach.Decision{{NoteID: sheet.Notes[0].NoteID, Decision: coach.DecisionAccepted}}); err != nil {
		t.Fatalf("DecideCoachReturn: %v", err)
	}
	blocks, err := app.Store(a).LoadMatchCoachNotes()
	mustNoErr(t, err)
	id := blocks[playerMatchRialto][0].ID

	if err := a.DeleteMatchCoachNote(playerMatchIlios, id); !errors.Is(err, db.ErrMatchCoachNoteUnknown) {
		t.Errorf("delete against the wrong match = %v, want db.ErrMatchCoachNoteUnknown", err)
	}
	mustNoErr(t, a.DeleteMatchCoachNote(playerMatchRialto, id))
	blocks, err = app.Store(a).LoadMatchCoachNotes()
	mustNoErr(t, err)
	if len(blocks[playerMatchRialto]) != 0 {
		t.Errorf("block survived its removal: %+v", blocks[playerMatchRialto])
	}
}
