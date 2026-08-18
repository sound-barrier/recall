package coach_test

import (
	"errors"
	"reflect"
	"testing"
	"time"

	"recall/pkg/coach"
	"recall/pkg/db"
)

// exportClock is the instant every export test stamps with, so exported_at
// and session_date are assertable rather than "whatever now was".
var exportClock = time.Date(2026, 8, 12, 15, 4, 5, 0, time.UTC)

func storedNote(key, text string, tags []string) db.CoachNote {
	return db.CoachNote{
		NoteID: coach.NewID(), PlayerRef: 1, MatchKey: key, Kind: coach.KindNote,
		Text: text, FocusTags: tags, UpdatedAt: "2026-08-12T15:00:00Z",
	}
}

func TestNotes_OrderFollowsTheReelThenKey(t *testing.T) {
	t.Parallel()
	s := openSeededSession(t, sharePlayer())

	// Deliberately reversed relative to the session's record order.
	stored := map[string]db.CoachNote{
		keyRank:   storedNote(keyRank, "rank note", []string{"positioning"}),
		keyIlios:  storedNote(keyIlios, "ilios note", nil),
		keyManual: storedNote(keyManual, "manual note", nil),
	}

	notes := coach.Notes(s, stored, nil)

	if len(notes) != 3 {
		t.Fatalf("got %d notes, want 3", len(notes))
	}
	var recordOrder []string
	for _, rec := range s.Records() {
		if _, ok := stored[rec.MatchKey]; ok {
			recordOrder = append(recordOrder, rec.MatchKey)
		}
	}
	for i, want := range recordOrder {
		if notes[i].MatchKey != want {
			t.Errorf("note %d is %q, want %q (record order %v)", i, notes[i].MatchKey, want, recordOrder)
		}
	}
}

func TestNotes_AttachesTheMatchContextForEachKey(t *testing.T) {
	t.Parallel()
	s := openSeededSession(t, sharePlayer())

	notes := coach.Notes(s, map[string]db.CoachNote{keyIlios: storedNote(keyIlios, "watch the high ground", nil)}, nil)

	if len(notes) != 1 {
		t.Fatalf("got %d notes, want 1", len(notes))
	}
	ctx := notes[0].Match
	if ctx == nil {
		t.Fatal("note carries no match context")
	}
	if ctx.Map != "ilios" || ctx.Result != "victory" {
		t.Errorf("context is %+v, want the Ilios victory", *ctx)
	}
}

// A note whose match left the session (a re-export that dropped it) still
// travels, so the coach can see and export work they already did.
func TestNotes_KeepsANoteWhoseMatchIsGone(t *testing.T) {
	t.Parallel()
	s := openSeededSession(t, sharePlayer())
	gone := "match-2020-01-01T00-00-00"

	notes := coach.Notes(s, map[string]db.CoachNote{gone: storedNote(gone, "orphan", nil)}, nil)

	if len(notes) != 1 || notes[0].MatchKey != gone {
		t.Fatalf("got %+v, want the orphan note", notes)
	}
	if notes[0].Match != nil {
		t.Errorf("orphan carries context %+v, want none", *notes[0].Match)
	}
}

func TestNotes_EmptyIsEmptyNotNil(t *testing.T) {
	t.Parallel()
	if got := coach.Notes(openSeededSession(t, sharePlayer()), nil, nil); got == nil || len(got) != 0 {
		t.Errorf("got %v, want an empty non-nil slice", got)
	}
}

func TestExportNotes_AssemblesTheFileAndValidates(t *testing.T) {
	t.Parallel()
	s := openSeededSession(t, sharePlayer())
	notes := coach.Notes(s, map[string]db.CoachNote{keyIlios: storedNote(keyIlios, "hold the high ground", []string{"positioning"})}, nil)
	summary := db.CoachSummary{PlayerRef: 1, Text: "Work on positioning."}

	f, err := coach.ExportNotes(s, notes, summary, "Ordo", "0.31.0", exportClock)
	if err != nil {
		t.Fatalf("ExportNotes: %v", err)
	}

	// The whole file at once: attribution, the clock stamped both ways, the
	// player's identity minus the message they wrote TO the coach, and the
	// notes passed through untouched.
	want := coach.NotesFile{
		Schema:        coach.NotesSchemaV1,
		ExportedAt:    "2026-08-12T15:04:05Z",
		RecallVersion: "0.31.0",
		CoachName:     "Ordo",
		Player:        coach.Player{ID: sharePlayer().ID, Handle: "Sable"},
		SessionDate:   "2026-08-12",
		Summary:       "Work on positioning.",
		Notes:         notes,
	}
	if !reflect.DeepEqual(f, want) {
		t.Errorf("file = %+v\nwant  %+v", f, want)
	}
	// The file it produces must be one the player's side accepts.
	if err := coach.ValidateNotesFile(f); err != nil {
		t.Errorf("exported file fails its own validation: %v", err)
	}
}

func TestExportNotes_SummaryOnlyIsEnough(t *testing.T) {
	t.Parallel()
	s := openSeededSession(t, sharePlayer())

	f, err := coach.ExportNotes(s, nil, db.CoachSummary{Text: "Ladder anxiety, not aim."}, "Ordo", "0.31.0", exportClock)
	if err != nil {
		t.Fatalf("ExportNotes: %v", err)
	}
	if f.Summary == "" || len(f.Notes) != 0 {
		t.Errorf("got %d notes and summary %q", len(f.Notes), f.Summary)
	}
}

func TestExportNotes_Refusals(t *testing.T) {
	t.Parallel()
	oneNote := []coach.Note{{NoteID: coach.NewID(), MatchKey: keyIlios, Kind: coach.KindNote, Text: "x"}}

	tests := []struct {
		name      string
		handle    string
		coachName string
		notes     []coach.Note
		summary   string
		want      error
	}{
		{"no coach name", "Sable", "", oneNote, "", coach.ErrCoachNameRequired},
		{"no handle confirmed", "", "Ordo", oneNote, "", coach.ErrHandleRequired},
		{"nothing written", "Sable", "Ordo", nil, "", coach.ErrNothingToExport},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			s := openSeededSession(t, sharePlayer())
			s.Player.Handle = tc.handle

			_, err := coach.ExportNotes(s, tc.notes, db.CoachSummary{Text: tc.summary}, tc.coachName, "0.31.0", exportClock)

			if !errors.Is(err, tc.want) {
				t.Errorf("got %v, want %v", err, tc.want)
			}
		})
	}
}
