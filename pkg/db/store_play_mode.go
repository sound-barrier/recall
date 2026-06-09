package db

// Per-match play-mode tag (quickplay / competitive). Presence in
// match_play_mode is the user-set OVERRIDE; absence means "fall back
// to whatever the parser captured in summary_screenshots.mode or
// rank-row presence" (the aggregator handles the fallback chain).
//
// SetMatchPlayMode is an idempotent upsert; ClearMatchPlayMode is a
// targeted delete; LoadMatchPlayModes returns the full snapshot the
// aggregator merges into MatchRecord at read time.
//
// The CHECK constraint on the play_mode column ('quickplay' |
// 'competitive') is the source of truth for the enum; the App layer
// additionally validates so the error surface stays friendly.

func (s *SQLStore) SetMatchPlayMode(matchKey, playMode string) error {
	_, err := s.db.Exec(
		`INSERT INTO match_play_mode (match_key, play_mode) VALUES (?, ?)
		 ON CONFLICT(match_key) DO UPDATE SET
		   play_mode = excluded.play_mode,
		   overridden_at = CURRENT_TIMESTAMP`,
		matchKey, playMode,
	)
	return err
}

func (s *SQLStore) ClearMatchPlayMode(matchKey string) error {
	_, err := s.db.Exec(`DELETE FROM match_play_mode WHERE match_key = ?`, matchKey)
	return err
}

// BulkSetMatchPlayMode upserts the same play_mode onto every key
// inside one transaction. playMode="" deletes the rows (bulk
// Clear). See BulkSetMatchQueue for the crash-consistency
// rationale.
func (s *SQLStore) BulkSetMatchPlayMode(matchKeys []string, playMode string) error {
	if len(matchKeys) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }() // no-op after Commit
	var stmt string
	if playMode == "" {
		stmt = `DELETE FROM match_play_mode WHERE match_key = ?`
		for _, k := range matchKeys {
			if _, err := tx.Exec(stmt, k); err != nil {
				return err
			}
		}
	} else {
		stmt = `INSERT INTO match_play_mode (match_key, play_mode) VALUES (?, ?)
			 ON CONFLICT(match_key) DO UPDATE SET
			   play_mode = excluded.play_mode,
			   overridden_at = CURRENT_TIMESTAMP`
		for _, k := range matchKeys {
			if _, err := tx.Exec(stmt, k, playMode); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (s *SQLStore) LoadMatchPlayModes() (map[string]PlayModeState, error) {
	rows, err := s.db.Query(`SELECT match_key, play_mode, overridden_at FROM match_play_mode`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]PlayModeState{}
	for rows.Next() {
		var k string
		var st PlayModeState
		if err := rows.Scan(&k, &st.PlayMode, &st.OverriddenAt); err != nil {
			return nil, err
		}
		out[k] = st
	}
	return out, rows.Err()
}
