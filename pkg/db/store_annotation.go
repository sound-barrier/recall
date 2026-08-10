package db

import (
	"database/sql"
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

func (s *SQLStore) SetAnnotation(a Annotation) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// The parent row must land first — every child list FKs to it.
	if _, err := tx.Exec(
		`INSERT INTO match_annotations (match_key, note, replay_code)
		 VALUES (?, ?, ?)
		 ON CONFLICT(match_key) DO UPDATE SET
		   note         = excluded.note,
		   replay_code  = excluded.replay_code,
		   annotated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		a.MatchKey, a.Note, a.ReplayCode,
	); err != nil {
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
		`SELECT match_key, COALESCE(note, ''), COALESCE(replay_code, ''), annotated_at
		 FROM match_annotations`,
	)
	if err != nil {
		return nil, fmt.Errorf("load annotations: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := make(map[string]Annotation)
	for rows.Next() {
		var a Annotation
		if err := rows.Scan(&a.MatchKey, &a.Note, &a.ReplayCode, &a.AnnotatedAt); err != nil {
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
