// Package coachreturn is the receiving half of the coach exchange: a notes
// archive arrives from a coach, is staged against the player's own history, and
// the player decides each note in it.
//
// It is a separate package from pkg/coach because it answers to a different
// person. pkg/coach is the coach's desk — open a session on a loaned bundle,
// write notes, export them. This is the player's inbox — read what came back,
// tell an orphan from a note you can act on, accept or skip. The two share only
// the archive format, so the import runs one way (here to pkg/coach) and the
// old guarantee that "a session can never reach the received layer", once held
// by two interfaces sitting in one package, is now held by the compiler.
//
// A note is an ORPHAN when its match key is not in this history — the coach
// reviewed something the player has since deleted, or never had. An orphan can
// be seen but never accepted, because accepting writes a block onto a match
// that is not there.
package coachreturn

import (
	"errors"
	"fmt"
	"strings"

	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/matchedit"
)

// Store is the player-side persistence a returned notes file needs:
// the tracked-key registry to tell orphans apart, the review flag and the
// coach-received blocks an accept writes, and the staged returns with
// their decisions. db.Store satisfies it; dbtest.Fake mirrors it.
type Store interface {
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
	UpsertReceivedFocusItem(item db.ReceivedFocusItem) error
}

// Verdict values the player records against a staged note.
var (
	// ErrOrphan — a decision targets a note whose match is not in the player's
	// history (409).
	ErrOrphan = errors.New("coach: note is not about a match in your history")
	// ErrNoMatches — the archive has nothing to show: no focus items, and no
	// note about a match in this history (409). The wrapped message says which
	// of the two cases it is.
	ErrNoMatches = errors.New("coach: nothing in this notes file applies to your history")
)

// Decision is the verdict a player can give one returned note. Two arms, and
// no 'denied': a coach's note is theirs to have written, so skipping removes it
// from your matches rather than rejecting that it was said.
type Decision string

const (
	DecisionAccepted Decision = "accepted"
	DecisionSkipped  Decision = "skipped"
)

// Status is where a note on the return sheet stands — a superset of Decision,
// because two of the four are not choices. Pending is derived and never stored
// (undecided and decidable); Orphan means the note is about a match this
// history no longer has, so it cannot be accepted at all.
//
// Defined types rather than bare strings: these two vocabularies overlap by two
// members, and untyped they were interchangeable at every call site.
type Status string

const (
	StatusPending  Status = "pending"
	StatusAccepted Status = "accepted"
	StatusSkipped  Status = "skipped"
	StatusOrphan   Status = "orphan"
)

// reviewedByCoach is the match_reviews value an accept writes — the coach
// overwrites a self review (rule 11). The word is matchedit's, so the
// self-review finish that must NOT overwrite it compares the same constant.
const reviewedByCoach = matchedit.ReviewedByCoach

// Sheet is one staged notes file as GET /coach/returns renders it:
// the header, every note with its status, and the decisions so far.
type Sheet struct {
	ID           int64  `json:"id"`
	CoachName    string `json:"coach_name"`
	PlayerHandle string `json:"player_handle"`
	SessionDate  string `json:"session_date"`
	ImportedAt   string `json:"imported_at"`
	// FocusItems is what the coach wants worked on, in order. They are NOT
	// decided on like the notes below: a coach's item is active the moment
	// the file lands, and the player acknowledges it from their focus list
	// rather than admitting it here.
	FocusItems []coach.FocusItem `json:"focus_items"`
	Notes      []Item            `json:"notes"`
	// Decisions is keyed by note_id; a note with no entry is undecided.
	Decisions map[string]string `json:"decisions"`
	// Pending counts the notes still awaiting a decision (orphans excluded).
	Pending int `json:"pending"`
	// PlayerMismatch flags a file written about someone else — the local
	// handle is set and differs from the file's.
	PlayerMismatch bool `json:"player_mismatch"`
}

// Item is one note on the sheet: the note as the file carries it plus
// its derived status.
type Item struct {
	coach.Note
	Status Status `json:"status"`
}

// Verdict is one entry of the PUT /coach/returns/{id}/decisions body.
type Verdict struct {
	NoteID   string   `json:"note_id"`
	Decision Decision `json:"decision"`
}

// Stage imports a notes archive on the player's side: reads and validates
// it, and either returns the sheet already staged for the same file
// (alreadyStaged=true) or stages it. A file with nothing to show — no
// summary, and no note about a match in this history — is
// ErrNoMatches and is not staged; a summary alone is enough, because
// a coach may end a session having written only that.
func Stage(st Store, payload []byte, localHandle string) (sheet Sheet, alreadyStaged bool, err error) {
	f, raw, err := coach.ReadNotesArchive(payload)
	if err != nil {
		return Sheet{}, false, err
	}
	hash := coach.ContentHash(raw)
	if existing, ok, err := st.LookupCoachReturnByHash(hash); err != nil {
		return Sheet{}, false, fmt.Errorf("coach: look up staged return: %w", err)
	} else if ok {
		// Re-land on the way through. The upsert is idempotent and never
		// resets a status the player moved, and landing is NOT transactional
		// with the insert above — a partial first import would otherwise be
		// unrecoverable, because this branch is the only one a retry reaches.
		if err := landFocusItems(st, existing.ID, f, localHandle); err != nil {
			return Sheet{}, false, err
		}
		sheet, err := buildSheet(st, existing, localHandle)
		return sheet, true, err
	}
	keys, err := st.LoadMatchKeys()
	if err != nil {
		return Sheet{}, false, fmt.Errorf("coach: load match keys: %w", err)
	}
	// A coach may end a session having written only the focus list, so items
	// alone are enough to stage.
	if len(f.FocusItems) == 0 && !anyLocalNote(f.Notes, keys) {
		return Sheet{}, false, nothingToStage(f.Notes)
	}
	id, err := st.InsertCoachReturn(db.CoachReturn{
		ContentHash: hash, CoachName: f.CoachName, PlayerHandle: f.Player.Handle,
		SessionDate: f.SessionDate, NotesJSON: raw,
	})
	if err != nil {
		return Sheet{}, false, fmt.Errorf("coach: stage return: %w", err)
	}
	if err := landFocusItems(st, id, f, localHandle); err != nil {
		return Sheet{}, false, err
	}
	sheet, err = Get(st, id, localHandle)
	return sheet, false, err
}

// landFocusItems puts a coach's list into the player's own list the moment
// the file is staged, as `new`.
//
// Items are NOT decided on the way notes are. A note is about one match and
// the player may not even have that match, so it waits to be accepted or
// skipped; an item is what the coach is telling them to work on, so it is
// live on arrival and Accept only acknowledges it. There is no deny — a
// player can disagree with their coach, but they have to hear it first.
//
// Upserting on item_id means re-importing the same file never resets a
// status the player has already moved.
func landFocusItems(st Store, returnID int64, f coach.NotesFile, localHandle string) error {
	// A file written about someone else is not your coach talking to you.
	// The sheet warns about it, but by then the items would already be on
	// the player's list — and "no deny" would make a stranger's homework
	// permanent. The warning has to come before the landing, not after.
	if handlesDiffer(localHandle, f.Player.Handle) {
		return nil
	}
	for i, it := range f.FocusItems {
		item := db.FocusItem{ItemID: it.ItemID, Text: it.Text, Status: db.FocusNew, SortOrder: i}
		err := st.UpsertReceivedFocusItem(db.ReceivedFocusItem{
			FocusItem: item,
			ReturnID:  returnID,
		})
		if err != nil {
			return fmt.Errorf("coach: land focus item: %w", err)
		}
	}
	return nil
}

// nothingToStage names which of the two empty cases the refused file is, so
// the player reads why their archive was turned away rather than a generic
// "no matches".
func nothingToStage(notes []coach.Note) error {
	if len(notes) == 0 {
		return fmt.Errorf("%w: it carries no notes and nothing to work on", ErrNoMatches)
	}
	return fmt.Errorf("%w: none of its %d notes name a match you have, and nothing to work on", ErrNoMatches, len(notes))
}

func anyLocalNote(notes []coach.Note, keys map[string]bool) bool {
	for _, n := range notes {
		if keys[n.MatchKey] {
			return true
		}
	}
	return false
}

// Sheet renders one staged return. db.ErrCoachReturnUnknown when id names
// no return.
func Get(st Store, id int64, localHandle string) (Sheet, error) {
	r, ok, err := st.LoadCoachReturn(id)
	if err != nil {
		return Sheet{}, fmt.Errorf("coach: load return %d: %w", id, err)
	}
	if !ok {
		return Sheet{}, db.ErrCoachReturnUnknown
	}
	return buildSheet(st, r, localHandle)
}

// Sheets renders every staged return, newest first.
func Sheets(st Store, localHandle string) ([]Sheet, error) {
	returns, err := st.LoadCoachReturns()
	if err != nil {
		return nil, fmt.Errorf("coach: load returns: %w", err)
	}
	out := make([]Sheet, 0, len(returns))
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
func buildSheet(st Store, r db.CoachReturn, localHandle string) (Sheet, error) {
	f, err := coach.DecodeNotesFile(r.NotesJSON)
	if err != nil {
		return Sheet{}, err
	}
	state, err := loadSheetState(st)
	if err != nil {
		return Sheet{}, err
	}
	sheet := Sheet{
		ID: r.ID, CoachName: r.CoachName, PlayerHandle: r.PlayerHandle, SessionDate: r.SessionDate,
		ImportedAt: r.ImportedAt, FocusItems: emptyIfNilItems(f.FocusItems),
		Notes:          make([]Item, 0, len(f.Notes)),
		Decisions:      make(map[string]string, len(r.Decisions)),
		PlayerMismatch: handlesDiffer(localHandle, r.PlayerHandle),
	}
	for id, d := range r.Decisions {
		sheet.Decisions[id] = d.Decision
	}
	for _, n := range f.Notes {
		if n.Match == nil {
			n.Match = &coach.MatchContext{}
		}
		status := state.statusOf(n, r.Decisions)
		if status == StatusPending {
			sheet.Pending++
		}
		sheet.Notes = append(sheet.Notes, Item{Note: n, Status: status})
	}
	return sheet, nil
}

// handlesDiffer is the player-mismatch rule: only a set local handle can
// disagree, and case and surrounding space do not count.
func handlesDiffer(local, fromFile string) bool {
	local = strings.TrimSpace(local)
	return local != "" && !strings.EqualFold(local, strings.TrimSpace(fromFile))
}

// emptyIfNilItems keeps the wire honest: the schema declares focus_items a
// non-nullable array, and an archive with notes but no items is legal.
func emptyIfNilItems(items []coach.FocusItem) []coach.FocusItem {
	if items == nil {
		return []coach.FocusItem{}
	}
	return items
}
