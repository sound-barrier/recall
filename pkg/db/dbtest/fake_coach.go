package dbtest

import (
	"cmp"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"time"

	"recall/pkg/db"
)

// Coaching surface of the Fake — mirrors the SQLStore's two families with
// plain maps. The vocabulary CHECK constraints (kind, focus tag, decision) and the FK /
// UNIQUE refusals are enforced here too, so app tests built on the Fake
// cannot reach a state production refuses.

// coachFocusVocabulary mirrors the CHECK on coach_note_focus_tags /
// match_coach_note_focus_tags in schema.sql.
var coachFocusVocabulary = []string{
	"positioning", "ult_economy", "target_priority", "cooldowns",
	"hero_pick", "comms", "mechanics", "mental",
}

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

// distinctSorted normalizes a tag list the way the child tables store it.
func distinctSorted(values []string) []string {
	var out []string
	for _, v := range values {
		if v != "" && !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	slices.Sort(out)
	return out
}

func checkFocusTags(tags []string) error {
	for _, tag := range tags {
		if tag != "" && !slices.Contains(coachFocusVocabulary, tag) {
			return fmt.Errorf("dbtest: focus tag %q violates the vocabulary CHECK", tag)
		}
	}
	return nil
}

// nextID mints the next AUTOINCREMENT-style id above every id in use, so a
// fixture-seeded slice and a delete-then-insert both stay collision-free.
func nextID[T any](rows []T, idOf func(T) int64) int64 {
	var maxID int64
	for _, r := range rows {
		maxID = max(maxID, idOf(r))
	}
	return maxID + 1
}

func (f *Fake) EnsureCoachPlayer(playerID, handle string) (db.CoachPlayer, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if playerID != "" {
		if i := slices.IndexFunc(f.CoachPlayers, func(p db.CoachPlayer) bool { return p.PlayerID == playerID }); i >= 0 {
			return f.CoachPlayers[i], nil
		}
	}
	// With a player_id in hand only an id-less handle row may be adopted;
	// anonymous lookups take the earliest handle match.
	i := slices.IndexFunc(f.CoachPlayers, func(p db.CoachPlayer) bool {
		return strings.EqualFold(p.Handle, handle) && (playerID == "" || p.PlayerID == "")
	})
	if i >= 0 {
		if playerID != "" {
			f.CoachPlayers[i].PlayerID = playerID
		}
		return f.CoachPlayers[i], nil
	}
	p := db.CoachPlayer{PlayerID: playerID, Handle: handle,
		ID: nextID(f.CoachPlayers, func(p db.CoachPlayer) int64 { return p.ID })}
	f.CoachPlayers = append(f.CoachPlayers, p)
	return p, nil
}

func (f *Fake) RenameCoachPlayer(id int64, handle string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	i := slices.IndexFunc(f.CoachPlayers, func(p db.CoachPlayer) bool { return p.ID == id })
	if i < 0 {
		return db.ErrCoachPlayerUnknown
	}
	f.CoachPlayers[i].Handle = handle
	return nil
}

// hasCoachPlayer is the Fake's FK check; callers hold f.mu.
func (f *Fake) hasCoachPlayer(id int64) bool {
	return slices.ContainsFunc(f.CoachPlayers, func(p db.CoachPlayer) bool { return p.ID == id })
}

func (f *Fake) UpsertCoachNote(n db.CoachNote) (db.CoachNote, error) {
	if n.Kind != "note" && n.Kind != "reviewed_only" {
		return db.CoachNote{}, fmt.Errorf("dbtest: kind %q violates the note/reviewed_only CHECK", n.Kind)
	}
	if err := checkFocusTags(n.FocusTags); err != nil {
		return db.CoachNote{}, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.hasCoachPlayer(n.PlayerRef) {
		return db.CoachNote{}, db.ErrCoachPlayerUnknown
	}
	if f.CoachNotes == nil {
		f.CoachNotes = map[int64]map[string]db.CoachNote{}
	}
	if f.CoachNotes[n.PlayerRef] == nil {
		f.CoachNotes[n.PlayerRef] = map[string]db.CoachNote{}
	}
	now := nowRFC3339()
	n.CreatedAt, n.UpdatedAt = now, now
	if prev, ok := f.CoachNotes[n.PlayerRef][n.MatchKey]; ok {
		// A re-save keeps the first save's identity and creation instant.
		n.NoteID, n.CreatedAt = prev.NoteID, prev.CreatedAt
	} else if n.NoteID == "" {
		n.NoteID = db.NewCoachNoteID()
	}
	n.FocusTags, n.ExtraTags = distinctSorted(n.FocusTags), distinctSorted(n.ExtraTags)
	f.CoachNotes[n.PlayerRef][n.MatchKey] = n
	return n, nil
}

func (f *Fake) DeleteCoachNote(playerRef int64, matchKey string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.CoachNotes[playerRef], matchKey)
	return nil
}

func (f *Fake) LoadCoachNotes(playerRef int64) (map[string]db.CoachNote, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make(map[string]db.CoachNote, len(f.CoachNotes[playerRef]))
	maps.Copy(out, f.CoachNotes[playerRef])
	return out, nil
}

func (f *Fake) UpsertMatchCoachNote(n db.MatchCoachNote) (int64, error) {
	if n.NoteID == "" {
		return 0, errors.New("dbtest: upsert match coach note: note_id is required")
	}
	if err := checkFocusTags(n.FocusTags); err != nil {
		return 0, err
	}
	// The SQL store's UNIQUE (match_coach_note_id, moment_id) refuses this;
	// the Fake has to as well, or the two disagree about what is storable.
	seen := map[string]bool{}
	for _, m := range n.Moments {
		if seen[m.MomentID] {
			return 0, fmt.Errorf("dbtest: duplicate moment_id %q in one block", m.MomentID)
		}
		seen[m.MomentID] = true
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	n.FocusTags, n.ExtraTags = distinctSorted(n.FocusTags), distinctSorted(n.ExtraTags)
	if i := slices.IndexFunc(f.MatchCoachNotes, func(m db.MatchCoachNote) bool { return m.NoteID == n.NoteID }); i >= 0 {
		// Repeat import: update in place, keep id + first-accept instant.
		n.ID, n.AcceptedAt = f.MatchCoachNotes[i].ID, f.MatchCoachNotes[i].AcceptedAt
		f.MatchCoachNotes[i] = n
		return n.ID, nil
	}
	n.ID = nextID(f.MatchCoachNotes, func(m db.MatchCoachNote) int64 { return m.ID })
	// SQLStore's rule: a supplied instant is kept (a restore brings back WHEN
	// the player accepted the block), an empty one is stamped now.
	n.AcceptedAt = suppliedInstantOrNow(n.AcceptedAt)
	f.MatchCoachNotes = append(f.MatchCoachNotes, n)
	return n.ID, nil
}

func (f *Fake) DeleteMatchCoachNote(id int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	before := len(f.MatchCoachNotes)
	f.MatchCoachNotes = slices.DeleteFunc(f.MatchCoachNotes, func(m db.MatchCoachNote) bool { return m.ID == id })
	if len(f.MatchCoachNotes) == before {
		return db.ErrMatchCoachNoteUnknown
	}
	return nil
}

// LoadMatchCoachNotes groups the accepted blocks by match_key in
// (accepted_at, id) order — the slice is kept in insertion order, which is
// that order, so a stable sort by accepted_at suffices.
func (f *Fake) LoadMatchCoachNotes() (map[string][]db.MatchCoachNote, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ordered := slices.Clone(f.MatchCoachNotes)
	slices.SortStableFunc(ordered, func(a, b db.MatchCoachNote) int {
		return cmp.Or(strings.Compare(a.AcceptedAt, b.AcceptedAt), cmp.Compare(a.ID, b.ID))
	})
	out := map[string][]db.MatchCoachNote{}
	for _, n := range ordered {
		// The SQL store orders a block's moments by sort_order, so the Fake
		// must too — otherwise no Fake-backed test can ever see an ordering
		// bug, which is exactly how one shipped: the SQL read sorted the clock
		// STRING and put "10:00" before "9:00" while every test here passed.
		n.Moments = slices.SortedStableFunc(slices.Values(n.Moments),
			func(a, b db.MatchCoachNoteMoment) int { return cmp.Compare(a.SortOrder, b.SortOrder) })
		out[n.MatchKey] = append(out[n.MatchKey], n)
	}
	return out, nil
}

// dropCoachLayerForKey is HardDeleteMatch's coach step: forget the accepted
// blocks for matchKey and the return-sheet decisions that pointed at them.
// Callers hold f.mu.
func (f *Fake) dropCoachLayerForKey(matchKey string) {
	doomed := map[string]bool{}
	f.MatchCoachNotes = slices.DeleteFunc(f.MatchCoachNotes, func(m db.MatchCoachNote) bool {
		if m.MatchKey == matchKey {
			doomed[m.NoteID] = true
			return true
		}
		return false
	})
	for i := range f.CoachReturns {
		for noteID := range doomed {
			delete(f.CoachReturns[i].Decisions, noteID)
		}
	}
}

func (f *Fake) InsertCoachReturn(r db.CoachReturn) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if slices.ContainsFunc(f.CoachReturns, func(x db.CoachReturn) bool { return x.ContentHash == r.ContentHash }) {
		return 0, fmt.Errorf("dbtest: coach return %q violates the content_hash UNIQUE constraint", r.ContentHash)
	}
	r.ID = nextID(f.CoachReturns, func(x db.CoachReturn) int64 { return x.ID })
	r.ImportedAt = nowRFC3339()
	r.NotesJSON = slices.Clone(r.NotesJSON)
	r.Decisions = map[string]db.CoachDecision{}
	f.CoachReturns = append(f.CoachReturns, r)
	return r.ID, nil
}

// cloneCoachReturn detaches the mutable parts so a caller editing the
// result never reaches back into the Fake's state.
func cloneCoachReturn(r db.CoachReturn) db.CoachReturn {
	r.NotesJSON = slices.Clone(r.NotesJSON)
	decisions := make(map[string]db.CoachDecision, len(r.Decisions))
	maps.Copy(decisions, r.Decisions)
	r.Decisions = decisions
	return r
}

func (f *Fake) LookupCoachReturnByHash(hash string) (db.CoachReturn, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	i := slices.IndexFunc(f.CoachReturns, func(r db.CoachReturn) bool { return r.ContentHash == hash })
	if i < 0 {
		return db.CoachReturn{}, false, nil
	}
	return cloneCoachReturn(f.CoachReturns[i]), true, nil
}

func (f *Fake) LoadCoachReturn(id int64) (db.CoachReturn, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	i := slices.IndexFunc(f.CoachReturns, func(r db.CoachReturn) bool { return r.ID == id })
	if i < 0 {
		return db.CoachReturn{}, false, nil
	}
	return cloneCoachReturn(f.CoachReturns[i]), true, nil
}

// LoadCoachReturns lists newest first — imported_at descending, id breaking
// ties the way the SQL ORDER BY does.
func (f *Fake) LoadCoachReturns() ([]db.CoachReturn, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]db.CoachReturn, 0, len(f.CoachReturns))
	for _, r := range f.CoachReturns {
		out = append(out, cloneCoachReturn(r))
	}
	slices.SortStableFunc(out, func(a, b db.CoachReturn) int {
		return cmp.Or(strings.Compare(b.ImportedAt, a.ImportedAt), cmp.Compare(b.ID, a.ID))
	})
	return out, nil
}

func (f *Fake) SetCoachReturnDecision(returnID int64, noteID, decision string) error {
	if decision != "accepted" && decision != "skipped" {
		return fmt.Errorf("dbtest: decision %q violates the accepted/skipped CHECK", decision)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	i := slices.IndexFunc(f.CoachReturns, func(r db.CoachReturn) bool { return r.ID == returnID })
	if i < 0 {
		return db.ErrCoachReturnUnknown
	}
	if f.CoachReturns[i].Decisions == nil {
		f.CoachReturns[i].Decisions = map[string]db.CoachDecision{}
	}
	f.CoachReturns[i].Decisions[noteID] = db.CoachDecision{Decision: decision, DecidedAt: nowRFC3339()}
	return nil
}

func (f *Fake) DeleteCoachReturn(id int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	before := len(f.CoachReturns)
	f.CoachReturns = slices.DeleteFunc(f.CoachReturns, func(r db.CoachReturn) bool { return r.ID == id })
	if len(f.CoachReturns) == before {
		return db.ErrCoachReturnUnknown
	}
	// received_focus_items.return_id is ON DELETE CASCADE; the Fake keeps no
	// engine, so the cascade is spelled here.
	f.ReceivedFocusItems = slices.DeleteFunc(f.ReceivedFocusItems,
		func(it db.ReceivedFocusItem) bool { return it.ReturnID == id })
	return nil
}

func (f *Fake) LoadMatchKeys() (map[string]bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]bool{}
	for k := range f.UserMatchData {
		out[k] = true
	}
	collectMatchKeys(f.Summaries, out)
	collectMatchKeys(f.Teams, out)
	collectMatchKeys(f.Personals, out)
	collectMatchKeys(f.Ranks, out)
	collectMatchKeys(f.Unknowns, out)
	return out, nil
}

// collectMatchKeys adds every row's match key into the accumulator set.
func collectMatchKeys[T parentRow](rows []T, into map[string]bool) {
	for _, r := range rows {
		into[rowMatchKey(r)] = true
	}
}

// ── A note's timestamped moments ──────────────────────────────────────────

// CoachNoteMoments mirrors the SQL store's shape: moments keyed by the parent
// note's PUBLIC id, which is what the API path and the loader both use.
// Guarded by f.mu like every other map here.

func (f *Fake) UpsertCoachNoteMoment(playerRef int64, m db.CoachNoteMoment) (db.CoachNoteMoment, error) {
	if m.FocusTag != "" {
		if err := checkFocusTags([]string{m.FocusTag}); err != nil {
			return db.CoachNoteMoment{}, err
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.noteExists(playerRef, m.NoteID) {
		return db.CoachNoteMoment{}, db.ErrCoachNoteUnknown
	}
	if f.CoachNoteMoments == nil {
		f.CoachNoteMoments = map[string][]db.CoachNoteMoment{}
	}
	now := nowRFC3339()
	m.CreatedAt, m.UpdatedAt = now, now
	existing := f.CoachNoteMoments[m.NoteID]
	for i, prev := range existing {
		if prev.MomentID != "" && prev.MomentID == m.MomentID {
			// An edit keeps the first save's identity and creation instant.
			m.CreatedAt = prev.CreatedAt
			existing[i] = m
			return m, nil
		}
	}
	if m.MomentID == "" {
		m.MomentID = db.NewCoachNoteID()
	}
	f.CoachNoteMoments[m.NoteID] = append(existing, m)
	return m, nil
}

func (f *Fake) DeleteCoachNoteMoment(playerRef int64, momentID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for noteID, moments := range f.CoachNoteMoments {
		if !f.noteExists(playerRef, noteID) {
			continue
		}
		f.CoachNoteMoments[noteID] = slices.DeleteFunc(moments,
			func(m db.CoachNoteMoment) bool { return m.MomentID == momentID })
	}
	return nil
}

func (f *Fake) LoadCoachNoteMoments(playerRef int64) (map[string][]db.CoachNoteMoment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string][]db.CoachNoteMoment{}
	for noteID, moments := range f.CoachNoteMoments {
		if !f.noteExists(playerRef, noteID) || len(moments) == 0 {
			continue
		}
		out[noteID] = slices.Clone(moments)
	}
	return out, nil
}

// noteExists reports whether this player has a note with that public id —
// the Fake's stand-in for the SQL scope check. Callers hold f.mu.
func (f *Fake) noteExists(playerRef int64, noteID string) bool {
	if noteID == "" {
		return false
	}
	for _, n := range f.CoachNotes[playerRef] {
		if n.NoteID == noteID {
			return true
		}
	}
	return false
}

// LoadCoachPlayers mirrors the SQL roster: every coached player with note
// count, newest note stamp, and summary — most recently touched first
// (never-touched players last, newest id first among them).
func (f *Fake) LoadCoachPlayers() ([]db.CoachPlayerSummary, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]db.CoachPlayerSummary, 0, len(f.CoachPlayers))
	for _, p := range f.CoachPlayers {
		row := db.CoachPlayerSummary{ID: p.ID, Handle: p.Handle}
		for _, n := range f.CoachNotes[p.ID] {
			row.NoteCount++
			if n.UpdatedAt > row.LastNoteAt {
				row.LastNoteAt = n.UpdatedAt
			}
		}
		for _, it := range f.CoachFocusItems[p.ID] {
			row.FocusItems = append(row.FocusItems, it.Text)
		}
		out = append(out, row)
	}
	slices.SortFunc(out, func(a, b db.CoachPlayerSummary) int {
		if c := cmp.Compare(b.LastNoteAt, a.LastNoteAt); c != 0 {
			return c
		}
		return cmp.Compare(b.ID, a.ID)
	})
	return out, nil
}
