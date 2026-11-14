package db_test

import (
	"testing"

	"recall/pkg/db"
)

// Discarding a staged return unlands what IT put on the player's list, and
// only that. It is the ONLY way a coach's item ever leaves — there is no
// per-item deny — so an archive imported by mistake would otherwise be
// permanent, and one taking a sibling's items with it is unrecoverable.
//
// Two archives from one coach on one day — a morning file and a corrected
// afternoon one — are two returns: coach_returns is keyed on content_hash
// precisely because (coach_name, session_date) is not unique. Discarding one
// of them must leave the other's items, and the player's progress on them,
// exactly where they were. There is no per-item deny, so a wrongly-dropped
// item cannot be put back except by re-importing it as `new`.
func TestStoreContract_DiscardingOneReturnKeepsTheOthersFocusItems(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			morning := insertReturn(t, s, "hash-morning", "coach-kim", "2026-08-19")
			afternoon := insertReturn(t, s, "hash-afternoon", "coach-kim", "2026-08-19")
			landItem(t, s, morning, "item-am", "hold high ground longer")
			landItem(t, s, afternoon, "item-pm", "count the enemy support ults")
			mustNoErr(t, s.SetFocusItemStatus("item-am", db.FocusWorking))

			mustNoErr(t, s.DeleteCoachReturn(afternoon))

			items, err := s.LoadReceivedFocusItems()
			mustNoErr(t, err)
			if len(items) != 1 {
				t.Fatalf("received items = %d, want 1 — the morning file's item must survive: %+v", len(items), items)
			}
			if items[0].ItemID != "item-am" {
				t.Fatalf("surviving item = %q, want item-am", items[0].ItemID)
			}
			if items[0].Status != db.FocusWorking {
				t.Errorf("status = %q, want %q — the player's progress must not be reset",
					items[0].Status, db.FocusWorking)
			}
		})
	}
}

// The coach and the session date are the RETURN's, read back through it. A
// discarded return takes its items with it, so no item can outlive the row
// that says where it came from.
func TestStoreContract_AReceivedItemReadsItsCoachFromItsReturn(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			id := insertReturn(t, s, "hash-1", "coach-rivera", "2026-08-18")
			landItem(t, s, id, "item-1", "stop dying on cooldown")

			items, err := s.LoadReceivedFocusItems()
			mustNoErr(t, err)
			if len(items) != 1 {
				t.Fatalf("received items = %d, want 1", len(items))
			}
			if items[0].CoachName != "coach-rivera" || items[0].SessionDate != "2026-08-18" {
				t.Errorf("item provenance = %q / %q, want coach-rivera / 2026-08-18",
					items[0].CoachName, items[0].SessionDate)
			}

			mustNoErr(t, s.DeleteCoachReturn(id))
			items, err = s.LoadReceivedFocusItems()
			mustNoErr(t, err)
			if len(items) != 0 {
				t.Errorf("received items after the discard = %d, want 0", len(items))
			}
		})
	}
}

func insertReturn(t *testing.T, s db.Store, hash, coach, date string) int64 {
	t.Helper()
	id, err := s.InsertCoachReturn(db.CoachReturn{
		ContentHash: hash, CoachName: coach, PlayerHandle: "player",
		SessionDate: date, NotesJSON: []byte("{}"),
	})
	mustNoErr(t, err)
	return id
}

func landItem(t *testing.T, s db.Store, returnID int64, itemID, text string) {
	t.Helper()
	mustNoErr(t, s.UpsertReceivedFocusItem(db.ReceivedFocusItem{
		ItemID: itemID, Text: text, Status: db.FocusNew,
		ReturnID: returnID,
	}))
}

// An item belongs to the return that FIRST carried it. A later file that
// repeats it must not adopt it, or discarding that later file cascades away
// an item the player has been working on since the first one.
func TestStoreContract_ReLandingAnItemKeepsItsFirstReturn(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			first := insertReturn(t, s, "hash-first", "coach-kim", "2026-08-19")
			later := insertReturn(t, s, "hash-later", "coach-kim", "2026-08-20")
			landItem(t, s, first, "item-1", "hold high ground longer")
			landItem(t, s, later, "item-1", "hold high ground longer")

			mustNoErr(t, s.DeleteCoachReturn(later))

			items, err := s.LoadReceivedFocusItems()
			mustNoErr(t, err)
			if len(items) != 1 || items[0].ReturnID != first {
				t.Errorf("received items = %+v, want item-1 still on return %d", items, first)
			}
		})
	}
}

// A block remembers the return whose accept wrote it, and outlives that
// return being discarded with no return to answer to.
func TestStoreContract_ABlockOutlivesTheReturnThatWroteIt(t *testing.T) {
	for _, impl := range storeImpls {
		t.Run(impl.name, func(t *testing.T) {
			s := impl.open(t)
			id := insertReturn(t, s, "hash-1", "coach-kim", "2026-08-19")
			_, err := s.UpsertMatchCoachNote(db.MatchCoachNote{
				NoteID: "note-1", MatchKey: coachKey, CoachName: "coach-kim",
				SessionDate: "2026-08-19", Text: "hold", ReturnID: id,
			})
			mustNoErr(t, err)
			blocks, err := s.LoadMatchCoachNotes()
			mustNoErr(t, err)
			if len(blocks[coachKey]) != 1 || blocks[coachKey][0].ReturnID != id {
				t.Fatalf("blocks = %+v, want one written by return %d", blocks[coachKey], id)
			}

			mustNoErr(t, s.DeleteCoachReturn(id))

			blocks, err = s.LoadMatchCoachNotes()
			mustNoErr(t, err)
			if len(blocks[coachKey]) != 1 || blocks[coachKey][0].ReturnID != 0 {
				t.Errorf("blocks after the discard = %+v, want the block kept with no return", blocks[coachKey])
			}
		})
	}
}
