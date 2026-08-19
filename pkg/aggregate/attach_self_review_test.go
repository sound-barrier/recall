package aggregate_test

import (
	"reflect"
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/match"
)

// selfReviewRow is a store row on match m1 — the one key every case here
// attaches to.
func selfReviewRow(reviewID, createdAt string) db.SelfReviewNoteOnMatch {
	return db.SelfReviewNoteOnMatch{
		SelfReviewNote: db.SelfReviewNote{
			ReviewID: reviewID, MatchKey: "m1", Kind: "note", Text: "held the choke",
			MatchClock: "06:40", FocusTags: []string{"positioning"}, ExtraTags: []string{"tempo"},
			Moments: []db.SelfReviewMoment{
				{MomentID: "m1", MatchClock: "03:23", Text: "no off-angle", FocusTag: "positioning"},
				{MomentID: "m2", MatchClock: "04:45", Text: "flank", SortOrder: 1},
			},
			CreatedAt: createdAt, UpdatedAt: "2026-08-18T20:00:00Z",
		},
		ReviewTitle: "Tuesday Ana", ReviewCreatedAt: createdAt, ReviewFinishedAt: "2026-08-18T21:00:00Z",
	}
}

// Every field of the store row lands on the wire, with an explicit want:
// a field added to the type and forgotten here shows up as a diff, not as
// a silently empty block in the UI.
func TestAttachSelfReviewNotes_ConverterMapsEveryField(t *testing.T) {
	row := selfReviewRow("r-1", "2026-08-18T19:00:00Z")
	recs := []match.Record{{MatchKey: "m1"}, {MatchKey: "m2"}}

	aggregate.AttachSelfReviewNotes(recs, map[string][]db.SelfReviewNoteOnMatch{"m1": {row}})

	want := []match.SelfReviewNote{{
		ReviewID: "r-1", ReviewTitle: "Tuesday Ana", ReviewCreatedAt: "2026-08-18T19:00:00Z",
		ReviewFinishedAt: "2026-08-18T21:00:00Z", Kind: "note", Text: "held the choke", MatchClock: "06:40",
		FocusTags: []string{"positioning"}, ExtraTags: []string{"tempo"},
		Moments: []match.CoachNoteMoment{
			{MomentID: "m1", MatchClock: "03:23", Text: "no off-angle", FocusTag: "positioning"},
			{MomentID: "m2", MatchClock: "04:45", Text: "flank"},
		},
		UpdatedAt: "2026-08-18T20:00:00Z",
	}}
	if !reflect.DeepEqual(recs[0].SelfReviewNotes, want) {
		t.Errorf("got  %+v\nwant %+v", recs[0].SelfReviewNotes, want)
	}
	if recs[1].SelfReviewNotes != nil {
		t.Errorf("a match with no block got %+v", recs[1].SelfReviewNotes)
	}
}

func TestAttachSelfReviewNotes_KeepsStoreOrderAndNilForNone(t *testing.T) {
	recs := []match.Record{{MatchKey: "m1"}}
	aggregate.AttachSelfReviewNotes(recs, map[string][]db.SelfReviewNoteOnMatch{
		"m1": {selfReviewRow("r-old", "2026-08-01T10:00:00Z"), selfReviewRow("r-new", "2026-08-10T10:00:00Z")},
	})
	if len(recs[0].SelfReviewNotes) != 2 || recs[0].SelfReviewNotes[0].ReviewID != "r-old" {
		t.Errorf("blocks = %+v, want the store's order kept", recs[0].SelfReviewNotes)
	}
	empty := []match.Record{{MatchKey: "m1"}}
	aggregate.AttachSelfReviewNotes(empty, nil)
	aggregate.AttachSelfReviewNotes(empty, map[string][]db.SelfReviewNoteOnMatch{"m1": {}})
	if empty[0].SelfReviewNotes != nil {
		t.Errorf("no blocks became %#v, want nil so the field stays off the wire", empty[0].SelfReviewNotes)
	}
}

// The bulk attach and the single-key sidecar path must agree, the same
// parity the coach layer pins — a field added to only one converter would
// diverge the list read from the single-match read with no compile error.
func TestAggregateMatchKey_SelfReviewNotesAgreeWithAttach(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{ID: 1, Filename: "s.png", MatchKey: "m1", Map: "rialto", Result: "victory"}},
	}
	notes := map[string][]db.SelfReviewNoteOnMatch{
		"m1": {selfReviewRow("r-1", "2026-08-09T10:00:00Z"), selfReviewRow("r-2", "2026-08-10T10:00:00Z")},
	}
	single, ok := aggregate.MatchKey("m1", snap, aggregate.Sidecars{SelfReviews: notes})
	if !ok {
		t.Fatal("MatchKey ok=false for an existing key")
	}
	bulk := aggregate.Screenshots(snap)
	aggregate.AttachSelfReviewNotes(bulk, notes)
	if len(single.SelfReviewNotes) != 2 || !reflect.DeepEqual(single.SelfReviewNotes, bulk[0].SelfReviewNotes) {
		t.Errorf("single-key = %+v\nbulk = %+v\nwant identical", single.SelfReviewNotes, bulk[0].SelfReviewNotes)
	}
}
