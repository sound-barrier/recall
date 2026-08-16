package db

import "fmt"

// Per-match review-status tag. Presence in match_reviews IS the
// "reviewed" signal; absence means "not reviewed." SetReview is an
// idempotent upsert; ClearReview is a targeted delete; LoadReviews
// returns the full snapshot the aggregator merges into match.Record
// at read time.
//
// The CHECK constraint on the reviewed_by column ('self' | 'coach')
// is the source of truth for the enum — the App layer additionally
// validates before reaching SQL so the error surface stays friendly.

// upsertReviewSQL stamps reviewed_at from the bound instant, falling back to
// the server clock when it is empty. `excluded.reviewed_at` in the conflict
// clause is that same computed value, so an update follows the insert's rule
// instead of carrying a second copy of it.
const upsertReviewSQL = `INSERT INTO match_reviews (match_key, reviewed_by, reviewed_at)
		 VALUES (?, ?, ` + suppliedInstantOrNow + `)
		 ON CONFLICT(match_key) DO UPDATE SET
		   reviewed_by = excluded.reviewed_by,
		   reviewed_at = excluded.reviewed_at`

// SetReview records the reviewer and stamps reviewed_at with the server
// clock — the live path, where marking a match reviewed means "now".
func (s *SQLStore) SetReview(matchKey, reviewedBy string) error {
	return s.SetReviewAt(matchKey, reviewedBy, "")
}

// SetReviewAt is SetReview for a restore: reviewedAt is the instant the
// bundle carried, replayed verbatim so re-importing a backup doesn't claim
// every match was reviewed at import time. An empty reviewedAt falls back to
// the server clock — importing a bundle old enough to carry no instant still
// lands a row.
func (s *SQLStore) SetReviewAt(matchKey, reviewedBy, reviewedAt string) error {
	_, err := s.db.Exec(upsertReviewSQL, matchKey, reviewedBy, reviewedAt)
	return err
}

func (s *SQLStore) ClearReview(matchKey string) error {
	_, err := s.db.Exec(`DELETE FROM match_reviews WHERE match_key = ?`, matchKey)
	return err
}

func (s *SQLStore) LoadReviews() (map[string]ReviewState, error) {
	rows, err := s.db.Query(`SELECT match_key, reviewed_by, reviewed_at FROM match_reviews`)
	if err != nil {
		return nil, fmt.Errorf("load reviews: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := map[string]ReviewState{}
	for rows.Next() {
		var k string
		var st ReviewState
		if err := rows.Scan(&k, &st.ReviewedBy, &st.ReviewedAt); err != nil {
			return nil, fmt.Errorf("load reviews: %w", err)
		}
		out[k] = st
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load reviews: %w", err)
	}
	return out, nil
}
