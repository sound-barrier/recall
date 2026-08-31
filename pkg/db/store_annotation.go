package db

import (
	"database/sql"
	"errors"
	"fmt"
)

// Match annotations — user-curated per-match data (who left, who threw, free
// text, replay code, group members, tags). UPSERT semantics on SetAnnotation;
// DeleteAnnotation is a targeted delete; LoadAnnotations returns the full
// snapshot the aggregator merges into match.Record at read time.
//
// Everything except the scalars lives in a child table keyed on match_key, and
// each list is rewritten wholesale on Set. The CHECK constraints on the leaver
// / thrower side tables are the source of truth for the side vocabulary — the
// App layer additionally validates before reaching SQL so the error surface is
// friendlier than a raw constraint violation.

// annotationChildTables maps each child table to the column holding its value.
// The four lists are structurally identical, which is what lets Set and Load
// share replaceChildSet / attachChildSet instead of carrying four copies.
const (
	leaversTable  = "match_annotation_leavers"
	throwersTable = "match_annotation_throwers"
	membersTable  = "match_annotation_members"
	tagsTable     = "match_annotation_tags"
)

// replaceChildSet rewrites one annotation child list wholesale — delete then
// re-insert inside the caller's transaction. Simplest concurrency model, and it
// is what makes a shrinking list actually shrink (an UPSERT alone would leave
// the dropped rows behind).
//
// Duplicates are dropped HERE rather than by `INSERT OR IGNORE`, which would
// also swallow a CHECK-constraint violation — the side tables' whole job is to
// reject a value outside {self, team, enemy}, and OR IGNORE turned that into a
// silent no-op.
func replaceChildSet(tx *sql.Tx, table, column, matchKey string, values []string) error {
	// #nosec G202 -- table/column come from the constants above, never from
	// user input; SQL identifiers can't be bound as parameters.
	if _, err := tx.Exec("DELETE FROM "+table+" WHERE match_key = ?", matchKey); err != nil {
		return fmt.Errorf("clear %s: %w", table, err)
	}
	seen := make(map[string]bool, len(values))
	for _, v := range values {
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		// #nosec G202 -- same as above.
		stmt := "INSERT INTO " + table + " (match_key, " + column + ") VALUES (?, ?)"
		if _, err := tx.Exec(stmt, matchKey, v); err != nil {
			return fmt.Errorf("insert %s: %w", table, err)
		}
	}
	return nil
}

// upsertAnnotationSQL stamps annotated_at from the bound instant, falling
// back to the server clock when it is empty; the conflict clause reuses that
// same computed value via `excluded`.
const upsertAnnotationSQL = `INSERT INTO match_annotations (match_key, note, replay_code, exclusion_reason, annotated_at)
		 VALUES (?, ?, ?, ?, ` + suppliedInstantOrNow + `)
		 ON CONFLICT(match_key) DO UPDATE SET
		   note             = excluded.note,
		   replay_code      = excluded.replay_code,
		   exclusion_reason = excluded.exclusion_reason,
		   annotated_at     = excluded.annotated_at`

// SetAnnotation upserts the annotation and stamps annotated_at with the
// server clock. The instant is the store's to assign on this path: the
// editor hands back the row it loaded, carried AnnotatedAt and all, and an
// edit made today must read as made today.
func (s *SQLStore) SetAnnotation(a Annotation) error {
	return s.setAnnotation(a, "")
}

// SetAnnotationAt is SetAnnotation for a restore: the annotation lands with
// the instant it carries in AnnotatedAt, so re-importing a backup doesn't
// re-date every note to the import. An empty AnnotatedAt still falls back to
// the server clock.
func (s *SQLStore) SetAnnotationAt(a Annotation) error {
	return s.setAnnotation(a, a.AnnotatedAt)
}

func (s *SQLStore) setAnnotation(a Annotation, annotatedAt string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// The parent row must land first — every child list FKs to it.
	if _, err := tx.Exec(upsertAnnotationSQL, a.MatchKey, a.Note, a.ReplayCode, a.ExclusionReason, annotatedAt); err != nil {
		return err
	}
	for _, set := range []struct {
		table, column string
		values        []string
	}{
		{leaversTable, "side", a.Leavers},
		{throwersTable, "side", a.Throwers},
		{membersTable, "member", a.Members},
		{tagsTable, "tag", a.Tags},
	} {
		if err := replaceChildSet(tx, set.table, set.column, a.MatchKey, set.values); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) DeleteAnnotation(matchKey string) error {
	// ON DELETE CASCADE on each child table's FK takes care of the side /
	// member / tag rows in the same statement.
	_, err := s.db.Exec(`DELETE FROM match_annotations WHERE match_key = ?`, matchKey)
	return err
}

// attachChildSet reads one child table wholesale and folds each row into its
// annotation via assign. One round-trip per table, ordered so each list arrives
// sorted without an extra pass in the aggregator.
func (s *SQLStore) attachChildSet(out map[string]Annotation, table, column string, assign func(*Annotation, string)) error {
	// #nosec G202 -- table/column come from the constants above, never from
	// user input; SQL identifiers can't be bound as parameters.
	rows, err := s.db.Query("SELECT match_key, " + column + " FROM " + table + " ORDER BY match_key, " + column)
	if err != nil {
		return fmt.Errorf("load %s: %w", table, err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return fmt.Errorf("load %s: %w", table, err)
		}
		a, ok := out[key]
		if !ok {
			// Orphan child row (shouldn't happen with FK enforcement on, but
			// guard against the case for robustness).
			continue
		}
		assign(&a, value)
		out[key] = a
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("load %s: %w", table, err)
	}
	return nil
}

func (s *SQLStore) LoadAnnotations() (map[string]Annotation, error) {
	rows, err := s.db.Query(
		`SELECT match_key, COALESCE(note, ''), COALESCE(replay_code, ''), exclusion_reason, annotated_at
		 FROM match_annotations`,
	)
	if err != nil {
		return nil, fmt.Errorf("load annotations: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := make(map[string]Annotation)
	for rows.Next() {
		var a Annotation
		if err := rows.Scan(&a.MatchKey, &a.Note, &a.ReplayCode, &a.ExclusionReason, &a.AnnotatedAt); err != nil {
			return nil, fmt.Errorf("load annotations: %w", err)
		}
		out[a.MatchKey] = a
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load annotations: %w", err)
	}

	for _, set := range []struct {
		table, column string
		assign        func(*Annotation, string)
	}{
		{leaversTable, "side", func(a *Annotation, v string) { a.Leavers = append(a.Leavers, v) }},
		{throwersTable, "side", func(a *Annotation, v string) { a.Throwers = append(a.Throwers, v) }},
		{membersTable, "member", func(a *Annotation, v string) { a.Members = append(a.Members, v) }},
		{tagsTable, "tag", func(a *Annotation, v string) { a.Tags = append(a.Tags, v) }},
	} {
		if err := s.attachChildSet(out, set.table, set.column, set.assign); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// ── The player's own timestamped moments ──────────────────────────────────
//
// A self-review that can point at seconds, the way a coach's can. Keyed on
// match_key with no FK to match_annotations: a player may mark moments on a
// match they never wrote a journal note about, and the annotation is one row
// by design while these are many.

// UpsertMatchMoment saves one of the player's moments. A re-save keeps the
// moment_id minted on the first, so an edit is never a new observation.
func (s *SQLStore) UpsertMatchMoment(m MatchMoment) (MatchMoment, error) {
	if m.MomentID == "" {
		m.MomentID = NewCoachNoteID()
	}
	err := s.db.QueryRow(
		`INSERT INTO match_moments (moment_id, match_key, match_clock, text, focus_tag, sort_order)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(moment_id) DO UPDATE SET
		   match_clock = excluded.match_clock,
		   text        = excluded.text,
		   focus_tag   = excluded.focus_tag,
		   sort_order  = excluded.sort_order,
		   updated_at  = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
		 WHERE match_moments.match_key = excluded.match_key
		 RETURNING created_at, updated_at`,
		m.MomentID, m.MatchKey, m.MatchClock, m.Text, m.FocusTag, m.SortOrder,
	).Scan(&m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		// The WHERE on the DO UPDATE refused: this id exists on a DIFFERENT
		// match. The id is minted by the client, so it is not a namespace to
		// trust — the coach side learned that the expensive way, where a
		// collision rewrote another player's observation.
		return MatchMoment{}, ErrMomentMatchMismatch
	}
	if err != nil {
		return MatchMoment{}, fmt.Errorf("upsert match moment: %w", err)
	}
	return m, nil
}

// DeleteMatchMoment removes one of the player's moments. Scoped to the match
// for the same reason the upsert is. Absent is a no-op.
func (s *SQLStore) DeleteMatchMoment(matchKey, momentID string) error {
	_, err := s.db.Exec(
		`DELETE FROM match_moments WHERE moment_id = ? AND match_key = ?`, momentID, matchKey)
	return err
}

// LoadMatchMoments returns every player-authored moment, keyed by match, each
// list already in reading order.
func (s *SQLStore) LoadMatchMoments() (map[string][]MatchMoment, error) {
	rows, err := s.db.Query(
		`SELECT moment_id, match_key, match_clock, text, focus_tag, sort_order, created_at, updated_at
		 FROM match_moments ORDER BY match_key, match_clock, sort_order`)
	if err != nil {
		return nil, fmt.Errorf("load match moments: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := map[string][]MatchMoment{}
	for rows.Next() {
		var m MatchMoment
		if err := rows.Scan(&m.MomentID, &m.MatchKey, &m.MatchClock, &m.Text,
			&m.FocusTag, &m.SortOrder, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan match moment: %w", err)
		}
		out[m.MatchKey] = append(out[m.MatchKey], m)
	}
	return out, rows.Err()
}
