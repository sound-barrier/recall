package app_test

import (
	"testing"

	"recall/pkg/app"
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
