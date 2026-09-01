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
// confirmed, and coach.ErrNothingToExport when there is nothing written —
// no note and no focus item.
func (a *App) ExportCoachNotes(sheetHTML []byte) (name string, payload []byte, err error) {
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
	// The frames the notes point at travel WITH them. A digest the player's
	// database has never seen is a broken picture on their screen, and the
	// coach has no way to know — so the bytes go in the archive rather than
	// the reference going alone.
	file, images, err := a.withAttachedFrames(file)
	if err != nil {
		return "", nil, err
	}
	payload, err = coach.WriteNotesArchive(file, sheetHTML, images, time.Now())
	if err != nil {
		return "", nil, err
	}
	return coach.ArchiveFileName(file.Player.Handle, file.SessionDate), payload, nil
}

// withAttachedFrames gathers the frames a notes file names, and DROPS any
// reference whose bytes are gone.
//
// Both halves matter. A picture can be pruned between being attached and the
// review being sent, and a coach who cannot export because one frame went
// missing is worse off than one whose review arrives a frame short. But an
// archive that NAMES a frame it does not carry is a different thing: the
// reference lives inside notes.json, whose hash is the archive's identity, so
// the claim would travel while the bytes did not and the player would see a
// broken picture with no explanation. Clearing the reference keeps the
// archive honest about what it holds — which is why WriteNotesArchive is free
// to refuse the mismatch outright.
func (a *App) withAttachedFrames(f coach.NotesFile) (coach.NotesFile, map[string][]byte, error) {
	images := map[string][]byte{}
	for i := range f.Notes {
		for j := range f.Notes[i].Moments {
			sha := f.Notes[i].Moments[j].ImageSHA256
			if sha == "" {
				continue
			}
			img, ok, err := a.store.LoadMomentImage(sha)
			if err != nil {
				return coach.NotesFile{}, nil, fmt.Errorf("read attached frame: %w", err)
			}
			if !ok {
				f.Notes[i].Moments[j].ImageSHA256 = ""
				continue
			}
			images[sha] = img.Bytes
		}
	}
	return f, images, nil
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
	moments, err := a.store.LoadCoachNoteMoments(playerRef)
	if err != nil {
		return coach.NotesFile{}, fmt.Errorf("coach: load note moments: %w", err)
	}
	items, err := a.store.LoadCoachFocusItems(playerRef)
	if err != nil {
		return coach.NotesFile{}, fmt.Errorf("coach: load focus items: %w", err)
	}
	return coach.ExportNotes(s, coach.Notes(s, stored, moments), toWireFocusItems(items), coachName, Version, now)
}
