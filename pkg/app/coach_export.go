package app

import (
	"fmt"
	"time"

	"recall/pkg/coach"
)

// ExportCoachNotes packs the session's work into the archive the coach
// hands the player: notes.json (the machine copy the player's side
// ingests) plus ledger.html (the human copy nothing ever parses). Returns
// the download filename alongside the bytes.
//
// It refuses rather than shipping something unattributable:
// coach.ErrNoSession with none open, coach.ErrCoachNameRequired without a
// name in Settings, coach.ErrHandleRequired before the player is
// confirmed, and coach.ErrNothingToExport when there is no note and no
// summary yet.
func (a *App) ExportCoachNotes() (name string, payload []byte, err error) {
	a.coachMu.RLock()
	defer a.coachMu.RUnlock()
	s := a.coachSession
	if s == nil {
		return "", nil, coach.ErrNoSession
	}
	coachName := a.settingsSnapshot().CoachName
	if coachName == "" {
		return "", nil, coach.ErrCoachNameRequired
	}
	file, err := a.coachNotesFileLocked(coachName, time.Now())
	if err != nil {
		return "", nil, err
	}
	payload, err = coach.WriteNotesArchive(file, time.Now())
	if err != nil {
		return "", nil, err
	}
	return coach.ArchiveFileName(file.Player.Handle, file.SessionDate), payload, nil
}

// coachNotesFileLocked assembles the notes file for the open session. The
// caller holds coachMu and has already resolved the coach's name.
func (a *App) coachNotesFileLocked(coachName string, now time.Time) (coach.NotesFile, error) {
	s := a.coachSession
	playerRef := s.PlayerRef()
	if playerRef == 0 {
		return coach.NotesFile{}, coach.ErrHandleRequired
	}
	stored, err := a.store.LoadCoachNotes(playerRef)
	if err != nil {
		return coach.NotesFile{}, fmt.Errorf("coach: load notes: %w", err)
	}
	summary, _, err := a.store.LoadCoachSummary(playerRef)
	if err != nil {
		return coach.NotesFile{}, fmt.Errorf("coach: load summary: %w", err)
	}
	return coach.ExportNotes(s, coach.Notes(s, stored), summary, coachName, Version, now)
}
