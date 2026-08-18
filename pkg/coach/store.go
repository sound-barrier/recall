package coach

import (
	"fmt"
	"slices"
	"time"

	"recall/pkg/db"
)

// NoteStore is the coach-AUTHORED half of the store a session needs: the
// player row the notes hang off, the notes themselves, and the one summary
// per player. The received half lives behind ReturnStore — a session never
// touches it, and the split keeps that provable.
type NoteStore interface {
	EnsureCoachPlayer(playerID, handle string) (db.CoachPlayer, error)
	RenameCoachPlayer(id int64, handle string) error
	UpsertCoachNote(n db.CoachNote) (db.CoachNote, error)
	DeleteCoachNote(playerRef int64, matchKey string) error
	LoadCoachNotes(playerRef int64) (map[string]db.CoachNote, error)
	UpsertCoachNoteMoment(playerRef int64, m db.CoachNoteMoment) (db.CoachNoteMoment, error)
	DeleteCoachNoteMoment(playerRef int64, momentID string) error
	LoadCoachNoteMoments(playerRef int64) (map[string][]db.CoachNoteMoment, error)
	SetCoachSummary(playerRef int64, text string) error
	LoadCoachSummary(playerRef int64) (db.CoachSummary, bool, error)
}

// Notes renders the coach's stored notes for the session in the order the
// film reel shows them, so the session view and the exported file read the
// same way the coach worked. A note whose match is no longer in the bundle
// still travels — the coach wrote it, and dropping it silently would lose
// work — it simply carries no match context.
func Notes(s *Session, stored map[string]db.CoachNote, moments map[string][]db.CoachNoteMoment) []Note {
	notes := make([]Note, 0, len(stored))
	seen := make(map[string]bool, len(stored))
	for _, rec := range s.Records() {
		n, ok := stored[rec.MatchKey]
		if !ok {
			continue
		}
		seen[rec.MatchKey] = true
		notes = append(notes, withMoments(NoteFromCoachNote(n, s.MatchContextFor(rec.MatchKey)), moments))
	}
	orphans := make([]string, 0, len(stored)-len(seen))
	for key := range stored {
		if !seen[key] {
			orphans = append(orphans, key)
		}
	}
	slices.Sort(orphans)
	for _, key := range orphans {
		notes = append(notes, withMoments(NoteFromCoachNote(stored[key], nil), moments))
	}
	return notes
}

// withMoments hangs a note's moments on it, in the order the strip reads them.
// A note with none keeps a nil slice rather than an empty one — omitempty then
// keeps it out of the file entirely, which is what lets an older reader ignore
// a field it does not know.
func withMoments(n Note, moments map[string][]db.CoachNoteMoment) Note {
	rows := moments[n.NoteID]
	if len(rows) == 0 {
		return n
	}
	out := make([]Moment, 0, len(rows))
	for _, row := range rows {
		out = append(out, MomentFromRow(row))
	}
	n.Moments = SortMoments(out)
	return n
}

// ExportNotes assembles the notes file for a session. It refuses rather
// than shipping something the player's side would reject or could not
// attribute: no coach name, no confirmed handle, or nothing written yet.
func ExportNotes(s *Session, notes []Note, summary db.CoachSummary, coachName, recallVersion string, now time.Time) (NotesFile, error) {
	if coachName == "" {
		return NotesFile{}, ErrCoachNameRequired
	}
	if s.Player.Handle == "" {
		return NotesFile{}, ErrHandleRequired
	}
	if len(notes) == 0 && summary.Text == "" {
		return NotesFile{}, ErrNothingToExport
	}
	if notes == nil {
		notes = []Note{}
	}
	f := NotesFile{
		Schema:        NotesSchemaV1,
		ExportedAt:    now.UTC().Format(time.RFC3339),
		RecallVersion: recallVersion,
		CoachName:     coachName,
		// The message is the player's note TO the coach; it has no place
		// in the file traveling back.
		Player:      Player{ID: s.Player.ID, Handle: s.Player.Handle},
		SessionDate: SessionDate(now),
		Summary:     summary.Text,
		Notes:       notes,
	}
	if err := ValidateNotesFile(f); err != nil {
		return NotesFile{}, fmt.Errorf("export notes: %w", err)
	}
	return f, nil
}
