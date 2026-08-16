package coach_test

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"recall/pkg/coach"
)

const (
	noteIDOne = "a3f1c2d4-8e9b-4a7c-b6d5-1f2e3d4c5b6a"
	noteIDTwo = "b7e2d3c4-9f0a-4b8d-8c1e-2a3b4c5d6e7f"
)

// validNotesFile is the smallest notes file that passes every rule.
func validNotesFile() coach.NotesFile {
	return coach.NotesFile{
		Schema:        coach.NotesSchemaV1,
		ExportedAt:    "2026-08-15T09:12:00Z",
		RecallVersion: seedVersion,
		CoachName:     "Ordo",
		Player:        coach.Player{ID: sharePlayer().ID, Handle: "Sable"},
		SessionDate:   "2026-08-15",
		Summary:       "Work on ult timing.",
		Notes: []coach.Note{
			{NoteID: noteIDOne, MatchKey: keyIlios, Kind: "note", Text: "hold high ground", FocusTags: []string{"positioning"}, ExtraTags: []string{}, MatchClock: "06:40", UpdatedAt: "2026-08-15T09:00:00Z",
				Match: &coach.MatchContext{Map: "ilios", Hero: "ana", Result: "victory", Date: "2026-08-01", FinishedAt: "18:30"}},
			{NoteID: noteIDTwo, MatchKey: keyRank, Kind: "reviewed_only", FocusTags: []string{}, ExtraTags: []string{}, UpdatedAt: "2026-08-15T09:01:00Z"},
		},
	}
}

func TestValidateNotesFile_AcceptsAValidFile(t *testing.T) {
	if err := coach.ValidateNotesFile(validNotesFile()); err != nil {
		t.Fatalf("ValidateNotesFile(valid) = %v", err)
	}
	empty := validNotesFile()
	empty.Notes = nil
	empty.Summary = ""
	if err := coach.ValidateNotesFile(empty); err != nil {
		t.Fatalf("a file with no notes and no summary is still well-formed: %v", err)
	}
	anonymous := validNotesFile()
	anonymous.Player.ID = ""
	if err := coach.ValidateNotesFile(anonymous); err != nil {
		t.Fatalf("an anonymous player (handle only) is valid: %v", err)
	}
}

func TestValidateNotesFile_Rejects(t *testing.T) {
	tooMany := make([]coach.Note, 5001)
	for i := range tooMany {
		tooMany[i] = coach.Note{NoteID: coach.NewID(), MatchKey: fmt.Sprintf("match-2026-01-01T00-00-00-%d", i), Kind: "note", Text: "x"}
	}
	tests := []struct {
		name   string
		mutate func(f *coach.NotesFile)
		want   error
		reason string
	}{
		{"missing schema", func(f *coach.NotesFile) { f.Schema = "" }, coach.ErrNotesMalformed, "schema"},
		{"other schema", func(f *coach.NotesFile) { f.Schema = "recall-coach-notes/v2" }, coach.ErrNotesUnsupportedSchema, "recall-coach-notes/v2"},
		{"bundle schema", func(f *coach.NotesFile) { f.Schema = "recall-bundle/v1" }, coach.ErrNotesUnsupportedSchema, "recall-bundle/v1"},
		{"blank coach", func(f *coach.NotesFile) { f.CoachName = "  " }, coach.ErrNotesMalformed, "coach_name"},
		{"long coach", func(f *coach.NotesFile) { f.CoachName = strings.Repeat("c", 65) }, coach.ErrNotesMalformed, "coach_name"},
		{"blank handle", func(f *coach.NotesFile) { f.Player.Handle = "" }, coach.ErrNotesMalformed, "handle"},
		{"long handle", func(f *coach.NotesFile) { f.Player.Handle = strings.Repeat("h", 65) }, coach.ErrNotesMalformed, "handle"},
		{"player id not a uuid", func(f *coach.NotesFile) { f.Player.ID = "sable" }, coach.ErrNotesMalformed, "player.id"},
		{"bad session date", func(f *coach.NotesFile) { f.SessionDate = "15/08/2026" }, coach.ErrNotesMalformed, "session_date"},
		{"missing session date", func(f *coach.NotesFile) { f.SessionDate = "" }, coach.ErrNotesMalformed, "session_date"},
		{"long summary", func(f *coach.NotesFile) { f.Summary = strings.Repeat("s", 20001) }, coach.ErrNotesMalformed, "summary"},
		{"too many notes", func(f *coach.NotesFile) { f.Notes = tooMany }, coach.ErrNotesMalformed, "5000"},
		{"duplicate note id", func(f *coach.NotesFile) { f.Notes[1].NoteID = f.Notes[0].NoteID }, coach.ErrNotesMalformed, "note_id"},
		{"duplicate match key", func(f *coach.NotesFile) { f.Notes[1].MatchKey = f.Notes[0].MatchKey }, coach.ErrNotesMalformed, "match_key"},
		{"note id not a uuid", func(f *coach.NotesFile) { f.Notes[0].NoteID = "note-1" }, coach.ErrNotesMalformed, "note_id"},
		{"empty note id", func(f *coach.NotesFile) { f.Notes[0].NoteID = "" }, coach.ErrNotesMalformed, "note_id"},
		{"ambiguous match key", func(f *coach.NotesFile) { f.Notes[0].MatchKey = "ambiguous-c2hvdA" }, coach.ErrNotesMalformed, "match_key"},
		{"unmatched match key", func(f *coach.NotesFile) { f.Notes[0].MatchKey = "unmatched-c2hvdA" }, coach.ErrNotesMalformed, "match_key"},
		{"garbage match key", func(f *coach.NotesFile) { f.Notes[0].MatchKey = "m1" }, coach.ErrNotesMalformed, "match_key"},
		{"note fails the note rules", func(f *coach.NotesFile) { f.Notes[0].Kind = "verdict" }, coach.ErrNotesMalformed, "kind"},
		{"reviewed_only with text", func(f *coach.NotesFile) { f.Notes[1].Text = "x" }, coach.ErrNotesMalformed, "reviewed_only"},
		{"bad clock", func(f *coach.NotesFile) { f.Notes[0].MatchClock = "6-40" }, coach.ErrNotesMalformed, "clock"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := validNotesFile()
			tc.mutate(&f)
			err := coach.ValidateNotesFile(f)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if !strings.Contains(err.Error(), tc.reason) {
				t.Errorf("err = %q, want it to name %q", err, tc.reason)
			}
		})
	}
}
