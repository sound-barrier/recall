package app_test

import (
	"errors"
	"strings"
	"testing"

	"recall/pkg/coach"
)

// Export packs the session's work into the archive the player imports.

func TestExportCoachNotes_PacksTheSessionsWork(t *testing.T) {
	a, _ := openSession(t)
	if _, err := a.PutCoachNote(playerMatchRialto, writtenNote()); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	mustNoErr(t, a.PutCoachSummary(sessionSummary))

	name, payload, err := a.ExportCoachNotes()
	mustNoErr(t, err)
	if !strings.HasPrefix(name, "recall-coach-notes-sable-") || !strings.HasSuffix(name, ".zip") {
		t.Errorf("archive name = %q, want recall-coach-notes-sable-<date>.zip", name)
	}
	if coach.SniffArchive(payload) != coach.ArchiveCoachNotes {
		t.Fatalf("the export does not sniff as a coach notes archive")
	}
	file, err := coach.ReadNotesArchive(payload)
	mustNoErr(t, err)
	assertExportedNotesFile(t, file)
}

// assertExportedNotesFile pins what the archive says about who wrote it,
// about whom, and what they wrote.
func assertExportedNotesFile(t *testing.T, file coach.NotesFile) {
	t.Helper()
	if file.CoachName != coachName || file.Player.Handle != playerHandle {
		t.Errorf("attribution = coach %q / player %q, want %q / %q",
			file.CoachName, file.Player.Handle, coachName, playerHandle)
	}
	if file.Summary != sessionSummary {
		t.Errorf("summary = %q, want %q", file.Summary, sessionSummary)
	}
	if len(file.Notes) != 1 {
		t.Fatalf("notes = %+v, want exactly one", file.Notes)
	}
	if file.Notes[0].Match == nil || file.Notes[0].Match.Map != "rialto" {
		t.Errorf("note match snapshot = %+v, want rialto", file.Notes[0].Match)
	}
}

// The ledger travels beside notes.json, and the app never reads it back.
func TestExportCoachNotes_CarriesTheHumanCopy(t *testing.T) {
	a, _ := openSession(t)
	if _, err := a.PutCoachNote(playerMatchRialto, writtenNote()); err != nil {
		t.Fatalf("PutCoachNote: %v", err)
	}
	_, payload, err := a.ExportCoachNotes()
	mustNoErr(t, err)
	if !strings.Contains(string(payload), "ledger.html") {
		t.Error("the archive carries no ledger.html")
	}
}

// Export refuses rather than shipping something the player cannot
// attribute or act on.
func TestExportCoachNotes_RefusesTheUnusableCases(t *testing.T) {
	t.Run("no coach name", func(t *testing.T) {
		a, _ := openSession(t)
		if _, err := a.SetCoachingSettings("", ""); err != nil {
			t.Fatalf("SetCoachingSettings: %v", err)
		}
		if _, _, err := a.ExportCoachNotes(); !errors.Is(err, coach.ErrCoachNameRequired) {
			t.Errorf("export without a coach name = %v, want coach.ErrCoachNameRequired", err)
		}
	})
	t.Run("nothing written yet", func(t *testing.T) {
		a, _ := openSession(t)
		if _, _, err := a.ExportCoachNotes(); !errors.Is(err, coach.ErrNothingToExport) {
			t.Errorf("export of an untouched session = %v, want coach.ErrNothingToExport", err)
		}
	})
	t.Run("player not confirmed", func(t *testing.T) {
		a, _ := coachApp(t)
		if _, err := a.OpenCoachSession(plainBundle(t)); err != nil {
			t.Fatalf("OpenCoachSession: %v", err)
		}
		if _, _, err := a.ExportCoachNotes(); !errors.Is(err, coach.ErrHandleRequired) {
			t.Errorf("export before confirming the player = %v, want coach.ErrHandleRequired", err)
		}
	})
}
