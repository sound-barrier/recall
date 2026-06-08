package db

// Per-match queue-type tag (role / open). Presence in match_queue IS
// the "queue known" signal; absence means "queue not set."
// SetMatchQueue is an idempotent upsert; ClearMatchQueue is a
// targeted delete; LoadMatchQueues returns the full snapshot the
// aggregator merges into MatchRecord at read time.
//
// The CHECK constraint on the queue_type column ('role' | 'open')
// is the source of truth for the enum — the App layer additionally
// validates before reaching SQL so the error surface stays friendly.

func (s *SQLStore) SetMatchQueue(matchKey, queueType string) error {
	_, err := s.db.Exec(
		`INSERT INTO match_queue (match_key, queue_type) VALUES (?, ?)
		 ON CONFLICT(match_key) DO UPDATE SET
		   queue_type = excluded.queue_type,
		   set_at     = CURRENT_TIMESTAMP`,
		matchKey, queueType,
	)
	return err
}

func (s *SQLStore) ClearMatchQueue(matchKey string) error {
	_, err := s.db.Exec(`DELETE FROM match_queue WHERE match_key = ?`, matchKey)
	return err
}

// BulkSetMatchQueue upserts the same queue_type onto every key
// inside one transaction so a partial mid-write crash leaves the
// table consistent. queueType="" deletes the rows (bulk Clear).
// Empty key slice is a no-op (the loop runs zero times) — callers
// don't need to short-circuit on the frontend.
func (s *SQLStore) BulkSetMatchQueue(matchKeys []string, queueType string) error {
	if len(matchKeys) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }() // no-op after Commit
	var stmt string
	if queueType == "" {
		stmt = `DELETE FROM match_queue WHERE match_key = ?`
		for _, k := range matchKeys {
			if _, err := tx.Exec(stmt, k); err != nil {
				return err
			}
		}
	} else {
		stmt = `INSERT INTO match_queue (match_key, queue_type) VALUES (?, ?)
			 ON CONFLICT(match_key) DO UPDATE SET
			   queue_type = excluded.queue_type,
			   set_at     = CURRENT_TIMESTAMP`
		for _, k := range matchKeys {
			if _, err := tx.Exec(stmt, k, queueType); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (s *SQLStore) LoadMatchQueues() (map[string]QueueState, error) {
	rows, err := s.db.Query(`SELECT match_key, queue_type, set_at FROM match_queue`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]QueueState{}
	for rows.Next() {
		var k string
		var st QueueState
		if err := rows.Scan(&k, &st.QueueType, &st.SetAt); err != nil {
			return nil, err
		}
		out[k] = st
	}
	return out, rows.Err()
}
