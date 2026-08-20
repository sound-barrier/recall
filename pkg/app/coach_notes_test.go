package app_test

import (
	"errors"
	"strings"
	"testing"

	"recall/pkg/app"
	"recall/pkg/bundle"
	"recall/pkg/coach"
	"recall/pkg/db/dbtest"
)

// The note surface: who a session is about, which matches a note may
// target, and the resurfacing that makes the coach's work worth keeping.

// A bundle that names its player resolves them on open, so notes written
// in an earlier session are already on the view.
func TestCoachSession_ResurfacesEarlierNotes(t *testing.T) {
	a, store := coachApp(t)
	payload := shareBundle(t)
	if _, err := a.OpenCoachSession(payload); err != nil {
		t.Fatalf("first open: %v", err)
	}
	if _, err := a.PutCoachNote(playerMatchRialto, writtenNote()); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	mustNoErr(t, a.PutCoachFocusItems([]coach.FocusItem{{ItemID: sessionFocusID, Text: sessionFocus}}))
	mustNoErr(t, a.CloseCoachSession())

	view, err := a.OpenCoachSession(payload)
	mustNoErr(t, err)
	if len(view.Notes) != 1 || view.Notes[0].MatchKey != playerMatchRialto {
		t.Fatalf("second open notes = %+v, want the earlier note on %s", view.Notes, playerMatchRialto)
	}
	if len(view.FocusItems) != 1 || view.FocusItems[0].Text != sessionFocus {
		t.Errorf("second open focus items = %+v, want %q", view.FocusItems, sessionFocus)
	}
	if view.CoachName != coachName {
		t.Errorf("view coach_name = %q, want %q", view.CoachName, coachName)
	}
	if len(store.CoachPlayers) != 1 {
		t.Errorf("player rows = %d, want one reused row", len(store.CoachPlayers))
	}
}

// A note carries the match's descriptive snapshot so the reel can render
// it, and the view reports the loaned corpus faithfully.
func TestCoachSession_ViewDescribesTheLoanedCorpus(t *testing.T) {
	a, _ := openSession(t)
	note, err := a.PutCoachNote(playerMatchRialto, writtenNote())
	mustNoErr(t, err)
	if note.Match == nil || note.Match.Map != "rialto" {
		t.Errorf("note match context = %+v, want rialto", note.Match)
	}
	if !coach.IsUUID(note.NoteID) {
		t.Errorf("note_id = %q, want a UUID", note.NoteID)
	}
	view, err := a.GetCoachSession()
	mustNoErr(t, err)
	if view.MatchCount != 3 {
		t.Errorf("match_count = %d, want the fixture's 3", view.MatchCount)
	}
	if view.Player.Handle != playerHandle || !view.HandleFromBundle {
		t.Errorf("player = %+v (from bundle %v), want %s from the bundle", view.Player, view.HandleFromBundle, playerHandle)
	}
}

// A bundle whose manifest was hand-edited to carry an id no export would
// write is refused at the door — the coach's store must never learn an
// identity their own notes file would later reject, which would block their
// export with no way back.
func TestCoachSession_RefusesATamperedPlayerIdentity(t *testing.T) {
	a, store := coachApp(t)
	if _, err := a.OpenCoachSession(tamperedShareBundle(t)); !errors.Is(err, bundle.ErrPlayerIdentityInvalid) {
		t.Fatalf("OpenCoachSession(tampered) = %v, want bundle.ErrPlayerIdentityInvalid", err)
	}
	if len(store.CoachPlayers) != 0 {
		t.Errorf("a refused bundle wrote player rows: %+v", store.CoachPlayers)
	}
	if _, err := a.GetCoachSession(); !errors.Is(err, coach.ErrNoSession) {
		t.Errorf("a refused bundle left a session open: %v", err)
	}
}

// A note may only name a match that is in this session.
func TestCoachSession_NoteOnAForeignMatchIsRefused(t *testing.T) {
	a, _ := openSession(t)
	cases := map[string]string{
		"a match this session never loaned": coachOwnMatch,
		"an ambiguous sentinel":             "ambiguous-c3RyYXkucG5n",
		"an unmatched sentinel":             "unmatched-c3RyYXkucG5n",
	}
	for name, key := range cases {
		if _, err := a.PutCoachNote(key, writtenNote()); !errors.Is(err, coach.ErrMatchNotInSession) {
			t.Errorf("PutCoachNote on %s = %v, want coach.ErrMatchNotInSession", name, err)
		}
	}
}

// An anonymous bundle has no player until the coach confirms one, and no
// note can be written before that.
func TestCoachSession_AnonymousBundleNeedsAHandleFirst(t *testing.T) {
	a, store := coachApp(t)
	view, err := a.OpenCoachSession(plainBundle(t))
	mustNoErr(t, err)
	if view.HandleFromBundle || view.Player.Handle != "" {
		t.Fatalf("a plain bundle should carry no handle, got %+v", view.Player)
	}
	if _, err := a.PutCoachNote(playerMatchRialto, writtenNote()); !errors.Is(err, coach.ErrHandleRequired) {
		t.Errorf("PutCoachNote before a handle = %v, want coach.ErrHandleRequired", err)
	}
	if err := a.PutCoachFocusItems(nil); !errors.Is(err, coach.ErrHandleRequired) {
		t.Errorf("PutCoachFocusItems before a handle = %v, want coach.ErrHandleRequired", err)
	}
	confirmed, err := a.SetCoachSessionPlayer("  Kestrel  ")
	mustNoErr(t, err)
	if confirmed.Player.Handle != "Kestrel" {
		t.Errorf("confirmed handle = %q, want the trimmed %q", confirmed.Player.Handle, "Kestrel")
	}
	if _, err := a.PutCoachNote(playerMatchRialto, writtenNote()); err != nil {
		t.Errorf("PutCoachNote after confirming a handle: %v", err)
	}
	if len(store.CoachPlayers) != 1 || store.CoachPlayers[0].Handle != "Kestrel" {
		t.Errorf("player rows = %+v, want one Kestrel", store.CoachPlayers)
	}
}

// Correcting the handle on an id-bearing bundle renames the SAME player —
// the id is the identity, the handle is a label — so the notes stay put.
func TestCoachSession_CorrectingTheHandleKeepsTheNotes(t *testing.T) {
	a, store := coachApp(t)
	if _, err := a.OpenCoachSession(shareBundle(t)); err != nil {
		t.Fatalf("OpenCoachSession: %v", err)
	}
	if _, err := a.PutCoachNote(playerMatchRialto, writtenNote()); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	view, err := a.SetCoachSessionPlayer("Sable#2187")
	mustNoErr(t, err)
	if len(view.Notes) != 1 {
		t.Errorf("notes after a rename = %+v, want the one already written", view.Notes)
	}
	if len(store.CoachPlayers) != 1 || store.CoachPlayers[0].Handle != "Sable#2187" {
		t.Errorf("player rows = %+v, want one renamed row", store.CoachPlayers)
	}
}

// A handle has to be a handle.
func TestCoachSession_RejectsAnUnusableHandle(t *testing.T) {
	a, _ := openSession(t)
	for name, handle := range map[string]string{
		"blank":      "   ",
		"empty":      "",
		"over-long":  strings.Repeat("x", 65),
		"whitespace": "\t\n",
	} {
		if _, err := a.SetCoachSessionPlayer(handle); !errors.Is(err, coach.ErrHandleInvalid) {
			t.Errorf("SetCoachSessionPlayer(%s) = %v, want coach.ErrHandleInvalid", name, err)
		}
	}
}

// Deleting a note is the autosave path's "the draft went empty" call.
func TestCoachSession_DeleteNoteClearsTheDraft(t *testing.T) {
	a, _ := openSession(t)
	if _, err := a.PutCoachNote(playerMatchRialto, writtenNote()); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	mustNoErr(t, a.DeleteCoachNote(playerMatchRialto))
	view, err := a.GetCoachSession()
	mustNoErr(t, err)
	if len(view.Notes) != 0 {
		t.Errorf("notes after delete = %+v, want none", view.Notes)
	}
	// Idempotent — a second delete is a no-op, not a 404.
	mustNoErr(t, a.DeleteCoachNote(playerMatchRialto))
}

// Every note surface reports "no session" rather than acting on nothing.
func TestCoachSession_NoteSurfaceNeedsASession(t *testing.T) {
	isolateInstall(t)
	a := app.NewWithStore(dbtest.New())
	_, noteErr := a.PutCoachNote(playerMatchRialto, writtenNote())
	_, playerErr := a.SetCoachSessionPlayer("Sable")
	_, matchesErr := a.GetCoachSessionMatches()
	_, _, exportErr := a.ExportCoachNotes()
	for name, err := range map[string]error{
		"PutCoachNote":           noteErr,
		"DeleteCoachNote":        a.DeleteCoachNote(playerMatchRialto),
		"PutCoachFocusItems":     a.PutCoachFocusItems(nil),
		"SetCoachSessionPlayer":  playerErr,
		"GetCoachSessionMatches": matchesErr,
		"ExportCoachNotes":       exportErr,
	} {
		if !errors.Is(err, coach.ErrNoSession) {
			t.Errorf("%s with no session = %v, want coach.ErrNoSession", name, err)
		}
	}
}

// A malformed payload never opens a session.
func TestCoachSession_MalformedPayloadOpensNothing(t *testing.T) {
	a, _ := coachApp(t)
	if _, err := a.OpenCoachSession([]byte("not a zip")); err == nil {
		t.Fatal("OpenCoachSession accepted a non-bundle payload")
	}
	if _, err := a.GetCoachSession(); !errors.Is(err, coach.ErrNoSession) {
		t.Errorf("GetCoachSession after a failed open = %v, want coach.ErrNoSession", err)
	}
}

// A coach's notes archive is not a bundle — opening one as a session names
// the mistake instead of failing on a schema.
func TestCoachSession_NotesArchiveIsNotABundle(t *testing.T) {
	payload := notesArchive(t)
	a, _ := coachApp(t)
	if _, err := a.OpenCoachSession(payload); !errors.Is(err, coach.ErrNotABundle) {
		t.Errorf("OpenCoachSession(notes archive) = %v, want coach.ErrNotABundle", err)
	}
}
