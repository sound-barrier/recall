package db

// Per-match review-status tag. Presence in match_reviews IS the
// "reviewed" signal; absence means "not reviewed." SetReview is an
// idempotent upsert; ClearReview is a targeted delete; LoadReviews
// returns the full snapshot the aggregator merges into MatchRecord
// at read time.
//
// The CHECK constraint on the reviewed_by column ('self' | 'coach')
// is the source of truth for the enum — the App layer additionally
// validates before reaching SQL so the error surface stays friendly.

func (s *SQLStore) SetReview(matchKey, reviewedBy string) error {
	_, err := s.db.Exec(
		`INSERT INTO match_reviews (match_key, reviewed_by) VALUES (?, ?)
		 ON CONFLICT(match_key) DO UPDATE SET
		   reviewed_by = excluded.reviewed_by,
		   reviewed_at = CURRENT_TIMESTAMP`,
		matchKey, reviewedBy,
	)
	return err
}

func (s *SQLStore) ClearReview(matchKey string) error {
	_, err := s.db.Exec(`DELETE FROM match_reviews WHERE match_key = ?`, matchKey)
	return err
}

func (s *SQLStore) LoadReviews() (map[string]ReviewState, error) {
	rows, err := s.db.Query(`SELECT match_key, reviewed_by, reviewed_at FROM match_reviews`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]ReviewState{}
	for rows.Next() {
		var k string
		var st ReviewState
		if err := rows.Scan(&k, &st.ReviewedBy, &st.ReviewedAt); err != nil {
			return nil, err
		}
		out[k] = st
	}
	return out, rows.Err()
}
