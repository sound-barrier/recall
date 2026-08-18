package db

import (
	"database/sql"
	"errors"
	"fmt"
)

// Coach-RECEIVED family: match_coach_notes (+ tag children) — blocks another
// coach wrote that this user accepted onto their own matches — and
// coach_returns (+ decisions), the staged notes files those blocks came from.
// Keyed by local match_key like every sidecar: HardDeleteMatch, Clear and
// profiles.Move all treat it as match history.

const (
	matchCoachNoteFocusTagsTable = "match_coach_note_focus_tags"
	matchCoachNoteExtraTagsTable = "match_coach_note_extra_tags"
	matchCoachNoteParentColumn   = "match_coach_note_id"
)

func (s *SQLStore) UpsertMatchCoachNote(n MatchCoachNote) (int64, error) {
	if n.NoteID == "" {
		return 0, errors.New("upsert match coach note: note_id is required")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()
	// accepted_at is absent from the SET clause: the first-accept instant
	// survives a repeat import, mirroring parsed_at on the parent tables.
	// The INSERT honors a supplied instant so a restore brings back WHEN the
	// player accepted the block, and stamps the clock when there is none
	// (the live accept).
	var id int64
	err = tx.QueryRow(
		`INSERT INTO match_coach_notes (note_id, match_key, coach_name, session_date, text, match_clock, accepted_at)
		 VALUES (?, ?, ?, ?, ?, ?, `+suppliedInstantOrNow+`)
		 ON CONFLICT(note_id) DO UPDATE SET
		   match_key    = excluded.match_key,
		   coach_name   = excluded.coach_name,
		   session_date = excluded.session_date,
		   text         = excluded.text,
		   match_clock  = excluded.match_clock
		 RETURNING id`,
		n.NoteID, n.MatchKey, n.CoachName, n.SessionDate, n.Text, n.MatchClock, n.AcceptedAt,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("upsert match coach note: %w", err)
	}
	if err := replaceTagSetByID(tx, matchCoachNoteFocusTagsTable, matchCoachNoteParentColumn, id, n.FocusTags); err != nil {
		return 0, err
	}
	if err := replaceTagSetByID(tx, matchCoachNoteExtraTagsTable, matchCoachNoteParentColumn, id, n.ExtraTags); err != nil {
		return 0, err
	}
	if err := replaceNoteMoments(tx, id, n.Moments); err != nil {
		return 0, err
	}
	return id, tx.Commit()
}

// replaceNoteMoments rewrites an accepted block's moments wholesale, the same
// way the tag sets are replaced: a re-import carries the coach's current list,
// and merging would leave a moment they deleted between sessions on a match
// the player already accepted.
func replaceNoteMoments(tx *sql.Tx, noteID int64, moments []MatchCoachNoteMoment) error {
	if _, err := tx.Exec(
		`DELETE FROM match_coach_note_moments WHERE match_coach_note_id = ?`, noteID); err != nil {
		return fmt.Errorf("clear note moments: %w", err)
	}
	for _, m := range moments {
		if _, err := tx.Exec(
			`INSERT INTO match_coach_note_moments
			   (match_coach_note_id, moment_id, match_clock, text, focus_tag, sort_order)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			noteID, m.MomentID, m.MatchClock, m.Text, m.FocusTag, m.SortOrder,
		); err != nil {
			return fmt.Errorf("insert note moment: %w", err)
		}
	}
	return nil
}

func (s *SQLStore) DeleteMatchCoachNote(id int64) error {
	// Tag children CASCADE on the match_coach_note_id FK.
	res, err := s.db.Exec(`DELETE FROM match_coach_notes WHERE id = ?`, id)
	if err != nil {
		return err
	}
	return requireAffected(res, ErrMatchCoachNoteUnknown)
}

func (s *SQLStore) LoadMatchCoachNotes() (map[string][]MatchCoachNote, error) {
	byID, order, err := s.loadMatchCoachNoteRows()
	if err != nil {
		return nil, err
	}
	for _, child := range []struct {
		table  string
		assign func(*MatchCoachNote, string)
	}{
		{matchCoachNoteFocusTagsTable, func(n *MatchCoachNote, tag string) { n.FocusTags = append(n.FocusTags, tag) }},
		{matchCoachNoteExtraTagsTable, func(n *MatchCoachNote, tag string) { n.ExtraTags = append(n.ExtraTags, tag) }},
	} {
		// #nosec G202 -- table name comes from the constants above.
		query := `SELECT ` + matchCoachNoteParentColumn + `, tag FROM ` + child.table +
			` ORDER BY ` + matchCoachNoteParentColumn + `, tag`
		err := loadChildValuesByID(s.db, query, nil, func(id int64, tag string) {
			if n, ok := byID[id]; ok {
				child.assign(n, tag)
			}
		})
		if err != nil {
			return nil, fmt.Errorf("load %s: %w", child.table, err)
		}
	}
	if err := attachNoteMoments(s.db, byID); err != nil {
		return nil, err
	}
	out := map[string][]MatchCoachNote{}
	for _, id := range order {
		n := byID[id]
		out[n.MatchKey] = append(out[n.MatchKey], *n)
	}
	return out, nil
}

// attachNoteMoments hangs each block's moments on it, already in reading
// order — the ORDER BY is the strip's order, so no caller has to re-sort.
func attachNoteMoments(q *sql.DB, byID map[int64]*MatchCoachNote) error {
	rows, err := q.Query(
		`SELECT match_coach_note_id, moment_id, match_clock, text, focus_tag, sort_order
		 FROM match_coach_note_moments
		 ORDER BY match_coach_note_id, match_clock, sort_order`)
	if err != nil {
		return fmt.Errorf("load match coach note moments: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var parent int64
		var m MatchCoachNoteMoment
		if err := rows.Scan(&parent, &m.MomentID, &m.MatchClock, &m.Text, &m.FocusTag, &m.SortOrder); err != nil {
			return fmt.Errorf("scan match coach note moment: %w", err)
		}
		if n, ok := byID[parent]; ok {
			n.Moments = append(n.Moments, m)
		}
	}
	return rows.Err()
}

// loadMatchCoachNoteRows reads every accepted block keyed by row id, plus
// the (accepted_at, id) order the per-match lists are assembled in.
func (s *SQLStore) loadMatchCoachNoteRows() (map[int64]*MatchCoachNote, []int64, error) {
	rows, err := s.db.Query(
		`SELECT id, note_id, match_key, coach_name, session_date, text, match_clock, accepted_at
		 FROM match_coach_notes ORDER BY accepted_at, id`,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("load match coach notes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	byID := map[int64]*MatchCoachNote{}
	var order []int64
	for rows.Next() {
		var n MatchCoachNote
		if err := rows.Scan(&n.ID, &n.NoteID, &n.MatchKey, &n.CoachName, &n.SessionDate, &n.Text, &n.MatchClock, &n.AcceptedAt); err != nil {
			return nil, nil, fmt.Errorf("load match coach notes: %w", err)
		}
		byID[n.ID] = &n
		order = append(order, n.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("load match coach notes: %w", err)
	}
	return byID, order, nil
}

func (s *SQLStore) InsertCoachReturn(r CoachReturn) (int64, error) {
	var id int64
	// notes_json is a TEXT column (STRICT rejects a BLOB there), so the raw
	// document is bound as a string and read back into bytes.
	err := s.db.QueryRow(
		`INSERT INTO coach_returns (content_hash, coach_name, player_handle, session_date, notes_json)
		 VALUES (?, ?, ?, ?, ?) RETURNING id`,
		r.ContentHash, r.CoachName, r.PlayerHandle, r.SessionDate, string(r.NotesJSON),
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("insert coach return: %w", err)
	}
	return id, nil
}

const selectCoachReturnSQL = `SELECT id, content_hash, coach_name, player_handle, session_date, notes_json, imported_at
	 FROM coach_returns `

func (s *SQLStore) LookupCoachReturnByHash(hash string) (CoachReturn, bool, error) {
	return s.loadOneCoachReturn(selectCoachReturnSQL+`WHERE content_hash = ?`, hash)
}

func (s *SQLStore) LoadCoachReturn(id int64) (CoachReturn, bool, error) {
	return s.loadOneCoachReturn(selectCoachReturnSQL+`WHERE id = ?`, id)
}

// loadOneCoachReturn reads a single return by predicate and attaches its
// decisions; (zero, false, nil) when none matches.
func (s *SQLStore) loadOneCoachReturn(query string, arg any) (CoachReturn, bool, error) {
	var r CoachReturn
	var notesJSON string
	err := s.db.QueryRow(query, arg).Scan(
		&r.ID, &r.ContentHash, &r.CoachName, &r.PlayerHandle, &r.SessionDate, &notesJSON, &r.ImportedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return CoachReturn{}, false, nil
	}
	if err != nil {
		return CoachReturn{}, false, fmt.Errorf("load coach return: %w", err)
	}
	r.NotesJSON = []byte(notesJSON)
	r.Decisions = map[string]CoachDecision{}
	if err := s.attachCoachDecisions(map[int64]*CoachReturn{r.ID: &r}, `WHERE return_id = ?`, r.ID); err != nil {
		return CoachReturn{}, false, err
	}
	return r, true, nil
}

func (s *SQLStore) LoadCoachReturns() ([]CoachReturn, error) {
	// imported_at has second resolution; id breaks ties so two files staged
	// in the same second still list newest first.
	rows, err := s.db.Query(selectCoachReturnSQL + `ORDER BY imported_at DESC, id DESC`)
	if err != nil {
		return nil, fmt.Errorf("load coach returns: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := make([]CoachReturn, 0)
	byID := map[int64]*CoachReturn{}
	for rows.Next() {
		var r CoachReturn
		var notesJSON string
		if err := rows.Scan(&r.ID, &r.ContentHash, &r.CoachName, &r.PlayerHandle, &r.SessionDate, &notesJSON, &r.ImportedAt); err != nil {
			return nil, fmt.Errorf("load coach returns: %w", err)
		}
		r.NotesJSON = []byte(notesJSON)
		r.Decisions = map[string]CoachDecision{}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load coach returns: %w", err)
	}
	for i := range out {
		byID[out[i].ID] = &out[i]
	}
	return out, s.attachCoachDecisions(byID, ``)
}

// attachCoachDecisions folds coach_return_decisions rows into the returns
// they belong to. where scopes the read (one return, or every return).
func (s *SQLStore) attachCoachDecisions(byID map[int64]*CoachReturn, where string, args ...any) error {
	// #nosec G202 -- where is one of the constant predicates in this file.
	rows, err := s.db.Query(`SELECT return_id, note_id, decision, decided_at FROM coach_return_decisions `+where, args...)
	if err != nil {
		return fmt.Errorf("load coach return decisions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var returnID int64
		var noteID string
		var d CoachDecision
		if err := rows.Scan(&returnID, &noteID, &d.Decision, &d.DecidedAt); err != nil {
			return fmt.Errorf("load coach return decisions: %w", err)
		}
		if r, ok := byID[returnID]; ok {
			r.Decisions[noteID] = d
		}
	}
	return rows.Err()
}

func (s *SQLStore) SetCoachReturnDecision(returnID int64, noteID, decision string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM coach_returns WHERE id = ?)`, returnID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrCoachReturnUnknown
	}
	if _, err := tx.Exec(
		`INSERT INTO coach_return_decisions (return_id, note_id, decision) VALUES (?, ?, ?)
		 ON CONFLICT(return_id, note_id) DO UPDATE SET
		   decision   = excluded.decision,
		   decided_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		returnID, noteID, decision,
	); err != nil {
		return fmt.Errorf("set coach return decision: %w", err)
	}
	return tx.Commit()
}

func (s *SQLStore) DeleteCoachReturn(id int64) error {
	// Decisions CASCADE on the return_id FK.
	res, err := s.db.Exec(`DELETE FROM coach_returns WHERE id = ?`, id)
	if err != nil {
		return err
	}
	return requireAffected(res, ErrCoachReturnUnknown)
}
