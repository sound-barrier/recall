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
func findOrAdoptCoachPlayer(tx *sql.Tx, playerID, handle string) (CoachPlayer, bool, error) {
	if playerID != "" {
		p, found, err := selectCoachPlayer(tx, `WHERE player_id = ?`, playerID)
		if err != nil || found {
			return p, found, err
		}
		p, found, err = selectCoachPlayer(tx, `WHERE handle = ? AND player_id IS NULL ORDER BY id LIMIT 1`, handle)
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

func (s *SQLStore) SetCoachSummary(playerRef int64, text string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireCoachPlayer(tx, playerRef); err != nil {
		return err
	}
	if text == "" {
		_, err = tx.Exec(`DELETE FROM coach_session_summaries WHERE player_ref = ?`, playerRef)
	} else {
		_, err = tx.Exec(
			`INSERT INTO coach_session_summaries (player_ref, text) VALUES (?, ?)
			 ON CONFLICT(player_ref) DO UPDATE SET
			   text       = excluded.text,
			   updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
			playerRef, text,
		)
	}
	if err != nil {
		return fmt.Errorf("set coach summary: %w", err)
	}
	return tx.Commit()
}

func (s *SQLStore) LoadCoachSummary(playerRef int64) (CoachSummary, bool, error) {
	out := CoachSummary{PlayerRef: playerRef}
	err := s.db.QueryRow(
		`SELECT text, updated_at FROM coach_session_summaries WHERE player_ref = ?`, playerRef,
	).Scan(&out.Text, &out.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CoachSummary{}, false, nil
	}
	if err != nil {
		return CoachSummary{}, false, fmt.Errorf("load coach summary: %w", err)
	}
	return out, true, nil
}
