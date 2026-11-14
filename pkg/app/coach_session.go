package app

import (
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"recall/pkg/applog"
	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/matchedit"
)

// Coaching-session lifecycle. A session loans a player's exported bundle
// into memory for the length of a review and discards it on End; the
// player's records never reach a store (design rule 3), and while one is
// open the coach's own database is frozen by the write gate
// (store_holder.go, design rule 1). The only rows a session writes are the coach's OWN notes about
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
	a.emitCoachSessionChanged()
	return view, nil
}

// claimCoachSession is OpenCoachSession's critical section — it takes the
// one session slot or reports why it cannot, the way claimRunSlot does for
// a parse. A view that fails to assemble releases the slot again rather
// than leaving a session nobody can see.
func (a *App) claimCoachSession(payload []byte, now time.Time) (coach.SessionView, error) {
	return a.claimCoachSessionWith(func(n time.Time) (*coach.Session, error) {
		return coach.OpenSession(payload, n)
	}, now)
}

// claimCoachSessionWith is the critical section itself, parameterized by how
// the session gets built — a bundle to read, or replay codes to mint frames
// from. Extracted rather than copied: there is exactly ONE session slot, and
// two places racing to take it is the bug this shape prevents by
// construction.
func (a *App) claimCoachSessionWith(open func(time.Time) (*coach.Session, error), now time.Time) (coach.SessionView, error) {
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	if err := a.coachSlot.beginOpen(&a.coachMu); err != nil {
		return coach.SessionView{}, err
	}
	view, err := a.openClaimedSlot(open, now)
	if err != nil {
		a.coachSlot.abandonOpen()
		return coach.SessionView{}, err
	}
	return view, nil
}

// openClaimedSlot builds the session into a slot beginOpen claimed. The
// caller holds coachMu.
//
// A swap closes the store a session's notes are written to, and ends any
// open session on its way in by taking coachMu. Checked under it — after
// the wait for gated writes, since a swap can start during that wait — the
// open either sees the swap and refuses, or finishes first and the swap
// ends it.
func (a *App) openClaimedSlot(open func(time.Time) (*coach.Session, error), now time.Time) (coach.SessionView, error) {
	if a.storeSwapping() {
		return coach.SessionView{}, ErrStoreSwapInProgress
	}
	s, err := open(now)
	if err != nil {
		return coach.SessionView{}, err
	}
	if err := a.adoptSessionPlayer(s); err != nil {
		return coach.SessionView{}, err
	}
	a.coachSlot.finishOpen(s)
	view, err := a.coachViewLocked(now)
	if err != nil {
		return coach.SessionView{}, err
	}
	a.recordSittingOpened(s)
	return view, nil
}

// recordSittingOpened writes the session's own history row. At OPEN, not at
// end: a coach who opens a bundle and walks away did something, and a
// dossier that only knew about finished sittings would misreport how often
// they meet. The row learns its player later, when the coach names them.
//
// Best-effort — losing a line of history is not worth refusing the session
// the coach actually asked for.
func (a *App) recordSittingOpened(s *coach.Session) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		applog.Subsystem("coach").Error("session history: open failed", "session_id", s.SessionID, "err", leaseErr)
		return
	}
	defer release()
	keys := make([]string, 0, s.MatchCount())
	for _, r := range s.Records() {
		keys = append(keys, r.MatchKey)
	}
	err := store.StartCoachSession(db.CoachSessionRow{
		SessionID: s.SessionID,
		PlayerRef: s.PlayerRef(),
		Handle:    s.Player.Handle,
		Kind:      s.Player.Kind,
		Source:    string(s.Source),
		MatchKeys: keys,
	})
	if err != nil {
		applog.Subsystem("coach").Error("session history: open failed",
			"session_id", s.SessionID, "err", err)
	}
}

// adoptSessionPlayer resolves the coach_players row a bundle's identity
// names. A bundle with no handle leaves the session player-less — the
// coach confirms one before any note can be written.
func (a *App) adoptSessionPlayer(s *coach.Session) error {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	if s.Player.Handle == "" {
		return nil
	}
	p, err := store.EnsureCoachPlayer(s.Player.ID, s.Player.Handle, db.CoachKindPlayer)
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
	if a.coachSlot.session == nil {
		return coach.SessionView{}, coach.ErrNoSession
	}
	return a.coachViewLocked(time.Now())
}

// GetCoachSessionMatches returns the loaned corpus — the records the six
// tabs render while a session is open. A copy: the caller encodes it after
// the lock is gone, while a context edit rewrites the session's own records.
func (a *App) GetCoachSessionMatches() ([]match.Record, error) {
	a.coachMu.RLock()
	defer a.coachMu.RUnlock()
	if a.coachSlot.session == nil {
		return nil, coach.ErrNoSession
	}
	return slices.Clone(a.coachSlot.session.Records()), nil
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
// player — and either way the notes for the resolved identity re-hydrate.
//
// kind widens the answer: a codes session may be confirmed as a TEAM (one
// shared review filed under the group's name). "" means player. A bundle
// session refuses a team — the manifest already named its player.
func (a *App) SetCoachSessionPlayer(handle, kind string) (coach.SessionView, error) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return coach.SessionView{}, leaseErr
	}
	defer release()
	handle, err := validateCoachHandle(handle)
	if err != nil {
		return coach.SessionView{}, err
	}
	if kind == "" {
		kind = db.CoachKindPlayer
	}
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	s := a.coachSlot.session
	if s == nil {
		return coach.SessionView{}, coach.ErrNoSession
	}
	if kind == db.CoachKindTeam && s.Source != coach.SessionFromReplay {
		return coach.SessionView{}, coach.ErrBundleNamesPlayer
	}
	p, err := resolveNamedPlayer(store, s.Player.ID, handle, kind)
	if err != nil {
		return coach.SessionView{}, err
	}
	s.Player.Handle = handle
	s.Player.Kind = kind
	s.SetPlayerRef(p.ID)
	// The history row was written before anyone knew whose sitting this
	// was, and the coach may be correcting an earlier answer — so it is
	// re-pointed every time, not only the first.
	if err := store.PointCoachSessionAt(s.SessionID, p.ID, handle, kind); err != nil {
		applog.Subsystem("coach").Error("session history: re-point failed",
			"session_id", s.SessionID, "err", err)
	}
	return a.coachViewLocked(time.Now())
}

// resolveNamedPlayer finds (or creates) the coach_players row the coach just
// named and renames it to the handle they typed.
func resolveNamedPlayer(store db.Store, playerID, handle, kind string) (db.CoachPlayer, error) {
	p, err := store.EnsureCoachPlayer(playerID, handle, kind)
	if err != nil {
		return db.CoachPlayer{}, fmt.Errorf("coach: resolve player: %w", err)
	}
	if p.Handle != handle {
		if err := store.RenameCoachPlayer(p.ID, handle); err != nil {
			return db.CoachPlayer{}, fmt.Errorf("coach: rename player: %w", err)
		}
	}
	return p, nil
}

// PutCoachNote saves the coach's one note about one of the session's
// matches and returns it as the reel renders it. The note replaces any
// earlier one for the same match; its identity (note_id) is minted once
// and survives every re-save and re-export.
func (a *App) PutCoachNote(matchKey string, in coach.NoteInput) (coach.Note, error) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return coach.Note{}, leaseErr
	}
	defer release()
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
	saved, err := store.UpsertCoachNote(coach.NoteToRow(playerRef, matchKey, normalized))
	if err != nil {
		return coach.Note{}, fmt.Errorf("coach: save note: %w", err)
	}
	return coach.NoteFromCoachNote(saved, s.MatchContextFor(matchKey)), nil
}

// DeleteCoachNote removes the coach's note about one of the session's
// matches — the autosave path's "the draft went empty" call. Idempotent.
func (a *App) DeleteCoachNote(matchKey string) error {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	_, playerRef, err := a.noteTargetLocked(matchKey)
	if err != nil {
		return err
	}
	if err := store.DeleteCoachNote(playerRef, matchKey); err != nil {
		return fmt.Errorf("coach: delete note: %w", err)
	}
	return nil
}

// PutCoachMoment saves one timestamped moment on the note for a match, and
// creates that note if the coach is stamping a moment before writing anything
// else — which is the common order: you watch, you mark 3:23, and only later
// decide what the match as a whole was about.
//
// Addressed by the MOMENT's id rather than the match's, because several share
// a match. An empty momentID mints a new one.
func (a *App) PutCoachMoment(matchKey, momentID string, in coach.MomentInput) (coach.Moment, error) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return coach.Moment{}, leaseErr
	}
	defer release()
	normalized, err := coach.ValidateMomentInput(in)
	if err != nil {
		return coach.Moment{}, err
	}
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	_, playerRef, err := a.noteTargetLocked(matchKey)
	if err != nil {
		return coach.Moment{}, err
	}
	note, err := a.ensureNoteForMomentLocked(playerRef, matchKey)
	if err != nil {
		return coach.Moment{}, err
	}
	moments, err := store.LoadCoachNoteMoments(playerRef)
	if err != nil {
		return coach.Moment{}, fmt.Errorf("coach: load note moments: %w", err)
	}
	existing := moments[note.NoteID]
	if err := checkMomentRoom(existing, momentID); err != nil {
		return coach.Moment{}, err
	}
	// An EDIT keeps the place the coach wrote the moment at. Writing the list
	// length on every save sent a moment to the bottom of its tied group the
	// moment its typo was fixed — and since the wire carries only array order,
	// the stored sort_order is the order the strip renders.
	row := coach.MomentRowFromInput(note.NoteID, momentID, matchedit.SortOrderFor(existing, momentID), normalized)
	saved, err := store.UpsertCoachNoteMoment(playerRef, row)
	if err != nil {
		return coach.Moment{}, fmt.Errorf("coach: save moment: %w", err)
	}
	return coach.MomentFromRow(saved), nil
}

// checkMomentRoom refuses a NEW moment past the per-note ceiling; an edit to
// one already stored always fits. The coach's ceiling is its own; where a
// moment lands among its siblings is not.
func checkMomentRoom(existing []db.CoachNoteMoment, momentID string) error {
	if matchedit.IsStoredMoment(existing, momentID) {
		return nil
	}
	if len(existing) >= coach.MaxMomentsPerNote {
		return fmt.Errorf("%w: a match holds at most %d moments", coach.ErrNoteInvalid, coach.MaxMomentsPerNote)
	}
	return nil
}

// ensureNoteForMomentLocked returns the note a moment hangs off, creating an
// empty one if this is the first mark on the match. The empty note is a
// reviewed_only mark rather than a blank note: the coach HAS reviewed the
// match — they just said it with a timestamp instead of a paragraph.
func (a *App) ensureNoteForMomentLocked(playerRef int64, matchKey string) (db.CoachNote, error) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return db.CoachNote{}, leaseErr
	}
	defer release()
	stored, err := store.LoadCoachNotes(playerRef)
	if err != nil {
		return db.CoachNote{}, fmt.Errorf("coach: load notes: %w", err)
	}
	if n, ok := stored[matchKey]; ok {
		return n, nil
	}
	created, err := store.UpsertCoachNote(db.CoachNote{
		PlayerRef: playerRef,
		MatchKey:  matchKey,
		Kind:      coach.KindReviewedOnly,
	})
	if err != nil {
		return db.CoachNote{}, fmt.Errorf("coach: open note for moment: %w", err)
	}
	return created, nil
}

// DeleteCoachMoment removes one moment. Idempotent, and it deliberately leaves
// the note behind: a match whose last moment was deleted is still a match the
// coach looked at.
func (a *App) DeleteCoachMoment(matchKey, momentID string) error {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	_, playerRef, err := a.noteTargetLocked(matchKey)
	if err != nil {
		return err
	}
	if err := store.DeleteCoachNoteMoment(playerRef, momentID); err != nil {
		return fmt.Errorf("coach: delete moment: %w", err)
	}
	return nil
}

// PutCoachFocusItems replaces what the coach is telling this player to work
// on, in the given order. An empty list clears it. The list is per PLAYER,
// not per session — it re-surfaces every time that bundle is opened, which
// is the whole point of telling someone what to work on.
func (a *App) PutCoachFocusItems(items []coach.FocusItem) error {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return leaseErr
	}
	defer release()
	a.coachMu.Lock()
	defer a.coachMu.Unlock()
	playerRef, err := a.sessionPlayerLocked()
	if err != nil {
		return err
	}
	// Refuse rather than quietly dropping a row: an item the coach typed and
	// the app silently discarded is worse than a message saying why.
	if err := coach.ValidateFocusItems(items); err != nil {
		return err
	}
	rows := make([]db.FocusItem, 0, len(items))
	for _, it := range items {
		rows = append(rows, db.FocusItem{ItemID: it.ItemID, Text: strings.TrimSpace(it.Text)})
	}
	if err := store.SetCoachFocusItems(playerRef, rows); err != nil {
		return fmt.Errorf("coach: save focus items: %w", err)
	}
	return nil
}

// endCoachSession discards any open session and announces the change.
// Idempotent — the store-teardown paths call it unconditionally.
func (a *App) endCoachSession() {
	a.coachMu.Lock()
	s := a.coachSlot.end()
	a.coachMu.Unlock()
	if s == nil {
		return
	}
	a.recordSittingEnded(s)
	a.emitCoachSessionChanged()
}

// recordSittingEnded stamps the history row and freezes the focus list as
// it stood — by value, because the coach's focus rows are delete-and-
// reinserted on every autosave, and because "what changed since last time"
// wants what the list SAID then.
//
// Best-effort, like the open: the session is already over, and a failure
// here costs a line of history rather than any of the coach's work.
func (a *App) recordSittingEnded(s *coach.Session) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		applog.Subsystem("coach").Error("session history: end failed", "session_id", s.SessionID, "err", leaseErr)
		return
	}
	defer release()
	var frozen []db.CoachSessionFocusRow
	if ref := s.PlayerRef(); ref != 0 {
		items, err := store.LoadCoachFocusItems(ref)
		if err != nil {
			applog.Subsystem("coach").Error("session history: read focus failed",
				"session_id", s.SessionID, "err", err)
		}
		for _, item := range items {
			frozen = append(frozen, db.CoachSessionFocusRow{Text: item.Text, Status: item.Status})
		}
	}
	if err := store.EndCoachSession(s.SessionID, frozen); err != nil {
		applog.Subsystem("coach").Error("session history: end failed",
			"session_id", s.SessionID, "err", err)
	}
}

// coachViewLocked assembles the wire view of the open session. The caller
// holds coachMu.
func (a *App) coachViewLocked(now time.Time) (coach.SessionView, error) {
	s := a.coachSlot.session
	notes, focus, err := a.coachWorkLocked(s)
	if err != nil {
		return coach.SessionView{}, err
	}
	return s.View(notes, focus, a.settingsSnapshot().CoachName, now), nil
}

// coachWorkLocked loads what the coach has already written about this
// player. A session with no confirmed player has nothing to load.
func (a *App) coachWorkLocked(s *coach.Session) ([]coach.Note, []coach.FocusItem, error) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return nil, nil, leaseErr
	}
	defer release()
	playerRef := s.PlayerRef()
	if playerRef == 0 {
		return nil, nil, nil
	}
	stored, err := store.LoadCoachNotes(playerRef)
	if err != nil {
		return nil, nil, fmt.Errorf("coach: load notes: %w", err)
	}
	moments, err := store.LoadCoachNoteMoments(playerRef)
	if err != nil {
		return nil, nil, fmt.Errorf("coach: load note moments: %w", err)
	}
	items, err := store.LoadCoachFocusItems(playerRef)
	if err != nil {
		return nil, nil, fmt.Errorf("coach: load focus items: %w", err)
	}
	return coach.Notes(s, stored, moments), toWireFocusItems(items), nil
}

// toWireFocusItems is the one place the store's row shape becomes the wire's.
func toWireFocusItems(rows []db.FocusItem) []coach.FocusItem {
	out := make([]coach.FocusItem, 0, len(rows))
	for _, r := range rows {
		out = append(out, coach.FocusItem{ItemID: r.ItemID, Text: r.Text})
	}
	return out
}

// sessionPlayerLocked returns the confirmed player every note write hangs
// off. The caller holds coachMu.
func (a *App) sessionPlayerLocked() (int64, error) {
	switch {
	case a.coachSlot.session == nil:
		return 0, coach.ErrNoSession
	case a.coachSlot.session.PlayerRef() == 0:
		return 0, coach.ErrHandleRequired
	}
	return a.coachSlot.session.PlayerRef(), nil
}

// noteTargetLocked resolves the three preconditions every note write
// shares: a session, a confirmed player, and a tracked match that is
// actually in the loaned corpus. The caller holds coachMu.
func (a *App) noteTargetLocked(matchKey string) (*coach.Session, int64, error) {
	playerRef, err := a.sessionPlayerLocked()
	if err != nil {
		return nil, 0, err
	}
	s := a.coachSlot.session
	if !coach.IsReviewableMatchKey(matchKey) || !s.HasMatch(matchKey) {
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

// ListCoachPlayerSessions returns the sittings the coach held about one
// player, newest first — each with what it covered and the focus list it
// froze. Refuses an id the roster does not carry, like its note sibling:
// a dossier for a player who is not on the roster is a bug, not an empty
// list.
func (a *App) ListCoachPlayerSessions(playerRef int64) ([]db.CoachSessionRow, error) {
	store, release, leaseErr := a.useStore()
	if leaseErr != nil {
		return nil, leaseErr
	}
	defer release()
	roster, err := store.LoadCoachPlayers()
	if err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(roster, func(p db.CoachPlayerSummary) bool { return p.ID == playerRef }) {
		return nil, db.ErrCoachPlayerUnknown
	}
	return store.ListCoachSessions(playerRef)
}
