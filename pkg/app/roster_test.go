package app_test

import (
	"errors"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// The roster's app layer is thin, and every rule in it is about the shape a
// UI can send: a blank tag, a blank name, whitespace either side.

func TestSaveRosterMember_DefaultsTheNameToTheTag(t *testing.T) {
	store := &dbtest.Fake{}
	a := app.NewWithStore(store)

	// An entry with no name shows nothing where the chip used to show the
	// tag, which is a worse outcome than not rostering them at all.
	mustNoErrApp(t, a.SaveRosterMember(db.RosterMember{Tag: "Zed#2100"}))

	got, err := a.Roster()
	mustNoErrApp(t, err)
	if len(got) != 1 || got[0].DisplayName != "Zed#2100" {
		t.Fatalf("roster = %+v, want the tag standing in for the name", got)
	}
}

func TestSaveRosterMember_TrimsEverySide(t *testing.T) {
	store := &dbtest.Fake{}
	a := app.NewWithStore(store)
	mustNoErrApp(t, a.SaveRosterMember(db.RosterMember{
		Tag: "  Zed#2100 ", DisplayName: " Zed ", Note: "  main tank ",
	}))

	got, err := a.Roster()
	mustNoErrApp(t, err)
	if len(got) != 1 {
		t.Fatalf("roster = %d rows, want 1", len(got))
	}
	// A tag with a stray space is a DIFFERENT identity from the one in a
	// match's members list, so it would never match anything.
	if got[0].Tag != "Zed#2100" || got[0].DisplayName != "Zed" || got[0].Note != "main tank" {
		t.Fatalf("roster row = %+v, want everything trimmed", got[0])
	}
}

func TestSaveRosterMember_RefusesABlankTag(t *testing.T) {
	a := app.NewWithStore(&dbtest.Fake{})
	// The tag IS the identity — a blank one has nothing to be, and a row
	// keyed on "" would silently claim every unnamed teammate.
	err := a.SaveRosterMember(db.RosterMember{Tag: "   ", DisplayName: "Zed"})
	if !errors.Is(err, app.ErrRosterTagEmpty) {
		t.Fatalf("err = %v, want ErrRosterTagEmpty", err)
	}
}

func mustNoErrApp(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
