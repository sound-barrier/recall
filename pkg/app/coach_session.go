package app

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"recall/pkg/coach"
	"recall/pkg/match"
)

// Coaching-session lifecycle. A session loans a player's exported bundle
// into memory for the length of a review and discards it on End; the
// player's records never reach a store (design rule 3), and while one is
// open the coach's own database is frozen by assertNoCoachSession (design
// rule 1). The only rows a session writes are the coach's OWN notes about
// the player, which are keyed by player and resurface next time.

// maxCoachHandleRunes bounds the display handle a coach confirms — the
// same ceiling the notes file and the bundle manifest enforce, so a handle
// accepted here always survives an export.
const maxCoachHandleRunes = 64

// CoachSessionChangedEvent is the payload of the "coach-session-changed"
// event. Other tabs (and the desktop window) key their write gate off
// Active rather than re-fetching the whole view.
type CoachSessionChangedEvent struct {
	Active bool `json:"active"`
}

// CoachSessionResult is the Wails LoadCoachBundleFromFile return: the
// dialog path the user picked plus the session it opened. Path is "" and
// Session nil when the user canceled, which is how the caller tells a
// cancel from an open.
type CoachSessionResult struct {
	Path    string             `json:"path"`
	Session *coach.SessionView `json:"session,omitempty"`
}

// OpenCoachSession renders a player's bundle into the open session and
// returns its view. One session at a time: a second open is
// coach.ErrSessionActive. A bundle that names its player resolves (or
// creates) the coach_players row immediately, so notes written about them
// in an earlier session resurface here; an anonymous bundle carries no
// player until SetCoachSessionPlayer supplies one.
func (a *App) OpenCoachSession(payload []byte) (coach.SessionView, error) {
	view, err := a.claimCoachSession(payload, time.Now())
	if err != nil {
		return coach.SessionView{}, err
	}
	a.emitCoachSessionChanged(true)
	return view, nil
}

// claimCoachSession is OpenCoachSession's critical section — it takes the
// one session slot or reports why it cannot, the way claimRunSlot does for
// a parse. A view that fails to assemble releases the slot again rather
// than leaving a session nobody can see.
func (a *App) claimCoachSession(payload []byte, now time.Time) (coach.SessionView, error) {
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	if a.coachSession != nil {
		return coach.SessionView{}, coach.ErrSessionActive
	}
	s, err := coach.OpenSession(payload, now)
	if err != nil {
		return coach.SessionView{}, err
	}
	if err := a.adoptSessionPlayer(s); err != nil {
		return coach.SessionView{}, err
	}
	a.coachSession = s
	view, err := a.coachViewLocked(now)
	if err != nil {
		a.coachSession = nil
		return coach.SessionView{}, err
	}
	return view, nil
}

// adoptSessionPlayer resolves the coach_players row a bundle's identity
// names. A bundle with no handle leaves the session player-less — the
// coach confirms one before any note can be written.
func (a *App) adoptSessionPlayer(s *coach.Session) error {
	if s.Player.Handle == "" {
		return nil
	}
	p, err := a.store.EnsureCoachPlayer(s.Player.ID, s.Player.Handle)
	if err != nil {
		return fmt.Errorf("coach: resolve player: %w", err)
	}
	s.SetPlayerRef(p.ID)
	return nil
}

// GetCoachSession returns the open session's view, hydrated with whatever
// the coach has written about this player. coach.ErrNoSession when none is
// open.
func (a *App) GetCoachSession() (coach.SessionView, error) {
	a.coachMu.RLock()
	defer a.coachMu.RUnlock()
	if a.coachSession == nil {
		return coach.SessionView{}, coach.ErrNoSession
	}
	return a.coachViewLocked(time.Now())
}

// GetCoachSessionMatches returns the loaned corpus — the records the six
// tabs render while a session is open. Read-only: the slice is the
// session's own.
func (a *App) GetCoachSessionMatches() ([]match.Record, error) {
	a.coachMu.RLock()
	defer a.coachMu.RUnlock()
	if a.coachSession == nil {
		return nil, coach.ErrNoSession
	}
	return a.coachSession.Records(), nil
}

// CloseCoachSession discards the loaned records. Idempotent — the
// frontend calls it to clear a resume that turned out to be stale, and a
// "there was nothing to close" is not an error.
func (a *App) CloseCoachSession() error {
	a.endCoachSession()
	return nil
}

// SetCoachSessionPlayer confirms (or corrects) who the session is about.
// The handle is a display label: when the bundle minted a stable player
// id, the row is found by that id and renamed; when it did not, the handle
// itself is the identity, so typing a different one switches to that
// player — and either way the notes for the resolved player re-hydrate.
func (a *App) SetCoachSessionPlayer(handle string) (coach.SessionView, error) {
	handle, err := validateCoachHandle(handle)
	if err != nil {
		return coach.SessionView{}, err
	}
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	s := a.coachSession
	if s == nil {
		return coach.SessionView{}, coach.ErrNoSession
	}
	p, err := a.store.EnsureCoachPlayer(s.Player.ID, handle)
	if err != nil {
		return coach.SessionView{}, fmt.Errorf("coach: resolve player: %w", err)
	}
	if p.Handle != handle {
		if err := a.store.RenameCoachPlayer(p.ID, handle); err != nil {
			return coach.SessionView{}, fmt.Errorf("coach: rename player: %w", err)
		}
	}
	s.Player.Handle = handle
	s.SetPlayerRef(p.ID)
	return a.coachViewLocked(time.Now())
}

// PutCoachNote saves the coach's one note about one of the session's
// matches and returns it as the reel renders it. The note replaces any
// earlier one for the same match; its identity (note_id) is minted once
// and survives every re-save and re-export.
func (a *App) PutCoachNote(matchKey string, in coach.NoteInput) (coach.Note, error) {
	normalized, err := coach.ValidateNoteInput(in)
	if err != nil {
		return coach.Note{}, err
	}
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	s, playerRef, err := a.noteTargetLocked(matchKey)
	if err != nil {
		return coach.Note{}, err
	}
	saved, err := a.store.UpsertCoachNote(coach.CoachNoteFromInput(playerRef, matchKey, normalized))
	if err != nil {
		return coach.Note{}, fmt.Errorf("coach: save note: %w", err)
	}
	return coach.NoteFromCoachNote(saved, s.MatchContextFor(matchKey)), nil
}

// DeleteCoachNote removes the coach's note about one of the session's
// matches — the autosave path's "the draft went empty" call. Idempotent.
func (a *App) DeleteCoachNote(matchKey string) error {
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	_, playerRef, err := a.noteTargetLocked(matchKey)
	if err != nil {
		return err
	}
	if err := a.store.DeleteCoachNote(playerRef, matchKey); err != nil {
		return fmt.Errorf("coach: delete note: %w", err)
	}
	return nil
}

// PutCoachSummary saves the one set-level note for the session's player
// ("what to work on"). An empty text clears it.
func (a *App) PutCoachSummary(text string) error {
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	playerRef, err := a.sessionPlayerLocked()
	if err != nil {
		return err
	}
	if err := a.store.SetCoachSummary(playerRef, strings.TrimSpace(text)); err != nil {
		return fmt.Errorf("coach: save summary: %w", err)
	}
	return nil
}

// assertNoCoachSession is the write gate (design rule 1): the first line of
// every mutating orchestrator, the way assertActiveMutable is. While a
// session is open the coach is looking at somebody else's history, so a
// write aimed at "this match" would land on a key their own database has
// never seen. Deliberately NOT applied to the folder watcher's debounce
// parse (watcher.go) — that ingests the coach's own screenshots into the
// coach's own store and must keep running.
func (a *App) assertNoCoachSession() error {
	a.coachMu.RLock()
	defer a.coachMu.RUnlock()
	if a.coachSession != nil {
		return coach.ErrSessionActive
	}
	return nil
}

// endCoachSession discards any open session and announces the change.
// Idempotent — the store-teardown paths call it unconditionally.
func (a *App) endCoachSession() {
	a.coachMu.Lock()
	ended := a.coachSession != nil
	a.coachSession = nil
	a.coachMu.Unlock()
	if ended {
		a.emitCoachSessionChanged(false)
	}
}

// coachViewLocked assembles the wire view of the open session. The caller
// holds coachMu.
func (a *App) coachViewLocked(now time.Time) (coach.SessionView, error) {
	s := a.coachSession
	notes, summary, err := a.coachWorkLocked(s)
	if err != nil {
		return coach.SessionView{}, err
	}
	return s.View(notes, summary, a.settingsSnapshot().CoachName, now), nil
}

// coachWorkLocked loads what the coach has already written about this
// player. A session with no confirmed player has nothing to load.
func (a *App) coachWorkLocked(s *coach.Session) ([]coach.Note, string, error) {
	playerRef := s.PlayerRef()
	if playerRef == 0 {
		return nil, "", nil
	}
	stored, err := a.store.LoadCoachNotes(playerRef)
	if err != nil {
		return nil, "", fmt.Errorf("coach: load notes: %w", err)
	}
	summary, _, err := a.store.LoadCoachSummary(playerRef)
	if err != nil {
		return nil, "", fmt.Errorf("coach: load summary: %w", err)
	}
	return coach.Notes(s, stored), summary.Text, nil
}

// sessionPlayerLocked returns the confirmed player every note write hangs
// off. The caller holds coachMu.
func (a *App) sessionPlayerLocked() (int64, error) {
	switch {
	case a.coachSession == nil:
		return 0, coach.ErrNoSession
	case a.coachSession.PlayerRef() == 0:
		return 0, coach.ErrHandleRequired
	}
	return a.coachSession.PlayerRef(), nil
}

// noteTargetLocked resolves the three preconditions every note write
// shares: a session, a confirmed player, and a tracked match that is
// actually in the loaned corpus. The caller holds coachMu.
func (a *App) noteTargetLocked(matchKey string) (*coach.Session, int64, error) {
	playerRef, err := a.sessionPlayerLocked()
	if err != nil {
		return nil, 0, err
	}
	s := a.coachSession
	if !coach.IsTrackedMatchKey(matchKey) || !s.HasMatch(matchKey) {
		return nil, 0, fmt.Errorf("%w: %q", coach.ErrMatchNotInSession, matchKey)
	}
	return s, playerRef, nil
}

// validateCoachHandle trims and bounds the display handle a coach confirms.
func validateCoachHandle(handle string) (string, error) {
	handle = strings.TrimSpace(handle)
	switch {
	case handle == "":
		return "", fmt.Errorf("%w: a handle is required", coach.ErrHandleInvalid)
	case utf8.RuneCountInString(handle) > maxCoachHandleRunes:
		return "", fmt.Errorf("%w: handle exceeds %d characters", coach.ErrHandleInvalid, maxCoachHandleRunes)
	}
	return handle, nil
}
