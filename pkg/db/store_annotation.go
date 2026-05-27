package db

// Match annotations — user-curated per-match notes (leaver flag + free
// text + replay code + group members). UPSERT semantics on
// SetAnnotation; DeleteAnnotation is a targeted delete;
// LoadAnnotations returns the full snapshot the aggregator merges into
// MatchRecord at read time.
//
// The CHECK constraint on the leaver column is the source of truth for
// the enum — the App layer additionally validates before reaching SQL
// so the error surface is friendlier than a raw constraint violation.

func (s *SQLStore) SetAnnotation(a Annotation) error {
	// Empty-string leaver is the App-layer "no leaver tag" signal; the
	// SQLite CHECK constraint only accepts NULL or the three valid
	// values, so coerce here. Same for replay_code so an empty string
	// stays an empty string (NULL would be lossy; the column is plain
	// TEXT, an empty string round-trips fine).
	var leaver any
	if a.Leaver == "" {
		leaver = nil
	} else {
		leaver = a.Leaver
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(
		`INSERT INTO match_annotations (match_key, leaver, note, replay_code)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(match_key) DO UPDATE SET
		   leaver       = excluded.leaver,
		   note         = excluded.note,
		   replay_code  = excluded.replay_code,
		   annotated_at = CURRENT_TIMESTAMP`,
		a.MatchKey, leaver, a.Note, a.ReplayCode,
	); err != nil {
		return err
	}
	// Rewrite the member set wholesale — simplest concurrency model
	// (delete-then-reinsert in one txn). Composite-PK on the child
	// table guards against accidental duplicates in the input list.
	if _, err := tx.Exec(`DELETE FROM match_annotation_members WHERE match_key = ?`, a.MatchKey); err != nil {
		return err
	}
	for _, m := range a.Members {
		if m == "" {
			continue
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO match_annotation_members (match_key, member) VALUES (?, ?)`,
			a.MatchKey, m,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLStore) DeleteAnnotation(matchKey string) error {
	// ON DELETE CASCADE on the child table FK takes care of the
	// member rows in the same statement.
	_, err := s.db.Exec(`DELETE FROM match_annotations WHERE match_key = ?`, matchKey)
	return err
}

func (s *SQLStore) LoadAnnotations() (map[string]Annotation, error) {
	rows, err := s.db.Query(
		`SELECT match_key, COALESCE(leaver, ''), COALESCE(note, ''), COALESCE(replay_code, ''), annotated_at
		 FROM match_annotations`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := make(map[string]Annotation)
	for rows.Next() {
		var a Annotation
		if err := rows.Scan(&a.MatchKey, &a.Leaver, &a.Note, &a.ReplayCode, &a.AnnotatedAt); err != nil {
			return nil, err
		}
		out[a.MatchKey] = a
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Attach members. One round-trip across the whole table; ordered
	// by match_key for stable iteration during the attach loop.
	memberRows, err := s.db.Query(`SELECT match_key, member FROM match_annotation_members ORDER BY match_key, member`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = memberRows.Close() }()
	for memberRows.Next() {
		var key, member string
		if err := memberRows.Scan(&key, &member); err != nil {
			return nil, err
		}
		a, ok := out[key]
		if !ok {
			// Orphan member row (shouldn't happen with FK enforcement
			// on, but guard against the case for robustness).
			continue
		}
		a.Members = append(a.Members, member)
		out[key] = a
	}
	return out, memberRows.Err()
}
