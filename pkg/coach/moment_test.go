package coach_test

import (
	"errors"
	"fmt"
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

// ── The notes file's schema ───────────────────────────────────────────────

// notesFileWithMoments is the suite's valid file with the moments under test
// hung on its first note.
func notesFileWithMoments(moments []coach.Moment) coach.NotesFile {
	f := validNotesFile()
	f.Notes[0].Moments = moments
	return f
}

// One schema, and it includes moments.
func TestNotesFile_ReadsAFileCarryingMoments(t *testing.T) {
	t.Parallel()

	f := notesFileWithMoments([]coach.Moment{
		{MomentID: "m1", MatchClock: "03:23", Text: "no off-angle"},
	})

	// No assertion on f.Schema here: validNotesFile() sets it, so checking it
	// would be the fixture checking itself. What matters is that the READER
	// takes a file carrying moments.
	if err := coach.ValidateNotesFile(f); err != nil {
		t.Fatalf("a file carrying moments was rejected: %v", err)
	}
}

// ── The hostile notes.json ────────────────────────────────────────────────

// The moments inside an imported file answer to the same rules a live write
// does, and until now nothing said so: deleting the whole validateFileMoments
// call left every Go test in the repo green.
//
// This is the file the threat model is about. A hand-edited notes.json is
// exactly how a clock that is not a clock, a tag outside the vocabulary, or
// five hundred rows sharing one id would land verbatim in the player's
// database and then out again through GET /matches — in violation of the
// schema that endpoint publishes. The received table carries no CHECK of its
// own precisely because it trusts this validator.
func TestNotesFile_RefusesHostileMoments(t *testing.T) {
	t.Parallel()

	tooMany := make([]coach.Moment, coach.MaxMomentsPerNote+1)
	for i := range tooMany {
		tooMany[i] = coach.Moment{MomentID: fmt.Sprintf("m%d", i), MatchClock: "03:23", Text: "x"}
	}

	for _, tc := range []struct {
		name    string
		moments []coach.Moment
	}{
		{"past the per-note cap", tooMany},
		{"no moment_id", []coach.Moment{{MatchClock: "03:23", Text: "x"}}},
		{"two moments sharing an id", []coach.Moment{
			{MomentID: "dup", MatchClock: "03:23", Text: "x"},
			{MomentID: "dup", MatchClock: "04:45", Text: "y"},
		}},
		{"a clock that is not a clock", []coach.Moment{
			{MomentID: "m1", MatchClock: "half past three", Text: "x"}}},
		{"a tag outside the vocabulary", []coach.Moment{
			{MomentID: "m1", MatchClock: "03:23", Text: "x", FocusTag: "vibes"}}},
		{"no text", []coach.Moment{{MomentID: "m1", MatchClock: "03:23", Text: "   "}}},
		{"text past the cap", []coach.Moment{
			{MomentID: "m1", MatchClock: "03:23", Text: strings.Repeat("x", coach.MaxMomentTextRunes+1)}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			f := notesFileWithMoments(tc.moments)
			if err := coach.ValidateNotesFile(f); !errors.Is(err, coach.ErrNotesMalformed) {
				t.Fatalf("want ErrNotesMalformed, got %v", err)
			}
		})
	}
}

// ── Accepting a review made of moments ────────────────────────────────────

// A reviewed_only mark carries nothing to keep — unless it carries moments,
// which is the shape a review made entirely of timestamps takes. Skipping the
// block for it threw the whole payload away on accept, silently, and then
// reported the note accepted.
