package coach

import (
	"fmt"
	"strings"

	"recall/pkg/db"
	"recall/pkg/matchedit"
)

// ReturnStore is the player-side persistence a returned notes file needs:
// the tracked-key registry to tell orphans apart, the review flag and the
// coach-received blocks an accept writes, and the staged returns with
// their decisions. db.Store satisfies it; dbtest.Fake mirrors it.
type ReturnStore interface {
	LoadMatchKeys() (map[string]bool, error)
	LoadReviews() (map[string]db.ReviewState, error)
	SetReview(matchKey, reviewedBy string) error
	UpsertMatchCoachNote(n db.MatchCoachNote) (int64, error)
	LoadMatchCoachNotes() (map[string][]db.MatchCoachNote, error)
	DeleteMatchCoachNote(id int64) error
	InsertCoachReturn(r db.CoachReturn) (int64, error)
	LookupCoachReturnByHash(hash string) (db.CoachReturn, bool, error)
	LoadCoachReturns() ([]db.CoachReturn, error)
	LoadCoachReturn(id int64) (db.CoachReturn, bool, error)
	SetCoachReturnDecision(returnID int64, noteID, decision string) error
	DeleteCoachReturn(id int64) error
}

// Decision values the player records against a staged note.
const (
	DecisionAccepted = "accepted"
	DecisionSkipped  = "skipped"
)

// Statuses a note on the return sheet can be in. Pending is derived, never
// stored: undecided and decidable.
const (
	StatusPending  = "pending"
	StatusAccepted = "accepted"
	StatusSkipped  = "skipped"
	StatusOrphan   = "orphan"
)

// reviewedByCoach is the match_reviews value an accept writes — the coach
// overwrites a self review (rule 11). The word is matchedit's, so the
// self-review finish that must NOT overwrite it compares the same constant.
const reviewedByCoach = matchedit.ReviewedByCoach

// ReturnSheet is one staged notes file as GET /coach/returns renders it:
// the header, every note with its status, and the decisions so far.
type ReturnSheet struct {
	ID           int64        `json:"id"`
	CoachName    string       `json:"coach_name"`
	PlayerHandle string       `json:"player_handle"`
	SessionDate  string       `json:"session_date"`
	ImportedAt   string       `json:"imported_at"`
	Summary      string       `json:"summary"`
	Notes        []ReturnItem `json:"notes"`
	// Decisions is keyed by note_id; a note with no entry is undecided.
	Decisions map[string]string `json:"decisions"`
	// Pending counts the notes still awaiting a decision (orphans excluded).
	Pending int `json:"pending"`
	// PlayerMismatch flags a file written about someone else — the local
	// handle is set and differs from the file's.
	PlayerMismatch bool `json:"player_mismatch"`
}

// ReturnItem is one note on the sheet: the note as the file carries it plus
// its derived status.
type ReturnItem struct {
	Note
	Status string `json:"status"`
}

// Decision is one entry of the PUT /coach/returns/{id}/decisions body.
type Decision struct {
	NoteID   string `json:"note_id"`
	Decision string `json:"decision"`
}

// Stage imports a notes archive on the player's side: reads and validates
// it, and either returns the sheet already staged for the same file
// (alreadyStaged=true) or stages it. A file with nothing to show — no
// summary, and no note about a match in this history — is
// ErrReturnNoMatches and is not staged; a summary alone is enough, because
// a coach may end a session having written only that.
func Stage(st ReturnStore, payload []byte, localHandle string) (sheet ReturnSheet, alreadyStaged bool, err error) {
	f, raw, err := readNotesArchive(payload)
	if err != nil {
		return ReturnSheet{}, false, err
	}
	hash := ContentHash(raw)
	if existing, ok, err := st.LookupCoachReturnByHash(hash); err != nil {
		return ReturnSheet{}, false, fmt.Errorf("coach: look up staged return: %w", err)
	} else if ok {
		sheet, err := buildSheet(st, existing, localHandle)
		return sheet, true, err
	}
	keys, err := st.LoadMatchKeys()
	if err != nil {
		return ReturnSheet{}, false, fmt.Errorf("coach: load match keys: %w", err)
	}
	if strings.TrimSpace(f.Summary) == "" && !anyLocalNote(f.Notes, keys) {
		return ReturnSheet{}, false, nothingToStage(f.Notes)
	}
	id, err := st.InsertCoachReturn(db.CoachReturn{
		ContentHash: hash, CoachName: f.CoachName, PlayerHandle: f.Player.Handle,
		SessionDate: f.SessionDate, NotesJSON: raw,
	})
	if err != nil {
		return ReturnSheet{}, false, fmt.Errorf("coach: stage return: %w", err)
	}
	sheet, err = Sheet(st, id, localHandle)
	return sheet, false, err
}

// nothingToStage names which of the two empty cases the refused file is, so
// the player reads why their archive was turned away rather than a generic
// "no matches".
func nothingToStage(notes []Note) error {
	if len(notes) == 0 {
		return fmt.Errorf("%w: it carries no notes and no summary", ErrReturnNoMatches)
	}
	return fmt.Errorf("%w: none of its %d notes name a match you have, and it carries no summary", ErrReturnNoMatches, len(notes))
}

func anyLocalNote(notes []Note, keys map[string]bool) bool {
	for _, n := range notes {
		if keys[n.MatchKey] {
			return true
		}
	}
	return false
}

// Sheet renders one staged return. db.ErrCoachReturnUnknown when id names
// no return.
func Sheet(st ReturnStore, id int64, localHandle string) (ReturnSheet, error) {
	r, ok, err := st.LoadCoachReturn(id)
	if err != nil {
		return ReturnSheet{}, fmt.Errorf("coach: load return %d: %w", id, err)
	}
	if !ok {
		return ReturnSheet{}, db.ErrCoachReturnUnknown
	}
	return buildSheet(st, r, localHandle)
}

// Sheets renders every staged return, newest first.
func Sheets(st ReturnStore, localHandle string) ([]ReturnSheet, error) {
	returns, err := st.LoadCoachReturns()
	if err != nil {
		return nil, fmt.Errorf("coach: load returns: %w", err)
	}
	out := make([]ReturnSheet, 0, len(returns))
	for _, r := range returns {
		sheet, err := buildSheet(st, r, localHandle)
		if err != nil {
			return nil, err
		}
		out = append(out, sheet)
	}
	return out, nil
}

// buildSheet derives every note's status from the store's current state.
func buildSheet(st ReturnStore, r db.CoachReturn, localHandle string) (ReturnSheet, error) {
	f, err := decodeNotesFile(r.NotesJSON)
	if err != nil {
		return ReturnSheet{}, err
	}
	state, err := loadSheetState(st)
	if err != nil {
		return ReturnSheet{}, err
	}
	sheet := ReturnSheet{
		ID: r.ID, CoachName: r.CoachName, PlayerHandle: r.PlayerHandle, SessionDate: r.SessionDate,
		ImportedAt: r.ImportedAt, Summary: f.Summary,
		Notes:          make([]ReturnItem, 0, len(f.Notes)),
		Decisions:      make(map[string]string, len(r.Decisions)),
		PlayerMismatch: handlesDiffer(localHandle, r.PlayerHandle),
	}
	for id, d := range r.Decisions {
		sheet.Decisions[id] = d.Decision
	}
	for _, n := range f.Notes {
		if n.Match == nil {
			n.Match = &MatchContext{}
		}
		status := state.statusOf(n, r.Decisions)
		if status == StatusPending {
			sheet.Pending++
		}
		sheet.Notes = append(sheet.Notes, ReturnItem{Note: n, Status: status})
	}
	return sheet, nil
}

// handlesDiffer is the player-mismatch rule: only a set local handle can
// disagree, and case and surrounding space do not count.
func handlesDiffer(local, fromFile string) bool {
	local = strings.TrimSpace(local)
	return local != "" && !strings.EqualFold(local, strings.TrimSpace(fromFile))
}
