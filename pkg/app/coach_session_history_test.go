package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// openBundleSession opens the shared test bundle and hands back the store,
// so each case below asserts on what the sitting recorded rather than on
// how it got there.
func sessionApp(t *testing.T) (*app.App, *dbtest.Fake) {
	t.Helper()
	a, store := coachApp(t)
	if _, err := a.OpenCoachSession(shareBundle(t)); err != nil {
		t.Fatalf("OpenCoachSession: %v", err)
	}
	return a, store
}

// The coach's sittings, recorded. Before this the database knew WHEN a coach
// worked only as each note's own timestamps, so a sitting that produced no
// notes left no trace and "what changed since last time" had no last time.

func TestCoachSession_OpeningRecordsTheSitting(t *testing.T) {
	_, fake := sessionApp(t)

	if len(fake.CoachSessions) != 1 {
		t.Fatalf("sessions = %+v, want the one just opened", fake.CoachSessions)
	}
	for _, row := range fake.CoachSessions {
		if row.OpenedAt == "" {
			t.Error("opened_at was not stamped")
		}
		if row.EndedAt != "" {
			t.Errorf("ended_at = %q while the session is open", row.EndedAt)
		}
		if row.Source != "bundle" {
			t.Errorf("source = %q, want bundle", row.Source)
		}
		if len(row.MatchKeys) == 0 {
			t.Error("the sitting recorded no matches")
		}
	}
}

// A bundle with no handle leaves the sitting unaddressed; naming the player
// files it, and correcting the name re-files it. The row is written at
// START, so it has to be able to learn this afterward.
func TestCoachSession_NamingThePlayerFilesTheSitting(t *testing.T) {
	a, fake := sessionApp(t)
	if _, err := a.SetCoachSessionPlayer("Kestrel", db.CoachKindPlayer); err != nil {
		t.Fatalf("SetCoachSessionPlayer: %v", err)
	}

	filed := 0
	for _, row := range fake.CoachSessions {
		if row.Handle == "Kestrel" && row.PlayerRef != 0 {
			filed++
		}
	}
	if filed != 1 {
		t.Errorf("sessions = %+v, want the sitting filed under Kestrel", fake.CoachSessions)
	}
}

func TestCoachSession_EndingStampsIt(t *testing.T) {
	a, fake := sessionApp(t)
	if err := a.CloseCoachSession(); err != nil {
		t.Fatalf("CloseCoachSession: %v", err)
	}

	for _, row := range fake.CoachSessions {
		if row.EndedAt == "" {
			t.Errorf("ended_at was not stamped on %+v", row)
		}
	}
}

// The freeze is a snapshot of what the list SAID, status included. It used
// to copy a status the coach's rows never stored, so every frozen item read
// back as ” — outside the FocusStatus enum the API publishes.
func TestCoachSession_EndingFreezesTheFocusListWithAStatus(t *testing.T) {
	a, fake := sessionApp(t)
	if _, err := a.SetCoachSessionPlayer("Kestrel", db.CoachKindPlayer); err != nil {
		t.Fatalf("SetCoachSessionPlayer: %v", err)
	}
	if err := a.PutCoachFocusItems([]coach.FocusItem{{ItemID: sessionFocusID, Text: "ult economy"}}); err != nil {
		t.Fatalf("PutCoachFocusItems: %v", err)
	}
	if err := a.CloseCoachSession(); err != nil {
		t.Fatalf("CloseCoachSession: %v", err)
	}

	for _, row := range fake.CoachSessions {
		if len(row.FocusItems) != 1 || row.FocusItems[0].Status != db.FocusNew {
			t.Errorf("frozen focus = %+v, want the one item frozen as %q", row.FocusItems, db.FocusNew)
		}
	}
}

// The coach's view carries each item's status rather than dropping it on
// the way to the wire.
func TestCoachSession_TheViewCarriesEachFocusStatus(t *testing.T) {
	a, _ := sessionApp(t)
	if _, err := a.SetCoachSessionPlayer("Kestrel", db.CoachKindPlayer); err != nil {
		t.Fatalf("SetCoachSessionPlayer: %v", err)
	}
	if err := a.PutCoachFocusItems([]coach.FocusItem{{ItemID: sessionFocusID, Text: "ult economy", Status: db.FocusDone}}); err != nil {
		t.Fatalf("PutCoachFocusItems: %v", err)
	}
	view, err := a.GetCoachSession()
	if err != nil {
		t.Fatalf("GetCoachSession: %v", err)
	}
	if len(view.FocusItems) != 1 || view.FocusItems[0].Status != db.FocusDone {
		t.Errorf("view focus = %+v, want the item done", view.FocusItems)
	}
}

// Closing the session is the coach handing the corpus back: ended.
func TestCoachSession_ClosingRecordsAnEndedSitting(t *testing.T) {
	a, fake := sessionApp(t)
	if err := a.CloseCoachSession(); err != nil {
		t.Fatalf("CloseCoachSession: %v", err)
	}
	for _, row := range fake.CoachSessions {
		if row.Status != db.SittingEnded {
			t.Errorf("status = %q, want %q", row.Status, db.SittingEnded)
		}
	}
}

// Quitting the app with a session open is not walking away from it: the
// sitting is recorded as interrupted, stamped, and its focus list frozen.
func TestCoachSession_QuittingTheAppRecordsAnInterruptedSitting(t *testing.T) {
	a, fake := sessionApp(t)
	if err := a.ServiceShutdown(); err != nil {
		t.Fatalf("ServiceShutdown: %v", err)
	}
	for _, row := range fake.CoachSessions {
		if row.Status != db.SittingInterrupted || row.EndedAt == "" {
			t.Errorf("sitting = %+v, want interrupted and stamped", row)
		}
	}
	if _, err := a.GetCoachSession(); !errors.Is(err, coach.ErrNoSession) {
		t.Errorf("GetCoachSession after shutdown = %v, want ErrNoSession", err)
	}
}

// Codes arrive one at a time over voice chat, and the sitting's history is
// what the dossier reads back. A code added after open used to grow only the
// in-memory reel, so the history said the sitting covered what it held at
// open.
func TestCoachSession_ACodeAddedAfterOpenReachesTheHistory(t *testing.T) {
	a, fake := coachApp(t)
	if _, err := a.OpenCoachReplaySession([]string{"ABC123"}); err != nil {
		t.Fatalf("OpenCoachReplaySession: %v", err)
	}
	if _, err := a.AddCoachSessionReplayCode("DEF456"); err != nil {
		t.Fatalf("AddCoachSessionReplayCode: %v", err)
	}

	for _, row := range fake.CoachSessions {
		if len(row.MatchKeys) != 2 || row.MatchKeys[1] != "replay-DEF456" {
			t.Errorf("history covers %v, want both codes in reel order", row.MatchKeys)
		}
	}
}

// historyFails refuses the sitting's history row.
type historyFails struct{ *dbtest.Fake }

func (historyFails) StartCoachSession(db.CoachSessionRow) error { return errors.New("disk full") }

// A sitting with no history row is a sitting nothing can ever be filed
// under: the player's name, the frozen focus list and the end all UPDATE a
// row that is not there. The open is refused rather than going ahead with a
// record that will silently stay empty.
func TestCoachSession_AnOpenWhoseHistoryCannotBeWrittenIsRefused(t *testing.T) {
	isolateInstall(t)
	a := app.NewWithStore(historyFails{Fake: dbtest.New()})

	if _, err := a.OpenCoachReplaySession([]string{"ABC123"}); err == nil {
		t.Fatal("the open went ahead with no history row")
	}
	if _, err := a.GetCoachSession(); !errors.Is(err, coach.ErrNoSession) {
		t.Errorf("GetCoachSession = %v, want the slot left free", err)
	}
}

// A history row that went missing mid-sitting is reported when the coach
// names the player, rather than the re-point quietly updating nothing.
func TestCoachSession_NamingThePlayerOfALostHistoryRowIsReported(t *testing.T) {
	a, fake := sessionApp(t)
	fake.CoachSessions = nil

	if _, err := a.SetCoachSessionPlayer("Kestrel", db.CoachKindPlayer); !errors.Is(err, db.ErrCoachSessionUnknown) {
		t.Errorf("SetCoachSessionPlayer = %v, want ErrCoachSessionUnknown", err)
	}
}

// Closing still closes when the history row has gone, and says that the
// sitting could not be recorded rather than claiming it was.
func TestCoachSession_ClosingALostHistoryRowClosesAndReportsIt(t *testing.T) {
	a, fake := sessionApp(t)
	fake.CoachSessions = nil

	if err := a.CloseCoachSession(); !errors.Is(err, db.ErrCoachSessionUnknown) {
		t.Errorf("CloseCoachSession = %v, want ErrCoachSessionUnknown", err)
	}
	if _, err := a.GetCoachSession(); !errors.Is(err, coach.ErrNoSession) {
		t.Errorf("GetCoachSession = %v, want the session closed all the same", err)
	}
}
