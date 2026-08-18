package coach_test

import (
	"errors"
	"strings"
	"testing"

	"recall/pkg/coach"
)

// A moment is one timestamped observation inside a note: "3:23 — you didn't
// take the off-angle". The note already carried a single clock, which meant a
// coach with three things to say at three times had to pick one and write a
// paragraph. These are the rules that make several of them a list rather than
// a paragraph.

func TestValidateMoment_KeepsAWellFormedMoment(t *testing.T) {
	t.Parallel()

	got, err := coach.ValidateMomentInput(coach.MomentInput{
		MatchClock: " 4:45 ",
		Text:       "  Cassidy flanked behind you.  ",
		FocusTag:   "positioning",
	})
	if err != nil {
		t.Fatalf("valid moment rejected: %v", err)
	}
	if got.MatchClock != "04:45" {
		t.Errorf("clock should normalize to zero-padded MM:SS, got %q", got.MatchClock)
	}
	if got.Text != "Cassidy flanked behind you." {
		t.Errorf("text should be trimmed, got %q", got.Text)
	}
	if got.FocusTag != "positioning" {
		t.Errorf("focus tag should survive, got %q", got.FocusTag)
	}
}

// Empty text is refused too, with its OWN sentinel: the body parsed fine and
// the refusal is semantic, so the HTTP layer answers 409 rather than 400 —
// the same distinction an empty annotation already draws.
func TestValidateMoment_RefusesEmptyTextWithItsOwnError(t *testing.T) {
	t.Parallel()

	_, err := coach.ValidateMomentInput(coach.MomentInput{MatchClock: "4:45", Text: "   "})
	if !errors.Is(err, coach.ErrMomentEmpty) {
		t.Fatalf("want ErrMomentEmpty, got %v", err)
	}
}

// The clock is what makes a moment a moment. Unlike the note's optional one,
// this is required — a moment without a time is just a sentence, and the note
// it hangs on is already the place for those.
func TestValidateMoment_RequiresAClock(t *testing.T) {
	t.Parallel()

	_, err := coach.ValidateMomentInput(coach.MomentInput{Text: "No ult tracking."})
	if !errors.Is(err, coach.ErrNoteInvalid) {
		t.Fatalf("a clockless moment must be refused, got %v", err)
	}
	if !strings.Contains(err.Error(), "clock") {
		t.Errorf("the refusal should name the field, got %q", err.Error())
	}
}

func TestValidateMoment_RefusesWhatItCannotRead(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct{ name, clock, text, tag string }{
		{"three-digit minutes", "100:00", "x", ""},
		{"seconds past 59", "4:75", "x", ""},
		{"an hours form", "1:06:40", "x", ""},
		{"a bare number", "445", "x", ""},
		{"a tag outside the vocabulary", "4:45", "x", "vibes"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := coach.ValidateMomentInput(coach.MomentInput{
				MatchClock: tc.clock, Text: tc.text, FocusTag: tc.tag,
			})
			if !errors.Is(err, coach.ErrNoteInvalid) {
				t.Fatalf("want ErrNoteInvalid, got %v", err)
			}
		})
	}
}

// A moment is a sentence about one thing that happened. The note's own 4000
// runes are where an essay goes; a cap here keeps the strip readable.
func TestValidateMoment_CapsTheText(t *testing.T) {
	t.Parallel()

	_, err := coach.ValidateMomentInput(coach.MomentInput{
		MatchClock: "4:45",
		Text:       strings.Repeat("x", coach.MaxMomentTextRunes+1),
	})
	if !errors.Is(err, coach.ErrNoteInvalid) {
		t.Fatalf("an over-long moment must be refused, got %v", err)
	}
}

// The focus tag is optional: a coach who just wants to say what happened at
// 4:45 should not have to classify it first.
func TestValidateMoment_TagIsOptional(t *testing.T) {
	t.Parallel()

	if _, err := coach.ValidateMomentInput(coach.MomentInput{
		MatchClock: "4:45", Text: "Cassidy flanked behind you.",
	}); err != nil {
		t.Fatalf("a moment without a tag is valid, got %v", err)
	}
}

// Ordering is the strip's whole readability: it reads down the match. Two
// moments sharing a clock keep the order the coach wrote them in, which is the
// only signal available for which came first.
func TestSortMoments_ReadsDownTheMatch(t *testing.T) {
	t.Parallel()

	got := coach.SortMoments([]coach.Moment{
		{MomentID: "c", MatchClock: "12:05", SortOrder: 0},
		{MomentID: "a", MatchClock: "04:45", SortOrder: 1},
		{MomentID: "b", MatchClock: "04:45", SortOrder: 0},
		{MomentID: "d", MatchClock: "03:23", SortOrder: 9},
	})

	var order []string
	for _, m := range got {
		order = append(order, m.MomentID)
	}
	want := []string{"d", "b", "a", "c"}
	if len(order) != len(want) {
		t.Fatalf("want %v, got %v", want, order)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("want %v, got %v", want, order)
		}
	}
}

// "10:00" sorts before "9:00" as a string, and a review that reads out of
// order is worse than one that reads in a pile.
func TestSortMoments_OrdersByTimeNotByString(t *testing.T) {
	t.Parallel()

	got := coach.SortMoments([]coach.Moment{
		{MomentID: "late", MatchClock: "10:00"},
		{MomentID: "early", MatchClock: "09:00"},
	})

	if got[0].MomentID != "early" {
		t.Fatalf("9:00 comes before 10:00; got %q first", got[0].MomentID)
	}
}

// ── The notes file's schema, and what it promises an older build ──────────

// notesFileWithMoments is the suite's valid file, with the moments under test
// hung on its first note and the schema chosen the way the exporter chooses
// it.
func notesFileWithMoments(moments []coach.Moment) coach.NotesFile {
	f := validNotesFile()
	f.Notes[0].Moments = moments
	f.Schema = coach.NotesSchemaFor(f.Notes)
	return f
}

// A review with no moments is still v1, so a coach on this build can hand a
// file to a player on an older one and nothing breaks. That is the common
// case, and the one worth protecting.
func TestNotesFile_StaysV1WithoutMoments(t *testing.T) {
	t.Parallel()

	f := notesFileWithMoments(nil)

	if f.Schema != coach.NotesSchemaV1 {
		t.Errorf("a file with no moments should be %q, got %q", coach.NotesSchemaV1, f.Schema)
	}
	if err := coach.ValidateNotesFile(f); err != nil {
		t.Fatalf("valid v1 file rejected: %v", err)
	}
}

// With moments the file says v2 — so an older build refuses it by name rather
// than decoding it and silently dropping the half of the review that pointed
// at something.
func TestNotesFile_SaysV2WhenItCarriesMoments(t *testing.T) {
	t.Parallel()

	f := notesFileWithMoments([]coach.Moment{
		{MomentID: "m1", MatchClock: "03:23", Text: "no off-angle"},
	})

	if f.Schema != coach.NotesSchemaV2 {
		t.Errorf("a file with moments should be %q, got %q", coach.NotesSchemaV2, f.Schema)
	}
	if err := coach.ValidateNotesFile(f); err != nil {
		t.Fatalf("valid v2 file rejected: %v", err)
	}
}

// A v1 label over v2 content is the one shape that makes the schema's promise
// false — an older build would read it, believe it had the whole file, and
// drop every moment without saying so.
func TestNotesFile_RefusesV1LabelOverMoments(t *testing.T) {
	t.Parallel()

	f := notesFileWithMoments([]coach.Moment{
		{MomentID: "m1", MatchClock: "03:23", Text: "no off-angle"},
	})
	f.Schema = coach.NotesSchemaV1

	// 409, not 400: the file is readable and its contents are fine — the
	// label just promises less than it carries.
	err := coach.ValidateNotesFile(f)
	if !errors.Is(err, coach.ErrNotesSchemaMismatch) {
		t.Fatalf("want ErrNotesSchemaMismatch, got %v", err)
	}
	if !strings.Contains(err.Error(), "moments") {
		t.Errorf("the refusal should say what is wrong, got %q", err.Error())
	}
}

// Both readable schemas still import; an unknown one is still named.
func TestNotesFile_ReadsBothSchemas(t *testing.T) {
	t.Parallel()

	for _, schema := range []string{coach.NotesSchemaV1, coach.NotesSchemaV2} {
		f := notesFileWithMoments(nil)
		f.Schema = schema
		if err := coach.ValidateNotesFile(f); err != nil {
			t.Errorf("%s should still read, got %v", schema, err)
		}
	}
	f := notesFileWithMoments(nil)
	f.Schema = "recall-coach-notes/v9"
	if err := coach.ValidateNotesFile(f); !errors.Is(err, coach.ErrNotesUnsupportedSchema) {
		t.Fatalf("want ErrNotesUnsupportedSchema, got %v", err)
	}
}

// ── Accepting a review made of moments ────────────────────────────────────

// A reviewed_only mark carries nothing to keep — unless it carries moments,
// which is the shape a review made entirely of timestamps takes. Skipping the
// block for it threw the whole payload away on accept, silently, and then
// reported the note accepted.
func TestDecide_AcceptKeepsAReviewedOnlyNotesMoments(t *testing.T) {
	st := seededStore(t)
	// The shape a moments-only review produces: reviewed_only, no text, every
	// observation hanging off it as a moment.
	f := validNotesFile()
	f.Notes[1].Moments = []coach.Moment{
		{MomentID: "m1", MatchClock: "03:23", Text: "no off-angle"},
		{MomentID: "m2", MatchClock: "04:45", Text: "flanking Cassidy"},
	}
	f.Schema = coach.NotesSchemaFor(f.Notes)
	sheet := stageReturn(t, st, writeNotes(t, f), "Sable")

	decide(t, st, sheet.ID, coach.Decision{NoteID: noteIDTwo, Decision: coach.DecisionAccepted})

	block := blockWithNoteID(t, st, f.Notes[1].MatchKey, noteIDTwo)
	if len(block.Moments) != 2 {
		t.Fatalf("a moments-only review lost its moments on accept: %+v", block)
	}
	if block.Moments[0].MatchClock != "03:23" {
		t.Errorf("moments should land in reading order, got %q first", block.Moments[0].MatchClock)
	}
}
