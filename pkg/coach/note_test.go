package coach_test

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/db"
)

func TestValidateNoteInput_Rejects(t *testing.T) {
	longText := strings.Repeat("x", 4001)
	manyExtras := make([]string, 21)
	for i := range manyExtras {
		manyExtras[i] = strings.Repeat("t", i+1)
	}
	tests := []struct {
		name string
		in   coach.NoteInput
		want string
	}{
		{"unknown kind", coach.NoteInput{Kind: "verdict", Text: "x"}, "kind"},
		{"empty kind", coach.NoteInput{Text: "x"}, "kind"},
		{"note with nothing", coach.NoteInput{Kind: "note"}, "empty"},
		{"note with only whitespace", coach.NoteInput{Kind: "note", Text: "  \n "}, "empty"},
		{"reviewed_only with text", coach.NoteInput{Kind: "reviewed_only", Text: "hi"}, "reviewed_only"},
		{"reviewed_only with focus tag", coach.NoteInput{Kind: "reviewed_only", FocusTags: []string{"comms"}}, "reviewed_only"},
		{"reviewed_only with extra tag", coach.NoteInput{Kind: "reviewed_only", ExtraTags: []string{"tempo"}}, "reviewed_only"},
		{"reviewed_only with clock", coach.NoteInput{Kind: "reviewed_only", MatchClock: "01:00"}, "reviewed_only"},
		{"text too long", coach.NoteInput{Kind: "note", Text: longText}, "4000"},
		{"focus outside vocabulary", coach.NoteInput{Kind: "note", FocusTags: []string{"tempo"}}, "focus"},
		{"focus wrong case", coach.NoteInput{Kind: "note", FocusTags: []string{"Comms"}}, "focus"},
		{"too many extras", coach.NoteInput{Kind: "note", ExtraTags: manyExtras}, "extra"},
		{"extra too long", coach.NoteInput{Kind: "note", ExtraTags: []string{strings.Repeat("a", 41)}}, "extra"},
		{"clock no colon", coach.NoteInput{Kind: "note", Text: "x", MatchClock: "0640"}, "clock"},
		{"clock seconds out of range", coach.NoteInput{Kind: "note", Text: "x", MatchClock: "06:60"}, "clock"},
		{"clock three-digit minutes", coach.NoteInput{Kind: "note", Text: "x", MatchClock: "106:40"}, "clock"},
		{"clock hours form", coach.NoteInput{Kind: "note", Text: "x", MatchClock: "1:06:40"}, "clock"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := coach.ValidateNoteInput(tc.in)
			if !errors.Is(err, coach.ErrNoteInvalid) {
				t.Fatalf("err = %v, want ErrNoteInvalid", err)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %q, want it to name %q", err, tc.want)
			}
		})
	}
}

func TestValidateNoteInput_NormalizesAndAccepts(t *testing.T) {
	tests := []struct {
		name string
		in   coach.NoteInput
		want coach.NoteInput
	}{
		{
			"trims text and clock, sorts and dedupes focus, dedupes extras case-insensitively",
			coach.NoteInput{Kind: "note", Text: "  hold the high ground \n", FocusTags: []string{"mental", "comms", "mental"}, ExtraTags: []string{" Tempo ", "tempo", "TEMPO", "", "pace"}, MatchClock: " 6:40 "},
			coach.NoteInput{Kind: "note", Text: "hold the high ground", FocusTags: []string{"comms", "mental"}, ExtraTags: []string{"Tempo", "pace"}, MatchClock: "6:40"},
		},
		{
			"tags alone make a note",
			coach.NoteInput{Kind: "note", FocusTags: []string{"cooldowns"}},
			coach.NoteInput{Kind: "note", Text: "", FocusTags: []string{"cooldowns"}, ExtraTags: []string{}, MatchClock: ""},
		},
		{
			"an extra tag alone makes a note",
			coach.NoteInput{Kind: "note", ExtraTags: []string{"tempo"}},
			coach.NoteInput{Kind: "note", Text: "", FocusTags: []string{}, ExtraTags: []string{"tempo"}, MatchClock: ""},
		},
		{
			"reviewed_only with only whitespace is clean",
			coach.NoteInput{Kind: "reviewed_only", Text: "  ", MatchClock: " "},
			coach.NoteInput{Kind: "reviewed_only", Text: "", FocusTags: []string{}, ExtraTags: []string{}, MatchClock: ""},
		},
		{
			"two-digit minutes clock",
			coach.NoteInput{Kind: "note", Text: "x", MatchClock: "12:05"},
			coach.NoteInput{Kind: "note", Text: "x", FocusTags: []string{}, ExtraTags: []string{}, MatchClock: "12:05"},
		},
		{
			"exactly 4000 runes of text",
			coach.NoteInput{Kind: "note", Text: strings.Repeat("é", 4000)},
			coach.NoteInput{Kind: "note", Text: strings.Repeat("é", 4000), FocusTags: []string{}, ExtraTags: []string{}, MatchClock: ""},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := coach.ValidateNoteInput(tc.in)
			if err != nil {
				t.Fatalf("ValidateNoteInput: %v", err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

// Tag slices are always non-nil so the wire carries [] rather than null.
func TestNote_JSONShape(t *testing.T) {
	n := coach.NoteFromCoachNote(db.CoachNote{
		NoteID: "a3f1c2d4-8e9b-4a7c-b6d5-1f2e3d4c5b6a", MatchKey: "match-2026-08-01T18-30-00",
		Kind: "note", Text: "hi", MatchClock: "06:40", UpdatedAt: "2026-08-14T19:02:00Z",
	}, nil)
	b, err := json.Marshal(n)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"note_id":"a3f1c2d4-8e9b-4a7c-b6d5-1f2e3d4c5b6a","match_key":"match-2026-08-01T18-30-00","kind":"note","text":"hi","focus_tags":[],"extra_tags":[],"match_clock":"06:40","updated_at":"2026-08-14T19:02:00Z"}`
	if string(b) != want {
		t.Errorf("json = %s\nwant   %s", b, want)
	}

	withCtx := coach.NoteFromCoachNote(db.CoachNote{NoteID: "x", Kind: "reviewed_only", FocusTags: []string{"comms"}},
		&coach.MatchContext{Map: "ilios", Hero: "ana", Result: "victory", Date: "2026-08-01", FinishedAt: "18:30"})
	b, _ = json.Marshal(withCtx)
	if !strings.Contains(string(b), `"match":{"map":"ilios","hero":"ana","result":"victory","date":"2026-08-01","finished_at":"18:30"}`) {
		t.Errorf("match context missing or misshapen: %s", b)
	}
	if !strings.Contains(string(b), `"focus_tags":["comms"]`) {
		t.Errorf("focus tags dropped: %s", b)
	}
}

func TestMatchCoachNoteFromNote_CarriesCoachAndSession(t *testing.T) {
	n := coach.Note{NoteID: "id-1", MatchKey: "match-2026-08-01T18-30-00", Kind: "note", Text: "t", FocusTags: []string{"comms"}, ExtraTags: []string{"tempo"}, MatchClock: "01:02"}
	got := coach.MatchCoachNoteFromNote(n, "Ordo", "2026-08-14")
	want := db.MatchCoachNote{NoteID: "id-1", MatchKey: "match-2026-08-01T18-30-00", CoachName: "Ordo", SessionDate: "2026-08-14", Text: "t", MatchClock: "01:02", FocusTags: []string{"comms"}, ExtraTags: []string{"tempo"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestNoteToRow_KeysOnPlayerAndMatch(t *testing.T) {
	in := coach.NoteInput{Kind: "note", Text: "t", FocusTags: []string{"comms"}, ExtraTags: []string{"tempo"}, MatchClock: "01:02"}
	got := coach.NoteToRow(7, "match-2026-08-01T18-30-00", in)
	want := db.CoachNote{PlayerRef: 7, MatchKey: "match-2026-08-01T18-30-00", Kind: "note", Text: "t", MatchClock: "01:02", FocusTags: []string{"comms"}, ExtraTags: []string{"tempo"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}
