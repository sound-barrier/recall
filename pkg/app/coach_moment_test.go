package app_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"testing"

	"recall/pkg/coach"
	"recall/pkg/matchedit"
)

// notesFileFromArchive reads notes.json back out of an exported archive —
// the file the player's side will actually parse, rather than an in-process
// struct that never crossed a zip.
func notesFileFromArchive(t *testing.T, payload []byte) coach.NotesFile {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	mustNoErr(t, err)
	for _, f := range zr.File {
		if f.Name != "notes.json" {
			continue
		}
		rc, err := f.Open()
		mustNoErr(t, err)
		defer func() { _ = rc.Close() }()
		raw, err := io.ReadAll(rc)
		mustNoErr(t, err)
		var out coach.NotesFile
		mustNoErr(t, json.Unmarshal(raw, &out))
		return out
	}
	t.Fatal("the archive carries no notes.json")
	return coach.NotesFile{}
}

// The moment surface at the app layer — the seam between "the coach typed
// something" and "a row exists". Every one of these was untested when moments
// shipped, which is how three of the rules below were provably mutable
// without a single test noticing.

func stamp(clock, text string) coach.MomentInput {
	return coach.MomentInput{MatchClock: clock, Text: text}
}

// The point of moments: several observations on one match, which is exactly
// what the note alone could never carry.
func TestPutCoachMoment_SeveralOnOneMatch(t *testing.T) {
	a, _ := openSession(t)

	for _, m := range []coach.MomentInput{
		{MatchClock: "3:23", Text: "no off-angle", FocusTag: "positioning"},
		{MatchClock: "4:13", Text: "no ult tracking", FocusTag: "ult_economy"},
		{MatchClock: "4:45", Text: "flanking Cassidy"},
	} {
		if _, err := a.PutCoachMoment(playerMatchRialto, "", m); err != nil {
			t.Fatalf("PutCoachMoment(%s): %v", m.MatchClock, err)
		}
	}

	view, err := a.GetCoachSession()
	mustNoErr(t, err)
	notes := view.Notes
	if len(notes) != 1 {
		t.Fatalf("notes = %d, want one note holding the moments", len(notes))
	}
	got := notes[0].Moments
	if len(got) != 3 {
		t.Fatalf("moments = %d, want 3", len(got))
	}
	if got[0].MatchClock != "03:23" || got[2].MatchClock != "04:45" {
		t.Errorf("moments should read down the match, got %q…%q", got[0].MatchClock, got[2].MatchClock)
	}
	if got[0].FocusTag != "positioning" {
		t.Errorf("focus tag lost, got %q", got[0].FocusTag)
	}
}

// Stamping the first moment on an un-noted match opens the note for it, as a
// reviewed_only mark: the coach HAS reviewed that match, they just said so
// with a timestamp instead of a paragraph.
func TestPutCoachMoment_OpensAReviewedOnlyNote(t *testing.T) {
	a, _ := openSession(t)

	if _, err := a.PutCoachMoment(playerMatchRialto, "", stamp("4:45", "flanking Cassidy")); err != nil {
		t.Fatalf("PutCoachMoment: %v", err)
	}

	view, err := a.GetCoachSession()
	mustNoErr(t, err)
	notes := view.Notes
	if len(notes) != 1 || notes[0].Kind != coach.KindReviewedOnly {
		t.Fatalf("want one reviewed_only note, got %+v", notes)
	}
}

// An edit keeps the moment's identity AND its place. Writing the list length
// on every save sent a moment to the bottom of its tied group the moment its
// typo was fixed — and the wire carries only array order, so the stored
// position is the order the strip renders.
func TestPutCoachMoment_AnEditKeepsItsPlace(t *testing.T) {
	a, _ := openSession(t)
	ids := make([]string, 0, 3)
	for _, text := range []string{"first", "second", "third"} {
		saved, err := a.PutCoachMoment(playerMatchRialto, "", coach.MomentInput{MatchClock: "4:45", Text: text})
		mustNoErr(t, err)
		ids = append(ids, saved.MomentID)
	}

	edited, err := a.PutCoachMoment(playerMatchRialto, ids[0],
		coach.MomentInput{MatchClock: "4:45", Text: "first, corrected"})
	mustNoErr(t, err)
	if edited.MomentID != ids[0] {
		t.Fatalf("an edit minted a new id %q, want %q", edited.MomentID, ids[0])
	}

	view, err := a.GetCoachSession()
	mustNoErr(t, err)
	notes := view.Notes
	got := notes[0].Moments
	if len(got) != 3 || got[0].Text != "first, corrected" {
		t.Fatalf("an edit moved the moment out of place: %+v", got)
	}
}

func TestDeleteCoachMoment_LeavesTheNoteBehind(t *testing.T) {
	a, _ := openSession(t)
	saved, err := a.PutCoachMoment(playerMatchRialto, "", stamp("4:45", "flanking Cassidy"))
	mustNoErr(t, err)

	mustNoErr(t, a.DeleteCoachMoment(playerMatchRialto, saved.MomentID))
	// Idempotent — the autosave queue may retry.
	mustNoErr(t, a.DeleteCoachMoment(playerMatchRialto, saved.MomentID))

	view, err := a.GetCoachSession()
	mustNoErr(t, err)
	notes := view.Notes
	if len(notes) != 1 {
		t.Fatalf("the note should outlive its last moment, got %+v", notes)
	}
	if len(notes[0].Moments) != 0 {
		t.Errorf("moments = %+v, want none", notes[0].Moments)
	}
}

// The ceiling exists so a runaway client cannot make a note unrenderable. An
// EDIT to one already stored always fits, even at the cap.
func TestPutCoachMoment_CapsThemPerMatch(t *testing.T) {
	a, _ := openSession(t)
	var lastID string
	for i := range coach.MaxMomentsPerNote {
		saved, err := a.PutCoachMoment(playerMatchRialto, "", stamp("4:45", "moment"))
		if err != nil {
			t.Fatalf("moment %d rejected early: %v", i, err)
		}
		lastID = saved.MomentID
	}

	_, err := a.PutCoachMoment(playerMatchRialto, "", stamp("4:45", "one too many"))
	if !errors.Is(err, coach.ErrNoteInvalid) {
		t.Fatalf("want ErrNoteInvalid past the cap, got %v", err)
	}
	if _, err := a.PutCoachMoment(playerMatchRialto, lastID, stamp("4:46", "edited at the cap")); err != nil {
		t.Errorf("an edit at the cap must still fit, got %v", err)
	}
}

func TestPutCoachMoment_RefusesWhatItCannotRead(t *testing.T) {
	a, _ := openSession(t)

	// Empty text is its own sentinel because it answers with its own status:
	// the body parsed fine and the refusal is semantic, so it is a 409 the way
	// an empty annotation is, not a 400.
	for _, tc := range []struct {
		name, clock, text string
		want              error
	}{
		{"no clock", "", "says when?", coach.ErrNoteInvalid},
		{"three-digit minutes", "100:00", "x", coach.ErrNoteInvalid},
		{"no text", "4:45", "  ", coach.ErrMomentEmpty},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := a.PutCoachMoment(playerMatchRialto, "", stamp(tc.clock, tc.text)); !errors.Is(err, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, err)
			}
		})
	}
}

// A moment can only land on a match the session actually loaned, and only
// once the coach has said who the bundle is about — the same two gates the
// note write answers to.
func TestPutCoachMoment_GuardsTheSessionAndTheCorpus(t *testing.T) {
	a, _ := openSession(t)

	_, err := a.PutCoachMoment("match-2020-01-01T00-00-00", "", stamp("4:45", "not in the bundle"))
	if err == nil {
		t.Fatal("a match outside the loaned corpus must be refused")
	}

	mustNoErr(t, a.CloseCoachSession())
	if _, err := a.PutCoachMoment(playerMatchRialto, "", stamp("4:45", "no session")); err == nil {
		t.Fatal("a moment with no session open must be refused")
	}
}

// The moments travel with the note into the archive the player receives —
// the whole point of writing them.
func TestExportCoachNotes_CarriesTheMoments(t *testing.T) {
	a, _ := openSession(t)
	_, err := a.PutCoachMoment(playerMatchRialto, "", stamp("4:45", "flanking Cassidy"))
	mustNoErr(t, err)

	_, payload, err := a.ExportCoachNotes(testSheet)
	mustNoErr(t, err)
	file := notesFileFromArchive(t, payload)
	if len(file.Notes) != 1 || len(file.Notes[0].Moments) != 1 {
		t.Fatalf("the archive lost the moment: %+v", file.Notes)
	}
	if file.Schema != coach.NotesSchemaV1 {
		t.Errorf("notes.json schema = %q, want %q", file.Schema, coach.NotesSchemaV1)
	}
	if !strings.Contains(file.Notes[0].Moments[0].Text, "Cassidy") {
		t.Errorf("moment text lost: %+v", file.Notes[0].Moments[0])
	}
}

// Two packages spell the focus vocabulary out, and neither can import the
// other without dragging a leaf's whole dependency tree behind it: pkg/coach
// pulls bundle + aggregate + correlate, and the player's own edit layer has
// no business depending on any of that. So the copies stay, and this is what
// keeps them honest — a tag a coach can file a match under must be one the
// player can file the same match under, or a review reads as two vocabularies
// describing one game.
func TestFocusVocabulary_IsOneListInBothPackages(t *testing.T) {
	if !slices.Equal(coach.FocusTags, matchedit.FocusTags) {
		t.Errorf("coach.FocusTags = %v\nmatchedit.FocusTags = %v\nwant identical",
			coach.FocusTags, matchedit.FocusTags)
	}
}
