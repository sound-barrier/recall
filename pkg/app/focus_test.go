package app_test

import (
	"errors"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// The player's list is ONE list assembled from two families, and its order
// is a product decision two surfaces read: the band on 07 and the top-three
// readout a live session says out loud. If they disagree the readout is
// arbitrary, so the order is pinned here rather than in either of them.
//
// A coach outranks the player themselves, and within each source the newest
// comes first — you are working on what you were told most recently, not on
// what you concluded in February.

const (
	itemCoachOld  = "10000000-0000-4000-8000-000000000001"
	itemCoachNew  = "10000000-0000-4000-8000-000000000002"
	itemSelfOld   = "20000000-0000-4000-8000-000000000001"
	itemSelfNew   = "20000000-0000-4000-8000-000000000002"
	itemRetired   = "20000000-0000-4000-8000-000000000003"
	reviewOldDay  = "r-old"
	reviewNewDay  = "r-new"
	oldSittingDay = "2026-02-01T19:00:00Z"
	newSittingDay = "2026-08-19T19:00:00Z"
)

func seedFocusList(t *testing.T, store *dbtest.Fake) {
	t.Helper()
	for _, r := range []db.SelfReview{
		{ReviewID: reviewOldDay, Title: "February", CreatedAt: oldSittingDay, UpdatedAt: oldSittingDay},
		{ReviewID: reviewNewDay, Title: "Last night", CreatedAt: newSittingDay, UpdatedAt: newSittingDay},
	} {
		if _, err := store.CreateSelfReview(r); err != nil {
			t.Fatalf("seed sitting %s: %v", r.ReviewID, err)
		}
	}
	mustNoErr(t, store.SetSelfReviewFocusItems(reviewOldDay, []db.FocusItem{
		{ItemID: itemSelfOld, Text: "february thought"},
	}))
	mustNoErr(t, store.SetSelfReviewFocusItems(reviewNewDay, []db.FocusItem{
		{ItemID: itemSelfNew, Text: "last night's thought"},
		{ItemID: itemRetired, Text: "already got this", Status: db.FocusDone},
	}))
	// A coach item's coach and date are its RETURN's, so each one needs the
	// archive it arrived in — two here, because the two are months apart.
	for _, r := range []struct {
		hash, date, itemID, text string
		status                   db.FocusStatus
	}{
		{"hash-march", "2026-03-01", itemCoachOld, "an older lesson", db.FocusWorking},
		{"hash-august", "2026-08-18", itemCoachNew, "the latest lesson", db.FocusNew},
	} {
		id, err := store.InsertCoachReturn(db.CoachReturn{
			ContentHash: r.hash, CoachName: "Ordo", PlayerHandle: "player",
			SessionDate: r.date, NotesJSON: []byte("{}"),
		})
		mustNoErr(t, err)
		mustNoErr(t, store.UpsertReceivedFocusItem(db.ReceivedFocusItem{
			ItemID: r.itemID, Text: r.text, Status: r.status,
			ReturnID: id,
		}))
	}
}

func TestFocusList_CoachFirstThenYourOwn_EachNewestFirst(t *testing.T) {
	isolateInstall(t)
	a, store := playerApp(t)
	seedFocusList(t, store)

	got, err := a.FocusList()
	mustNoErr(t, err)

	wantIDs := []string{itemCoachNew, itemCoachOld, itemSelfNew, itemRetired, itemSelfOld}
	if len(got) != len(wantIDs) {
		t.Fatalf("list = %d entries, want %d: %+v", len(got), len(wantIDs), got)
	}
	for i, want := range wantIDs {
		if got[i].ItemID != want {
			t.Errorf("entry %d = %q, want %q\nfull order: %+v", i, got[i].ItemID, want, got)
		}
	}
}

func TestFocusList_SaysWhereEachItemCameFrom(t *testing.T) {
	isolateInstall(t)
	a, store := playerApp(t)
	seedFocusList(t, store)

	got, err := a.FocusList()
	mustNoErr(t, err)

	if got[0].Source != "coach" || got[0].CoachName != "Ordo" || got[0].From != "2026-08-18" {
		t.Errorf("coach entry = %+v, want it to name who sent it and when", got[0])
	}
	// The player's own carries no name, and its day is the sitting's.
	own := got[2]
	if own.Source != "self" || own.CoachName != "" {
		t.Errorf("own entry = %+v, want source self and no coach name", own)
	}
	if own.From == "" {
		t.Errorf("own entry = %+v, want the sitting's day", own)
	}
	// Retired items stay in the list — the caller decides what to show.
	if got[3].Status != string(db.FocusDone) {
		t.Errorf("entry 3 = %+v, want the retired item still listed", got[3])
	}
}

func TestFocusList_IsEmptyBeforeAnythingIsWritten(t *testing.T) {
	isolateInstall(t)
	a, _ := playerApp(t)

	got, err := a.FocusList()
	mustNoErr(t, err)
	if len(got) != 0 {
		t.Errorf("list = %+v, want empty", got)
	}
}

func TestSetFocusItemStatus_MovesEitherFamilyAndRefusesTheRest(t *testing.T) {
	isolateInstall(t)
	a, store := playerApp(t)
	seedFocusList(t, store)

	mustNoErr(t, a.SetFocusItemStatus(itemCoachNew, string(db.FocusWorking)))
	mustNoErr(t, a.SetFocusItemStatus(itemSelfNew, string(db.FocusDone)))

	got, err := a.FocusList()
	mustNoErr(t, err)
	byID := map[string]string{}
	for _, e := range got {
		byID[e.ItemID] = e.Status
	}
	if byID[itemCoachNew] != string(db.FocusWorking) || byID[itemSelfNew] != string(db.FocusDone) {
		t.Errorf("statuses = %v, want the coach item accepted and the own item retired", byID)
	}

	if err := a.SetFocusItemStatus("no-such-item", string(db.FocusWorking)); !errors.Is(err, db.ErrFocusItemUnknown) {
		t.Errorf("unknown item = %v, want ErrFocusItemUnknown", err)
	}
	if err := a.SetFocusItemStatus("", string(db.FocusWorking)); !errors.Is(err, db.ErrFocusItemUnknown) {
		t.Errorf("empty id = %v, want ErrFocusItemUnknown", err)
	}
	if err := a.SetFocusItemStatus(itemCoachNew, "denied"); !errors.Is(err, db.ErrFocusItemStatusInvalid) {
		t.Errorf(`status "denied" = %v, want ErrFocusItemStatusInvalid — there is no deny`, err)
	}
}
