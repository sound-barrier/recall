package db

import (
	"database/sql"
	"errors"
	"fmt"
)

// Coach-AUTHORED family: coach_players, coach_notes (+ tag children) and
// coach_session_summaries. Keyed by the player a session was about, never by
// a local match — Clear() and HardDeleteMatch() leave all of it alone.

const (
	coachNoteFocusTagsTable = "coach_note_focus_tags"
	coachNoteExtraTagsTable = "coach_note_extra_tags"
	coachNoteParentColumn   = "coach_note_id"
)

func (s *SQLStore) EnsureCoachPlayer(playerID, handle string) (CoachPlayer, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return CoachPlayer{}, err
	}
	defer func() { _ = tx.Rollback() }()
	p, found, err := findOrAdoptCoachPlayer(tx, playerID, handle)
	if err != nil {
		return CoachPlayer{}, err
	}
	if !found {
		if p, err = insertCoachPlayer(tx, playerID, handle); err != nil {
			return CoachPlayer{}, err
		}
	}
	return p, tx.Commit()
}

// findOrAdoptCoachPlayer resolves identity in order: the player_id when the
// bundle carried one; else the handle (NOCASE). With a player_id in hand only
// an id-less handle row may be adopted — it gets the id backfilled — so two
// identified players sharing a handle stay two rows.
//
// The adopt is how a player who shared anonymously, from a build predating the
// player identity, keeps their notes when they upgrade. It is NOT a guess: if
// two id-less rows go by that handle, this refuses rather than picking one,
// because the backfill would attribute one player's notes to another and the
// next share-back export would hand them over.
func findOrAdoptCoachPlayer(tx *sql.Tx, playerID, handle string) (CoachPlayer, bool, error) {
	if playerID != "" {
		p, found, err := selectCoachPlayer(tx, `WHERE player_id = ?`, playerID)
		if err != nil || found {
			return p, found, err
		}
		p, found, err = selectSoleIDLessPlayer(tx, handle)
		if err != nil || !found {
			return p, found, err
		}
		if _, err := tx.Exec(`UPDATE coach_players SET player_id = ? WHERE id = ?`, playerID, p.ID); err != nil {
			return CoachPlayer{}, false, fmt.Errorf("backfill coach player id: %w", err)
		}
		p.PlayerID = playerID
		return p, true, nil
	}
	return selectCoachPlayer(tx, `WHERE handle = ? ORDER BY id LIMIT 1`, handle)
}

// selectSoleIDLessPlayer reads the one id-less row under a handle, or reports
// ErrCoachHandleAmbiguous when there are two. LIMIT 2 rather than LIMIT 1: the
// point is to SEE the second row, which an ORDER BY over LIMIT 1 hides behind
// a stable, plausible answer.
func selectSoleIDLessPlayer(tx *sql.Tx, handle string) (CoachPlayer, bool, error) {
	rows, err := tx.Query(
		`SELECT id, player_id, handle FROM coach_players
		  WHERE handle = ? AND player_id IS NULL ORDER BY id LIMIT 2`, handle)
	if err != nil {
		return CoachPlayer{}, false, fmt.Errorf("find coach player: %w", err)
	}
	defer func() { _ = rows.Close() }()

	var found []CoachPlayer
	for rows.Next() {
		var p CoachPlayer
		var playerID sql.NullString
		if err := rows.Scan(&p.ID, &playerID, &p.Handle); err != nil {
			return CoachPlayer{}, false, fmt.Errorf("scan coach player: %w", err)
		}
		p.PlayerID = playerID.String
		found = append(found, p)
	}
	if err := rows.Err(); err != nil {
		return CoachPlayer{}, false, fmt.Errorf("find coach player: %w", err)
	}
	if len(found) > 1 {
		return CoachPlayer{}, false, fmt.Errorf("%w: %q", ErrCoachHandleAmbiguous, handle)
	}
	if len(found) == 0 {
		return CoachPlayer{}, false, nil
	}
	return found[0], true, nil
}

// selectCoachPlayer reads one row by the given predicate; (zero, false, nil)
// when none matches. The handle column is declared COLLATE NOCASE, so the
// handle predicates compare case-insensitively without spelling it out.
func selectCoachPlayer(tx *sql.Tx, where string, arg any) (CoachPlayer, bool, error) {
	var p CoachPlayer
	var playerID sql.NullString
	// #nosec G202 -- where is one of the constant predicates above.
	err := tx.QueryRow(`SELECT id, player_id, handle FROM coach_players `+where, arg).Scan(&p.ID, &playerID, &p.Handle)
	if errors.Is(err, sql.ErrNoRows) {
		return CoachPlayer{}, false, nil
	}
	if err != nil {
		return CoachPlayer{}, false, fmt.Errorf("find coach player: %w", err)
	}
	p.PlayerID = playerID.String
	return p, true, nil
}

func insertCoachPlayer(tx *sql.Tx, playerID, handle string) (CoachPlayer, error) {
	p := CoachPlayer{PlayerID: playerID, Handle: handle}
	// An empty player_id is stored as NULL so the UNIQUE constraint tolerates
	// any number of anonymous players.
	err := tx.QueryRow(
		`INSERT INTO coach_players (player_id, handle) VALUES (?, ?) RETURNING id`,
		sql.NullString{String: playerID, Valid: playerID != ""}, handle,
	).Scan(&p.ID)
	if err != nil {
		return CoachPlayer{}, fmt.Errorf("insert coach player: %w", err)
	}
	return p, nil
}

func (s *SQLStore) RenameCoachPlayer(id int64, handle string) error {
	res, err := s.db.Exec(`UPDATE coach_players SET handle = ? WHERE id = ?`, handle, id)
	if err != nil {
		return err
	}
	return requireAffected(res, ErrCoachPlayerUnknown)
}

// requireAffected turns "the statement matched no row" into the caller's
// sentinel, so an unknown id surfaces as a typed error rather than a silent
// no-op.
func requireAffected(res sql.Result, missing error) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return missing
	}
	return nil
}

// requireCoachPlayer maps a dangling playerRef to ErrCoachPlayerUnknown
// before a write would otherwise fail on the FK with an opaque SQLite error.
func requireCoachPlayer(tx *sql.Tx, playerRef int64) error {
	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM coach_players WHERE id = ?)`, playerRef).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrCoachPlayerUnknown
	}
	return nil
}

func (s *SQLStore) UpsertCoachNote(n CoachNote) (CoachNote, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return CoachNote{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireCoachPlayer(tx, n.PlayerRef); err != nil {
		return CoachNote{}, err
	}
	if n.NoteID == "" {
		n.NoteID = NewCoachNoteID()
	}
	// note_id is absent from the SET clause on purpose: the first save's id is
	// the note's identity, and a re-save (which may carry a fresh mint) keeps it.
	var id int64
	err = tx.QueryRow(
		`INSERT INTO coach_notes (note_id, player_ref, match_key, kind, text, match_clock)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(player_ref, match_key) DO UPDATE SET
		   kind        = excluded.kind,
		   text        = excluded.text,
		   match_clock = excluded.match_clock,
		   updated_at  = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
		 RETURNING id, note_id, created_at, updated_at`,
		n.NoteID, n.PlayerRef, n.MatchKey, n.Kind, n.Text, n.MatchClock,
	).Scan(&id, &n.NoteID, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return CoachNote{}, fmt.Errorf("upsert coach note: %w", err)
	}
	if err := replaceTagSetByID(tx, coachNoteFocusTagsTable, coachNoteParentColumn, id, n.FocusTags); err != nil {
		return CoachNote{}, err
	}
	if err := replaceTagSetByID(tx, coachNoteExtraTagsTable, coachNoteParentColumn, id, n.ExtraTags); err != nil {
		return CoachNote{}, err
	}
	n.FocusTags, n.ExtraTags = distinctSorted(n.FocusTags), distinctSorted(n.ExtraTags)
	return n, tx.Commit()
}

func (s *SQLStore) DeleteCoachNote(playerRef int64, matchKey string) error {
	// Tag children CASCADE on the coach_note_id FK.
	_, err := s.db.Exec(`DELETE FROM coach_notes WHERE player_ref = ? AND match_key = ?`, playerRef, matchKey)
	return err
}

func (s *SQLStore) LoadCoachNotes(playerRef int64) (map[string]CoachNote, error) {
	byID, err := s.loadCoachNoteRows(playerRef)
	if err != nil {
		return nil, err
	}
	for _, child := range []struct {
		table  string
		assign func(*CoachNote, string)
	}{
		{coachNoteFocusTagsTable, func(n *CoachNote, tag string) { n.FocusTags = append(n.FocusTags, tag) }},
		{coachNoteExtraTagsTable, func(n *CoachNote, tag string) { n.ExtraTags = append(n.ExtraTags, tag) }},
	} {
		// #nosec G202 -- table name comes from the constants above.
		query := `SELECT t.` + coachNoteParentColumn + `, t.tag FROM ` + child.table + ` t
		          JOIN coach_notes n ON n.id = t.` + coachNoteParentColumn + `
		          WHERE n.player_ref = ? ORDER BY t.` + coachNoteParentColumn + `, t.tag`
		err := loadChildValuesByID(s.db, query, []any{playerRef}, func(id int64, tag string) {
			if n, ok := byID[id]; ok {
				child.assign(n, tag)
			}
		})
		if err != nil {
			return nil, fmt.Errorf("load %s: %w", child.table, err)
		}
	}
	out := make(map[string]CoachNote, len(byID))
	for _, n := range byID {
		out[n.MatchKey] = *n
	}
	return out, nil
}

// loadCoachNoteRows reads one player's parent rows keyed by row id so the
// tag loaders can attach by the FK before the map is re-keyed by match_key.
func (s *SQLStore) loadCoachNoteRows(playerRef int64) (map[int64]*CoachNote, error) {
	rows, err := s.db.Query(
		`SELECT id, note_id, match_key, kind, text, match_clock, created_at, updated_at
		 FROM coach_notes WHERE player_ref = ?`, playerRef,
	)
	if err != nil {
		return nil, fmt.Errorf("load coach notes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := map[int64]*CoachNote{}
	for rows.Next() {
		var id int64
		n := CoachNote{PlayerRef: playerRef}
		if err := rows.Scan(&id, &n.NoteID, &n.MatchKey, &n.Kind, &n.Text, &n.MatchClock, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, fmt.Errorf("load coach notes: %w", err)
		}
		out[id] = &n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load coach notes: %w", err)
	}
	return out, nil
}

// ── A note's timestamped moments ──────────────────────────────────────────
//
// Moments hang off a note rather than replacing it: the note stays the
// per-match record (overall text, tags, the reviewed mark) and the moments are
// what a coach points AT while watching the replay. Addressed by their own
// public id, because unlike a note — which the match key identifies — there
// can be several on one match and the path has to say which.

const coachMomentFocusTagsTable = "coach_note_moment_focus_tags"

// noteRowID resolves a note's public id to its row id, scoped to the player so
// one session can never reach another's notes through a guessed id.
func noteRowID(tx *sql.Tx, playerRef int64, noteID string) (int64, error) {
	var id int64
	err := tx.QueryRow(
		`SELECT id FROM coach_notes WHERE note_id = ? AND player_ref = ?`, noteID, playerRef,
	).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrCoachNoteUnknown
	}
	if err != nil {
		return 0, fmt.Errorf("resolve coach note: %w", err)
	}
	return id, nil
}

func (s *SQLStore) UpsertCoachNoteMoment(playerRef int64, m CoachNoteMoment) (CoachNoteMoment, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return CoachNoteMoment{}, err
	}
	defer func() { _ = tx.Rollback() }()
	noteRow, err := noteRowID(tx, playerRef, m.NoteID)
	if err != nil {
		return CoachNoteMoment{}, err
	}
	if m.MomentID == "" {
		m.MomentID = NewCoachNoteID()
	}
	// moment_id is absent from the SET clause for the same reason note_id is:
	// the first save's id is the moment's identity, and an edit keeps it.
	var id int64
	err = tx.QueryRow(
		`INSERT INTO coach_note_moments (moment_id, coach_note_id, match_clock, text, sort_order)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(coach_note_id, moment_id) DO UPDATE SET
		   match_clock = excluded.match_clock,
		   text        = excluded.text,
		   sort_order  = excluded.sort_order,
		   updated_at  = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
		 RETURNING id, created_at, updated_at`,
		m.MomentID, noteRow, m.MatchClock, m.Text, m.SortOrder,
	).Scan(&id, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return CoachNoteMoment{}, fmt.Errorf("upsert coach note moment: %w", err)
	}
	// One tag, stored through the set helper so it shares the sibling's CHECK.
	tags := []string{}
	if m.FocusTag != "" {
		tags = append(tags, m.FocusTag)
	}
	if err := replaceTagSetByID(tx, coachMomentFocusTagsTable, "coach_note_moment_id", id, tags); err != nil {
		return CoachNoteMoment{}, err
	}
	return m, tx.Commit()
}

// DeleteCoachNoteMoment removes one moment. Scoped to the player: a moment id
// is unique within its note, not globally, so a bare id could otherwise name
// rows in several notes at once.
func (s *SQLStore) DeleteCoachNoteMoment(playerRef int64, momentID string) error {
	_, err := s.db.Exec(
		`DELETE FROM coach_note_moments
		 WHERE moment_id = ? AND coach_note_id IN (
		   SELECT id FROM coach_notes WHERE player_ref = ?
		 )`, momentID, playerRef)
	return err
}

// LoadCoachNoteMoments reads every moment for one player, keyed by the PUBLIC
// note id its parent carries — the same id the API path uses, so a caller
// never has to know a row id.
// scannedMoment pairs a moment with its row id, which the tag join needs and
// the caller never sees.
type scannedMoment struct {
	rowID  int64
	moment CoachNoteMoment
}

// LoadCoachNoteMoments reads every moment on a player's coach notes, keyed by
// note id. Three steps, one each: read the moments, read their tags, put them
// together.
func (s *SQLStore) LoadCoachNoteMoments(playerRef int64) (map[string][]CoachNoteMoment, error) {
	all, err := s.scanCoachNoteMoments(playerRef)
	if err != nil {
		return nil, err
	}
	tagByRowID, err := s.loadCoachMomentTags(playerRef)
	if err != nil {
		return nil, err
	}
	out := map[string][]CoachNoteMoment{}
	for _, row := range all {
		row.moment.FocusTag = tagByRowID[row.rowID]
		out[row.moment.NoteID] = append(out[row.moment.NoteID], row.moment)
	}
	return out, nil
}

// scanCoachNoteMoments reads the moments flat.
//
// Flat, and assembled by the caller — NOT appended into the output map while
// holding pointers into it. append reallocates, and a pointer taken before a
// regrow then decorates a copy nobody reads: the tags would silently vanish
// for every moment but the last.
func (s *SQLStore) scanCoachNoteMoments(playerRef int64) ([]scannedMoment, error) {
	rows, err := s.db.Query(
		`SELECT m.id, m.moment_id, n.note_id, m.match_clock, m.text, m.sort_order,
		        m.created_at, m.updated_at
		 FROM coach_note_moments m
		 JOIN coach_notes n ON n.id = m.coach_note_id
		 WHERE n.player_ref = ?
		 ORDER BY m.coach_note_id, m.match_clock, m.sort_order`, playerRef)
	if err != nil {
		return nil, fmt.Errorf("load coach note moments: %w", err)
	}
	defer func() { _ = rows.Close() }()

	all := []scannedMoment{}
	for rows.Next() {
		var row scannedMoment
		m := &row.moment
		if err := rows.Scan(&row.rowID, &m.MomentID, &m.NoteID, &m.MatchClock, &m.Text,
			&m.SortOrder, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan coach note moment: %w", err)
		}
		all = append(all, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load coach note moments: %w", err)
	}
	return all, nil
}

// loadCoachMomentTags reads each moment's focus tag, keyed by moment row id.
func (s *SQLStore) loadCoachMomentTags(playerRef int64) (map[int64]string, error) {
	tagByRowID := map[int64]string{}
	// #nosec G202 -- table name is the constant above.
	query := `SELECT t.coach_note_moment_id, t.tag FROM ` + coachMomentFocusTagsTable + ` t
	          JOIN coach_note_moments m ON m.id = t.coach_note_moment_id
	          JOIN coach_notes n ON n.id = m.coach_note_id
	          WHERE n.player_ref = ?`
	err := loadChildValuesByID(s.db, query, []any{playerRef}, func(id int64, tag string) {
		tagByRowID[id] = tag
	})
	if err != nil {
		return nil, fmt.Errorf("load %s: %w", coachMomentFocusTagsTable, err)
	}
	return tagByRowID, nil
}

// LoadCoachPlayers is the roster — every coached player, most recently
// touched first. A player with zero notes (ensured but never written about)
// still lists: the coach met them, and the row says the work is empty.
func (s *SQLStore) LoadCoachPlayers() ([]CoachPlayerSummary, error) {
	rows, err := s.db.Query(`
		SELECT
			p.id,
			p.handle,
			COUNT(n.id),
			COALESCE(MAX(n.updated_at), '')
		FROM coach_players AS p
		LEFT JOIN coach_notes AS n ON n.player_ref = p.id
		GROUP BY p.id
		ORDER BY MAX(n.updated_at) DESC NULLS LAST, p.id DESC`)
	if err != nil {
		return nil, fmt.Errorf("load coach players: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := []CoachPlayerSummary{}
	for rows.Next() {
		var r CoachPlayerSummary
		if err := rows.Scan(&r.ID, &r.Handle, &r.NoteCount, &r.LastNoteAt); err != nil {
			return nil, fmt.Errorf("scan coach player summary: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// The focus list per player, read after the scan: a join would multiply
	// the note COUNT by the number of items.
	for i := range out {
		items, err := s.LoadCoachFocusItems(out[i].ID)
		if err != nil {
			return nil, err
		}
		for _, it := range items {
			out[i].FocusItems = append(out[i].FocusItems, it.Text)
		}
	}
	return out, nil
}
