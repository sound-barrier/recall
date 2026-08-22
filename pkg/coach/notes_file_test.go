package coach_test

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"recall/pkg/coach"
)

const (
	noteIDOne  = "a3f1c2d4-8e9b-4a7c-b6d5-1f2e3d4c5b6a"
	noteIDTwo  = "b7e2d3c4-9f0a-4b8d-8c1e-2a3b4c5d6e7f"
	focusIDOne = "e5f6a7b8-2c3d-4e5f-9a0b-1c2d3e4f5a6b"
	focusIDTwo = "f6a7b8c9-3d4e-4f5a-8b1c-2d3e4f5a6b7c"
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
		FocusItems:    []coach.FocusItem{{ItemID: focusIDOne, Text: "Work on ult timing."}},
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
	empty.FocusItems = nil
	if err := coach.ValidateNotesFile(empty); err != nil {
		t.Fatalf("a file with no notes and no items is still well-formed: %v", err)
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
		{"other schema", func(f *coach.NotesFile) { f.Schema = "recall-coach-notes/v9" }, coach.ErrNotesUnsupportedSchema, "recall-coach-notes/v9"},
		// The declared breaking change: a v2 archive is refused. There was a
		// window where this build wrote v2 when a note carried moments; that
		// machinery was backwards compatibility for a release that never
		// happened, and it is gone. Pinned so its removal is a decision
		// somebody has to make again rather than a line that drifts back.
		{"the withdrawn v2", func(f *coach.NotesFile) { f.Schema = "recall-coach-notes/v2" }, coach.ErrNotesUnsupportedSchema, "recall-coach-notes/v2"},
		{"bundle schema", func(f *coach.NotesFile) { f.Schema = "recall-bundle/v1" }, coach.ErrNotesUnsupportedSchema, "recall-bundle/v1"},
		{"blank coach", func(f *coach.NotesFile) { f.CoachName = "  " }, coach.ErrNotesMalformed, "coach_name"},
		{"long coach", func(f *coach.NotesFile) { f.CoachName = strings.Repeat("c", 65) }, coach.ErrNotesMalformed, "coach_name"},
		{"blank handle", func(f *coach.NotesFile) { f.Player.Handle = "" }, coach.ErrNotesMalformed, "handle"},
		{"long handle", func(f *coach.NotesFile) { f.Player.Handle = strings.Repeat("h", 65) }, coach.ErrNotesMalformed, "handle"},
		{"player id not a uuid", func(f *coach.NotesFile) { f.Player.ID = "sable" }, coach.ErrNotesMalformed, "player.id"},
		{"bad session date", func(f *coach.NotesFile) { f.SessionDate = "15/08/2026" }, coach.ErrNotesMalformed, "session_date"},
		{"missing session date", func(f *coach.NotesFile) { f.SessionDate = "" }, coach.ErrNotesMalformed, "session_date"},
		{"long focus item", func(f *coach.NotesFile) { f.FocusItems[0].Text = strings.Repeat("s", 2001) }, coach.ErrNotesMalformed, "focus_items"},
		{"blank focus item", func(f *coach.NotesFile) { f.FocusItems[0].Text = "  " }, coach.ErrNotesMalformed, "focus_items"},
		{"focus item id not a uuid", func(f *coach.NotesFile) { f.FocusItems[0].ItemID = "item-1" }, coach.ErrNotesMalformed, "item_id"},
		{"duplicate focus item id", func(f *coach.NotesFile) {
			f.FocusItems = append(f.FocusItems, coach.FocusItem{ItemID: focusIDOne, Text: "again"})
		}, coach.ErrNotesMalformed, "item_id"},
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

// A coach reviewing from a replay code has none of the player's screenshots,
// so the key a note carries is minted from the code itself. The file has to
// admit it, or a code-only session produces an archive nobody can read.
func TestValidateNotesFile_AcceptsANoteAboutAReplayMatch(t *testing.T) {
	f := validNotesFile()
	f.Notes = []coach.Note{{
		NoteID: noteIDOne, MatchKey: "replay-A1B2C3", Kind: "note",
		Text: "held the choke too long", FocusTags: []string{"positioning"},
		ExtraTags: []string{}, MatchClock: "04:12", UpdatedAt: "2026-08-15T09:00:00Z",
		Match: &coach.MatchContext{Map: "ilios", Result: "defeat", ReplayCode: "A1B2C3"},
	}}
	if err := coach.ValidateNotesFile(f); err != nil {
		t.Fatalf("a note about a replay match is well-formed: %v", err)
	}
}

// The archive is the ONLY thing the player's side has to work from: if the
// note names a match they do not have, the context is what the match gets
// created from. A replay note with no context, or with a code that disagrees
// with its own key, cannot be honored — so it is refused at the door rather
// than half-applied later.
func TestValidateNotesFile_RejectsAReplayNoteThatCannotStandAlone(t *testing.T) {
	base := func() coach.Note {
		return coach.Note{
			NoteID: noteIDOne, MatchKey: "replay-A1B2C3", Kind: "note",
			Text: "held the choke", FocusTags: []string{}, ExtraTags: []string{},
			UpdatedAt: "2026-08-15T09:00:00Z",
			Match:     &coach.MatchContext{Map: "ilios", ReplayCode: "A1B2C3"},
		}
	}
	cases := map[string]func(*coach.Note){
		"no context at all":      func(n *coach.Note) { n.Match = nil },
		"context with no code":   func(n *coach.Note) { n.Match.ReplayCode = "" },
		"code disagrees withkey": func(n *coach.Note) { n.Match.ReplayCode = "Z9Y8X7" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			f := validNotesFile()
			n := base()
			mutate(&n)
			f.Notes = []coach.Note{n}
			if err := coach.ValidateNotesFile(f); !errors.Is(err, coach.ErrNotesMalformed) {
				t.Fatalf("err = %v, want ErrNotesMalformed", err)
			}
		})
	}
}

// Widening the note gate must not widen it to the sentinels. An unmatched or
// ambiguous screenshot is still not something a coach can write about.
func TestIsReviewableMatchKey(t *testing.T) {
	cases := map[string]bool{
		"match-2026-08-01T18-30-00": true,
		"replay-A1B2C3":             true,
		"unmatched-abc":             false,
		"ambiguous-abc":             false,
		"nonsense":                  false,
		"":                          false,
	}
	for key, want := range cases {
		if got := coach.IsReviewableMatchKey(key); got != want {
			t.Errorf("IsReviewableMatchKey(%q) = %v, want %v", key, got, want)
		}
	}
}
