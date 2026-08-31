package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/db"
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

	if _, err := a.SetCoachSessionPlayer("Sable", ""); err != nil {
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
	if _, err := a.SetCoachSessionPlayer("Sable", ""); err != nil {
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

// A team is a codes-only identity: the session carries it like a player, the
// desk and sheet speak in its name, and everything written files under it.
func TestSetCoachSessionPlayer_ATeamRidesAReplaySession(t *testing.T) {
	a, _ := openReplaySession(t, "a1b2c3")

	view, err := a.SetCoachSessionPlayer("Sound Barrier", db.CoachKindTeam)
	if err != nil {
		t.Fatalf("SetCoachSessionPlayer(team): %v", err)
	}
	if view.Player.Kind != db.CoachKindTeam {
		t.Fatalf("view.Player.Kind = %q, want team", view.Player.Kind)
	}
}

// A bundle names its player — the manifest IS the identity — so a coach
// cannot re-file a bundle session under a team. The refusal is the API's,
// not just a hidden control: the correction path goes through here too.
func TestSetCoachSessionPlayer_ATeamOnABundleIsRefused(t *testing.T) {
	a, _ := coachApp(t)
	if _, err := a.OpenCoachSession(shareBundle(t)); err != nil {
		t.Fatalf("OpenCoachSession: %v", err)
	}

	_, err := a.SetCoachSessionPlayer("Sound Barrier", db.CoachKindTeam)

	if !errors.Is(err, coach.ErrBundleNamesPlayer) {
		t.Fatalf("SetCoachSessionPlayer(team on bundle) = %v, want ErrBundleNamesPlayer", err)
	}
}

// The chosen team shape is page-only: the notes FILE is a per-player
// artifact — import attributes purely by handle, so a team's shared review
// would land as a per-player return on anyone whose handle matches the
// team name. The backend refuses, not just the hidden button.
// A team review used to travel as the web page ONLY: the archive was
// declared a per-player artifact and refused. That left a captain who runs
// Recall with nothing to import — they could read the coach's words in a
// browser and then retype them, which is not a feature, and the open
// decision the team-session work left behind.
//
// The file carries an addressee now. It is signed as the TEAM's: no
// mismatch warning on the captain's side, and the block they accept says
// who it was written for.
func TestExportCoachNotes_ATeamReviewTravelsAsAFileToo(t *testing.T) {
	a, _ := openReplaySession(t, "a1b2c3")
	if _, err := a.SetCoachSessionPlayer("Sound Barrier", db.CoachKindTeam); err != nil {
		t.Fatalf("SetCoachSessionPlayer(team): %v", err)
	}
	if _, err := a.SetCoachingSettings("Ordo", ""); err != nil {
		t.Fatalf("SetCoachingSettings: %v", err)
	}
	if err := a.PutCoachFocusItems([]coach.FocusItem{
		{ItemID: "8f14e45f-ceea-467a-9c76-9c6b8f0e1c2d", Text: "Call the second ult before the first lands."},
	}); err != nil {
		t.Fatalf("PutCoachFocusItems: %v", err)
	}

	name, blob, err := a.ExportCoachNotes([]byte("<html></html>"))
	if err != nil {
		t.Fatalf("ExportCoachNotes(team) = %v, want a file", err)
	}
	if name == "" || len(blob) == 0 {
		t.Fatalf("ExportCoachNotes(team) produced %q / %d bytes", name, len(blob))
	}
}

// The dossier's "Read every note": everything ever written about one
// coached identity, newest first, replay notes included.
func TestListCoachPlayerNotes_ReadsTheDossierNewestFirst(t *testing.T) {
	a, _ := openReplaySession(t, "a1b2c3", "d4e5f6")
	if _, err := a.SetCoachSessionPlayer("Sable", ""); err != nil {
		t.Fatalf("SetCoachSessionPlayer: %v", err)
	}
	if _, err := a.PutCoachNote("replay-A1B2C3", coach.NoteInput{Kind: "note", Text: "first"}); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	if _, err := a.PutCoachNote("replay-D4E5F6", coach.NoteInput{Kind: "note", Text: "second"}); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	roster, err := a.ListCoachPlayers()
	if err != nil || len(roster) != 1 {
		t.Fatalf("roster = %v, %v", roster, err)
	}

	notes, err := a.ListCoachPlayerNotes(roster[0].ID)
	if err != nil {
		t.Fatalf("ListCoachPlayerNotes: %v", err)
	}
	if len(notes) != 2 {
		t.Fatalf("notes = %d, want 2", len(notes))
	}
	if notes[0].UpdatedAt < notes[1].UpdatedAt {
		t.Fatalf("not newest first: %q then %q", notes[0].UpdatedAt, notes[1].UpdatedAt)
	}
}

func TestListCoachPlayerNotes_UnknownPlayerIsNotFound(t *testing.T) {
	a, _ := coachApp(t)
	if _, err := a.ListCoachPlayerNotes(999); !errors.Is(err, db.ErrCoachPlayerUnknown) {
		t.Fatalf("ListCoachPlayerNotes(999) = %v, want ErrCoachPlayerUnknown", err)
	}
}
