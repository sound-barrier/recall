package app

import (
	"fmt"

	"recall/pkg/bundle"
	"recall/pkg/coach"
	"recall/pkg/db"
)

// The player's side of the loop: a coach's notes archive comes back
// through the same Import… affordance the bundle uses, is staged as a
// return sheet, and the player accepts or skips each note individually.

// Import kinds — the discriminant of ImportOutcome.
const (
	// ImportKindBundle reports a merged Recall bundle.
	ImportKindBundle = "bundle"
	// ImportKindCoachNotes reports a staged coach notes archive.
	ImportKindCoachNotes = "coach_notes"
)

// ImportOutcome is what POST /imports produced. Kind is the discriminant:
// "bundle" carries the merge counts, "coach_notes" carries the staged
// return sheet the player decides on.
//
// The counts carry no omitempty on purpose: a bundle whose matches were
// all already present is the "Imported 0, skipped 12" case, and dropping
// the zeros would leave the client rendering an absent number.
type ImportOutcome struct {
	Kind     string             `json:"kind"`
	Imported int                `json:"imported"`
	Skipped  int                `json:"skipped"`
	Return   *coach.ReturnSheet `json:"return,omitempty"`
}

// ImportMatches accepts either archive a user can hand Recall, telling
// them apart by ZIP entry names before any JSON is parsed (so a hostile
// body cannot pick its own reader). A bundle MERGES into the live
// database, skipping keys that already exist; a coach notes archive is
// STAGED for per-note decisions and changes no match until the player
// accepts one — which is why notes are allowed on the read-only sample
// profile and a bundle still is not.
func (a *App) ImportMatches(payload []byte) (ImportOutcome, error) {
	if err := a.assertNoCoachSession(); err != nil {
		return ImportOutcome{}, err
	}
	if coach.SniffArchive(payload) == coach.ArchiveCoachNotes {
		return a.stageCoachNotes(payload)
	}
	summary, err := bundle.Import(a.store, payload)
	if err != nil {
		return ImportOutcome{}, err
	}
	return ImportOutcome{Kind: ImportKindBundle, Imported: summary.Imported, Skipped: summary.Skipped}, nil
}

// stageCoachNotes records the returned archive and renders its sheet. The
// same file imported twice stages once — the second import re-opens the
// sheet it already has, decisions intact.
func (a *App) stageCoachNotes(payload []byte) (ImportOutcome, error) {
	sheet, _, err := coach.Stage(a.store, payload, a.settingsSnapshot().PlayerHandle)
	if err != nil {
		return ImportOutcome{}, err
	}
	return ImportOutcome{Kind: ImportKindCoachNotes, Return: &sheet}, nil
}

// ListCoachReturns renders every staged return, newest first — the
// player's inbox. Undecided notes are what the Matches banner counts.
func (a *App) ListCoachReturns() ([]coach.ReturnSheet, error) {
	return coach.Sheets(a.store, a.settingsSnapshot().PlayerHandle)
}

// GetCoachReturn renders one staged return. db.ErrCoachReturnUnknown when
// id names none.
func (a *App) GetCoachReturn(id int64) (coach.ReturnSheet, error) {
	return coach.Sheet(a.store, id, a.settingsSnapshot().PlayerHandle)
}

// DecideCoachReturn applies the player's verdicts and returns the
// recomputed sheet. An accept writes the coach's block onto the match and
// marks it reviewed by coach; a skip removes a block an earlier accept
// wrote. The batch is validated whole before anything is written.
func (a *App) DecideCoachReturn(id int64, decisions []coach.Decision) (coach.ReturnSheet, error) {
	if err := a.assertNoCoachSession(); err != nil {
		return coach.ReturnSheet{}, err
	}
	return coach.Decide(a.store, id, decisions, a.settingsSnapshot().PlayerHandle)
}

// DeleteCoachReturn drops a staged return and its decisions. The blocks an
// earlier accept wrote onto matches stay — they are the player's notes
// now; DeleteMatchCoachNote removes those one at a time.
func (a *App) DeleteCoachReturn(id int64) error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	return a.store.DeleteCoachReturn(id)
}

// DeleteMatchCoachNote removes one accepted coach block from one of the
// player's matches — the "Remove this note" affordance in the journal. The
// note must be ON that match: a mismatched pair is
// db.ErrMatchCoachNoteUnknown rather than a delete of somebody else's row.
func (a *App) DeleteMatchCoachNote(matchKey string, id int64) error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	blocks, err := a.store.LoadMatchCoachNotes()
	if err != nil {
		return fmt.Errorf("coach: load accepted notes: %w", err)
	}
	if !hasCoachBlock(blocks[matchKey], id) {
		return fmt.Errorf("%w: note %d is not on %s", db.ErrMatchCoachNoteUnknown, id, matchKey)
	}
	return a.store.DeleteMatchCoachNote(id)
}

func hasCoachBlock(blocks []db.MatchCoachNote, id int64) bool {
	for _, b := range blocks {
		if b.ID == id {
			return true
		}
	}
	return false
}
