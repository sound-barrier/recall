package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/db/dbtest"
)

// openReplaySession opens a code-only session on a fresh coach App.
func openReplaySession(t *testing.T, codes ...string) (*app.App, *dbtest.Fake) {
	t.Helper()
	a, store := coachApp(t)
	if _, err := a.OpenCoachReplaySession(codes); err != nil {
		t.Fatalf("OpenCoachReplaySession: %v", err)
	}
	return a, store
}

// The end-to-end shape of the feature: six characters in, a session a coach
// can write notes about out. This is the assertion Phase 4's widened gate
// could not make on its own — nothing could mint a replay key yet.
func TestOpenCoachReplaySession_LetsACoachWriteAboutAReplay(t *testing.T) {
	a, _ := openReplaySession(t, "a1b2c3")

	if _, err := a.SetCoachSessionPlayer("Sable"); err != nil {
		t.Fatalf("SetCoachSessionPlayer: %v", err)
	}
	note, err := a.PutCoachNote("replay-A1B2C3", coach.NoteInput{
		Kind: "note", Text: "held the choke too long", FocusTags: []string{"positioning"},
	})
	if err != nil {
		t.Fatalf("PutCoachNote on a replay match: %v", err)
	}
	if note.MatchKey != "replay-A1B2C3" {
		t.Fatalf("note = %+v, want one about replay-A1B2C3", note)
	}
}

// The room asks who this is about, exactly as it does for a bundle with no
// handle. A replay session carries no identity, so the first write is refused
// until the coach answers — one prompt, not a second one bolted on.
func TestOpenCoachReplaySession_RefusesANoteBeforeTheCoachNamesThePlayer(t *testing.T) {
	a, _ := openReplaySession(t, "A1B2C3")

	_, err := a.PutCoachNote("replay-A1B2C3", coach.NoteInput{Kind: "note", Text: "x"})
	if !errors.Is(err, coach.ErrHandleRequired) {
		t.Fatalf("err = %v, want ErrHandleRequired", err)
	}
}

// Design rule 1 does not bend for the new door: a session freezes the coach's
// own database whichever way it was opened.
func TestOpenCoachReplaySession_FreezesTheCoachsOwnWrites(t *testing.T) {
	a, _ := openReplaySession(t, "A1B2C3")

	err := a.SetMatchAnnotation(app.AnnotationInput{MatchKey: "match-2026-01-01T00-00-00", Note: "my own match"})
	if !errors.Is(err, coach.ErrSessionActive) {
		t.Fatalf("err = %v, want ErrSessionActive — a replay session locks writes like any other", err)
	}
}

// One session slot, whichever door was used.
func TestOpenCoachReplaySession_RefusesWhenASessionIsAlreadyOpen(t *testing.T) {
	a, _ := openReplaySession(t, "A1B2C3")

	if _, err := a.OpenCoachReplaySession([]string{"D4E5F6"}); !errors.Is(err, coach.ErrSessionActive) {
		t.Errorf("second replay session: err = %v, want ErrSessionActive", err)
	}
	if _, err := a.OpenCoachSession(shareBundle(t)); !errors.Is(err, coach.ErrSessionActive) {
		t.Errorf("bundle session over a replay session: err = %v, want ErrSessionActive", err)
	}
}

func TestAddCoachSessionReplayCode_GrowsTheReel(t *testing.T) {
	a, _ := openReplaySession(t, "A1B2C3")

	view, err := a.AddCoachSessionReplayCode("d4e5f6")
	if err != nil {
		t.Fatalf("AddCoachSessionReplayCode: %v", err)
	}
	if view.MatchCount != 2 {
		t.Errorf("MatchCount = %d, want 2", view.MatchCount)
	}
}

func TestSetCoachSessionMatchContext_RidesToThePlayerInTheNote(t *testing.T) {
	a, _ := openReplaySession(t, "A1B2C3")
	if _, err := a.SetCoachSessionPlayer("Sable"); err != nil {
		t.Fatalf("SetCoachSessionPlayer: %v", err)
	}
	if _, err := a.SetCoachSessionMatchContext("replay-A1B2C3", coach.ObservedContext{
		Map: "ilios", Hero: "ana", Result: "defeat",
	}); err != nil {
		t.Fatalf("SetCoachSessionMatchContext: %v", err)
	}

	note, err := a.PutCoachNote("replay-A1B2C3", coach.NoteInput{Kind: "note", Text: "rotate earlier"})
	if err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	got := note.Match
	if got == nil {
		t.Fatal("the note carries no match context")
	}
	if got.Map != "ilios" || got.Hero != "ana" || got.Result != "defeat" {
		t.Errorf("context = %+v, want what the coach observed", got)
	}
	// Without the code the player's side cannot tell which replay this note
	// is about, and the match it would create would be anonymous.
	if got.ReplayCode != "A1B2C3" {
		t.Errorf("ReplayCode = %q, want A1B2C3", got.ReplayCode)
	}
}

func TestSetCoachSessionMatchContext_RefusesWithNoSession(t *testing.T) {
	a, _ := coachApp(t)
	if _, err := a.SetCoachSessionMatchContext("replay-A1B2C3", coach.ObservedContext{}); !errors.Is(err, coach.ErrNoSession) {
		t.Errorf("err = %v, want ErrNoSession", err)
	}
}
