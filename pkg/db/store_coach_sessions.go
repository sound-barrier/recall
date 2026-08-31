package db

import (
	"database/sql"
	"fmt"
)

// The coach's own sittings — one row per session, written when the corpus
// is claimed and stamped when it is handed back.
//
// Before this, the database recorded WHEN a coach worked only as each
// note's own timestamps, so the dossier's "last session" honestly meant
// "last note touched", and a sitting that produced no notes left no trace
// at all. Coach-AUTHORED, like coach_notes: it survives Clear(), and the
// match keys in it belong to another player's corpus.

// CoachSessionRow is one sitting: who it was about, where its corpus came
// from, when it opened and — once handed back — when it ended.
//
// Handle and Kind are SNAPSHOTS beside PlayerRef so a renamed player does
// not rewrite the history of who a sitting was about. EndedAt is empty on
// an abandoned sitting, which is kept on purpose.
type CoachSessionRow struct {
	SessionID string
	PlayerRef int64
	Handle    string
	Kind      string
	Source    string
	OpenedAt  string
	EndedAt   string
	MatchKeys []string
	// FocusItems is the list as it stood at End — by value, not by
	// reference. See schema.sql for why.
	FocusItems []CoachSessionFocusRow
}

// CoachSessionFocusRow is one line of the frozen focus list. Status keeps
// the domain type — a snapshot of a status is still a status, and letting
// it decay to a bare string here is how the two vocabularies drift.
type CoachSessionFocusRow struct {
	Text   string
	Status FocusStatus
}

// StartCoachSession records a sitting as it opens. PlayerRef may be 0 — a
// session has no identity until the coach answers "who is this?".
func (s *SQLStore) StartCoachSession(row CoachSessionRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(
		`INSERT INTO coach_sessions (session_id, player_ref, handle, kind, source)
			 VALUES (?,?,?,?,?)
			 ON CONFLICT(session_id) DO NOTHING`,
		row.SessionID, nullableRef(row.PlayerRef), row.Handle, kindOrPlayer(row.Kind), row.Source,
	); err != nil {
		return fmt.Errorf("coach session: open: %w", err)
	}
	for i, key := range row.MatchKeys {
		if _, err := tx.Exec(
			`INSERT INTO coach_session_matches (session_id, match_key, sort_order)
			 VALUES (?,?,?) ON CONFLICT(session_id, match_key) DO NOTHING`,
			row.SessionID, key, i,
		); err != nil {
			return fmt.Errorf("coach session: cover %s: %w", key, err)
		}
	}
	return tx.Commit()
}

// PointCoachSessionAt files an already-open sitting under a player. Called
// when the coach names them, and again whenever they correct it.
func (s *SQLStore) PointCoachSessionAt(sessionID string, playerRef int64, handle, kind string) error {
	_, err := s.db.Exec(
		`UPDATE coach_sessions SET player_ref = ?, handle = ?, kind = ? WHERE session_id = ?`,
		nullableRef(playerRef), handle, kindOrPlayer(kind), sessionID,
	)
	return err
}

// EndCoachSession stamps the sitting and freezes the focus list as it
// stood. Idempotent on the focus rows: ending twice replaces the snapshot
// rather than doubling it.
func (s *SQLStore) EndCoachSession(sessionID string, focus []CoachSessionFocusRow) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(
		`UPDATE coach_sessions SET ended_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')
		 WHERE session_id = ?`, sessionID,
	); err != nil {
		return fmt.Errorf("coach session: end: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM coach_session_focus_items WHERE session_id = ?`, sessionID); err != nil {
		return err
	}
	for i, item := range focus {
		if _, err := tx.Exec(
			`INSERT INTO coach_session_focus_items (session_id, sort_order, text, status)
			 VALUES (?,?,?,?)`,
			sessionID, i, item.Text, item.Status,
		); err != nil {
			return fmt.Errorf("coach session: freeze focus: %w", err)
		}
	}
	return tx.Commit()
}

// ListCoachSessions returns a player's sittings, newest first, each with
// what it covered and the focus list it froze.
func (s *SQLStore) ListCoachSessions(playerRef int64) ([]CoachSessionRow, error) {
	rows, err := s.db.Query(
		`SELECT session_id, handle, kind, source, opened_at, COALESCE(ended_at, '')
		   FROM coach_sessions WHERE player_ref = ?
		   ORDER BY opened_at DESC, session_id DESC`, playerRef)
	if err != nil {
		return nil, err
	}
	out, err := scanCoachSessions(rows, playerRef)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].MatchKeys, err = s.sessionMatchKeys(out[i].SessionID); err != nil {
			return nil, err
		}
		if out[i].FocusItems, err = s.sessionFocusItems(out[i].SessionID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func scanCoachSessions(rows *sql.Rows, playerRef int64) ([]CoachSessionRow, error) {
	defer func() { _ = rows.Close() }()
	var out []CoachSessionRow
	for rows.Next() {
		r := CoachSessionRow{PlayerRef: playerRef}
		if err := rows.Scan(&r.SessionID, &r.Handle, &r.Kind, &r.Source, &r.OpenedAt, &r.EndedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *SQLStore) sessionMatchKeys(sessionID string) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT match_key FROM coach_session_matches WHERE session_id = ? ORDER BY sort_order`, sessionID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		out = append(out, key)
	}
	return out, rows.Err()
}

func (s *SQLStore) sessionFocusItems(sessionID string) ([]CoachSessionFocusRow, error) {
	rows, err := s.db.Query(
		`SELECT text, status FROM coach_session_focus_items WHERE session_id = ? ORDER BY sort_order`, sessionID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []CoachSessionFocusRow
	for rows.Next() {
		var r CoachSessionFocusRow
		if err := rows.Scan(&r.Text, &r.Status); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// nullableRef maps the zero player ref to SQL NULL — a sitting nobody has
// named yet, which the FK would otherwise refuse.
func nullableRef(ref int64) any {
	if ref == 0 {
		return nil
	}
	return ref
}

func kindOrPlayer(kind string) string {
	if kind == "" {
		return CoachKindPlayer
	}
	return kind
}
