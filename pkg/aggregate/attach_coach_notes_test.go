package aggregate_test

import (
	"reflect"
	"testing"

	"recall/pkg/aggregate"
	"recall/pkg/db"
	"recall/pkg/match"
)

func coachNoteRow(id int64, matchKey, acceptedAt string) db.MatchCoachNote {
	return db.MatchCoachNote{
		ID:          id,
		NoteID:      "note-" + acceptedAt,
		MatchKey:    matchKey,
		CoachName:   "Ordo",
		SessionDate: "2026-08-08",
		Text:        "peel earlier",
		MatchClock:  "04:20",
		FocusTags:   []string{"positioning"},
		ExtraTags:   []string{"vod"},
		AcceptedAt:  acceptedAt,
	}
}

// AttachCoachNotes keeps every block in the order the store handed it over
// (accepted_at, then id) — it must not re-sort, since the store already
// defines "oldest first".
func TestAttachCoachNotes_AttachesBlocksInStoreOrder(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}}
	aggregate.AttachCoachNotes(recs, map[string][]db.MatchCoachNote{
		"match-1": {
			coachNoteRow(7, "match-1", "2026-08-09T10:00:00Z"),
			coachNoteRow(3, "match-1", "2026-08-10T10:00:00Z"),
			coachNoteRow(9, "match-1", "2026-08-10T10:00:00Z"),
		},
	})

	got := recs[0].CoachNotes
	if len(got) != 3 {
		t.Fatalf("CoachNotes = %+v, want 3 blocks", got)
	}
	if got[0].ID != 7 || got[1].ID != 3 || got[2].ID != 9 {
		t.Errorf("block ids = %d/%d/%d, want store order 7/3/9", got[0].ID, got[1].ID, got[2].ID)
	}
}

// A record with no accepted blocks keeps CoachNotes nil (not an empty
// slice) — omitempty then drops it from the wire, and a present-but-absent
// key in a non-empty map is the same as an empty map.
func TestAttachCoachNotes_NilWhenNone(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}, {MatchKey: "match-2"}}
	aggregate.AttachCoachNotes(recs, map[string][]db.MatchCoachNote{
		"match-2": {coachNoteRow(1, "match-2", "2026-08-09T10:00:00Z")},
	})
	if recs[0].CoachNotes != nil {
		t.Errorf("recs[0].CoachNotes = %+v, want nil for a match no coach wrote about", recs[0].CoachNotes)
	}

	empty := []match.Record{{MatchKey: "match-1"}}
	aggregate.AttachCoachNotes(empty, nil)
	if empty[0].CoachNotes != nil {
		t.Errorf("CoachNotes = %+v after an empty map, want nil", empty[0].CoachNotes)
	}
}

// Blocks land only on the record whose match_key they carry.
func TestAttachCoachNotes_PerKeyIsolation(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}, {MatchKey: "match-2"}}
	aggregate.AttachCoachNotes(recs, map[string][]db.MatchCoachNote{
		"match-1": {coachNoteRow(1, "match-1", "2026-08-09T10:00:00Z")},
		"match-2": {
			coachNoteRow(2, "match-2", "2026-08-09T11:00:00Z"),
			coachNoteRow(3, "match-2", "2026-08-09T12:00:00Z"),
		},
	})

	if len(recs[0].CoachNotes) != 1 || recs[0].CoachNotes[0].ID != 1 {
		t.Errorf("recs[0].CoachNotes = %+v, want only block 1", recs[0].CoachNotes)
	}
	if len(recs[1].CoachNotes) != 2 || recs[1].CoachNotes[0].ID != 2 || recs[1].CoachNotes[1].ID != 3 {
		t.Errorf("recs[1].CoachNotes = %+v, want blocks 2 and 3", recs[1].CoachNotes)
	}
}

// The converter carries every field across, tag slices included; a nil
// tag list stays nil and an empty one stays empty, exactly as the store
// handed them over.
func TestAttachCoachNotes_ConverterMapsEveryField(t *testing.T) {
	recs := []match.Record{{MatchKey: "match-1"}, {MatchKey: "match-2"}, {MatchKey: "match-3"}}
	full := coachNoteRow(42, "match-1", "2026-08-09T10:00:00Z")
	full.FocusTags = []string{"cooldowns", "positioning"}
	full.ExtraTags = []string{"tempo", "vod"}
	nilTags := coachNoteRow(43, "match-2", "2026-08-09T10:00:00Z")
	nilTags.FocusTags, nilTags.ExtraTags = nil, nil
	emptyTags := coachNoteRow(44, "match-3", "2026-08-09T10:00:00Z")
	emptyTags.FocusTags, emptyTags.ExtraTags = []string{}, []string{}

	aggregate.AttachCoachNotes(recs, map[string][]db.MatchCoachNote{
		"match-1": {full},
		"match-2": {nilTags},
		"match-3": {emptyTags},
	})

	want := match.CoachNote{
		ID:          42,
		NoteID:      full.NoteID,
		CoachName:   "Ordo",
		SessionDate: "2026-08-08",
		Text:        "peel earlier",
		MatchClock:  "04:20",
		FocusTags:   []string{"cooldowns", "positioning"},
		ExtraTags:   []string{"tempo", "vod"},
		AcceptedAt:  "2026-08-09T10:00:00Z",
	}
	if got := recs[0].CoachNotes[0]; !reflect.DeepEqual(got, want) {
		t.Errorf("converted note = %+v, want %+v", got, want)
	}
	if got := recs[1].CoachNotes[0]; got.FocusTags != nil || got.ExtraTags != nil {
		t.Errorf("nil tag slices became %v / %v, want nil preserved", got.FocusTags, got.ExtraTags)
	}
	got := recs[2].CoachNotes[0]
	if got.FocusTags == nil || len(got.FocusTags) != 0 || got.ExtraTags == nil || len(got.ExtraTags) != 0 {
		t.Errorf("empty tag slices became %#v / %#v, want empty preserved", got.FocusTags, got.ExtraTags)
	}
}

// The bulk attach and the single-key sidecar path (MatchKey →
// attachMatchSidecars) must produce identical CoachNotes for the same
// input — a field added to only one converter would otherwise diverge
// between the list read and the single-match read with no compile error.
func TestAggregateMatchKey_CoachNotesAgreeWithAttachCoachNotes(t *testing.T) {
	snap := db.Screenshots{
		Summaries: []db.SummaryRow{{ID: 1, Filename: "s.png", MatchKey: "m1", Map: "rialto", Result: "victory"}},
	}
	notes := map[string][]db.MatchCoachNote{
		"m1": {
			coachNoteRow(5, "m1", "2026-08-09T10:00:00Z"),
			coachNoteRow(6, "m1", "2026-08-10T10:00:00Z"),
		},
	}

	single, ok := aggregate.MatchKey("m1", snap, aggregate.Sidecars{CoachNotes: notes})
	if !ok {
		t.Fatal("MatchKey ok=false for an existing key")
	}
	bulk := aggregate.Screenshots(snap)
	aggregate.AttachCoachNotes(bulk, notes)

	if len(single.CoachNotes) != 2 {
		t.Fatalf("single-key CoachNotes = %+v, want 2 blocks", single.CoachNotes)
	}
	if !reflect.DeepEqual(single.CoachNotes, bulk[0].CoachNotes) {
		t.Errorf("single-key CoachNotes = %+v\nbulk CoachNotes = %+v\nwant identical", single.CoachNotes, bulk[0].CoachNotes)
	}
}

// The last link in the chain a coach's timestamped moment travels: stored on
// an accepted block, out through the aggregator, onto the wire the UI reads.
//
// Worth its own test because the e2e above it cannot see this: the browser
// suite serves its matches from a route mock, so a moment can reach the screen
// there without any of this code running. Mutating away the conversion left
// every browser test green.
func TestAttachCoachNotes_CarriesTheMomentsOntoTheWire(t *testing.T) {
	row := coachNoteRow(1, "match-2026-08-08T20-15-00", "2026-08-09T09:00:00Z")
	row.Moments = []db.MatchCoachNoteMoment{
		{MomentID: "m1", MatchClock: "03:23", Text: "no off-angle", FocusTag: "positioning", SortOrder: 0},
		{MomentID: "m2", MatchClock: "04:45", Text: "flanking Cassidy", SortOrder: 1},
	}
	recs := []match.Record{{MatchKey: row.MatchKey}}

	aggregate.AttachCoachNotes(recs, map[string][]db.MatchCoachNote{row.MatchKey: {row}})

	got := recs[0].CoachNotes
	if len(got) != 1 || len(got[0].Moments) != 2 {
		t.Fatalf("the moments never reached the record: %+v", got)
	}
	want := []match.CoachNoteMoment{
		{MomentID: "m1", MatchClock: "03:23", Text: "no off-angle", FocusTag: "positioning"},
		{MomentID: "m2", MatchClock: "04:45", Text: "flanking Cassidy"},
	}
	if !reflect.DeepEqual(got[0].Moments, want) {
		t.Errorf("moments = %+v\nwant     %+v", got[0].Moments, want)
	}
}

// The player's own moments ride a separate field — they are the player's words
// about their own match, not a coach's, and merging them would make "who said
// this" a column instead of a boundary.
func TestAttachMatchMoments_KeepsThePlayersOwnSeparate(t *testing.T) {
	const key = "match-2026-08-08T20-15-00"
	recs := []match.Record{{MatchKey: key}}

	aggregate.AttachMatchMoments(recs, map[string][]db.MatchMoment{key: {
		{MomentID: "p1", MatchKey: key, MatchClock: "02:10", Text: "my own read"},
	}})

	if len(recs[0].Moments) != 1 || recs[0].Moments[0].Text != "my own read" {
		t.Fatalf("the player's moments did not attach: %+v", recs[0].Moments)
	}
	if len(recs[0].CoachNotes) != 0 {
		t.Errorf("a player moment must not appear as a coach note: %+v", recs[0].CoachNotes)
	}
}
