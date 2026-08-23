package db

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// The player-AUTHORED self-review family — the third coaching family (see
// schema.sql): a saved sitting over the player's OWN matches. Match history
// like the received layer, so HardDeleteMatch / Clear / profiles.Move treat
// it as such, but its own tables keyed by a UUID the wire and the bundle
// both use, so no integer row id ever leaves the database.

var (
	// ErrSelfReviewUnknown reports a review_id no self_reviews row carries.
	ErrSelfReviewUnknown = errors.New("self review not found")
	// ErrSelfReviewMatchUnknown reports a match the named review does not
	// hold — a note or moment written for a key outside the review's set.
	ErrSelfReviewMatchUnknown = errors.New("match is not in this self review")
)

const (
	selfReviewNoteFocusTagsTable = "self_review_note_focus_tags"
	selfReviewNoteExtraTagsTable = "self_review_note_extra_tags"
	selfReviewNoteParentColumn   = "self_review_note_id"
)

// SelfReviewStore is the self-review slice of Store. pkg/review depends on
// this seam alone; dbtest.Fake mirrors it.
type SelfReviewStore interface {
	// CreateSelfReview inserts a review with its member keys in the given
	// order. An empty ReviewID is minted here; a supplied one is kept (a
	// bundle import or a profile move carries the identity across). The
	// instants are honored when supplied and stamped when empty, like every
	// restore-replayable stamp. Notes on the input are ignored — they are
	// written through UpsertSelfReviewNote. Returns the stored row.
	CreateSelfReview(r SelfReview) (SelfReview, error)
	// UpdateSelfReview renames the sitting. ErrSelfReviewUnknown
	// when no such review.
	UpdateSelfReview(reviewID, title string) error
	// FinishSelfReview stamps finished_at; a second finish keeps the first
	// stamp. ErrSelfReviewUnknown when no such review.
	FinishSelfReview(reviewID string) error
	// DeleteSelfReview removes the review and everything under it; absent is
	// a no-op.
	DeleteSelfReview(reviewID string) error
	// SetSelfReviewMatches replaces the member set wholesale, in the given
	// order. A note on a match that leaves the set goes with it.
	// ErrSelfReviewUnknown when no such review.
	SetSelfReviewMatches(reviewID string, matchKeys []string) error
	// LoadSelfReviews returns every review, newest first, each whole: member
	// keys in order and notes keyed by match.
	LoadSelfReviews() ([]SelfReview, error)
	// LoadSelfReview returns one review whole; (zero, false, nil) when absent.
	LoadSelfReview(reviewID string) (SelfReview, bool, error)

	// UpsertSelfReviewNote saves the one note per (review, match): a re-save
	// replaces kind / text / clock and both tag sets wholesale, refreshes
	// updated_at, keeps created_at, and leaves the moments alone (they have
	// their own writes). ErrSelfReviewMatchUnknown when the match is not in
	// the review. Returns the stored row, moments included.
	UpsertSelfReviewNote(n SelfReviewNote) (SelfReviewNote, error)
	// DeleteSelfReviewNote removes the (review, match) note and its moments;
	// absent is a no-op.
	DeleteSelfReviewNote(ref SelfReviewNoteRef) error
	// UpsertSelfReviewMoment saves one moment on the (review, match) note,
	// keyed by its client-minted MomentID; a re-save replaces clock / text /
	// tag / order and keeps created_at. A match with no note yet gets a
	// reviewed_only one opened IN THE SAME transaction — a moment is a review
	// of the match — so a note write racing the first moment can never be
	// downgraded by a check-then-open above the store. ErrSelfReviewMatchUnknown
	// when the match is not in the review.
	UpsertSelfReviewMoment(ref SelfReviewNoteRef, m SelfReviewMoment) (SelfReviewMoment, error)
	// DeleteSelfReviewMoment removes one moment; absent is a no-op.
	DeleteSelfReviewMoment(ref SelfReviewMomentRef) error
	// LoadSelfReviewNotes is the aggregator's read: every note on every
	// review, keyed by match_key and carrying the review's identity, in
	// (review created_at, review_id) order within a match.
	LoadSelfReviewNotes() (map[string][]SelfReviewNoteOnMatch, error)
}

func (s *SQLStore) CreateSelfReview(r SelfReview) (SelfReview, error) {
	if r.ReviewID == "" {
		r.ReviewID = NewCoachNoteID()
	}
	tx, err := s.db.Begin()
	if err != nil {
		return SelfReview{}, err
	}
	defer func() { _ = tx.Rollback() }()
	err = tx.QueryRow(
		`INSERT INTO self_reviews (review_id, title, created_at, updated_at, finished_at)
		 VALUES (?, ?, `+suppliedInstantOrNow+`, `+suppliedInstantOrNow+`, NULLIF(?, ''))
		 RETURNING created_at, updated_at, COALESCE(finished_at, '')`,
		r.ReviewID, r.Title, r.CreatedAt, r.UpdatedAt, r.FinishedAt,
	).Scan(&r.CreatedAt, &r.UpdatedAt, &r.FinishedAt)
	if err != nil {
		return SelfReview{}, fmt.Errorf("create self review: %w", err)
	}
	// The parent row only. The focus list lives in its own table and is
	// written by SetSelfReviewFocusItems, so echoing the caller's back would
	// claim a write that did not happen — the Fake returns the stored
	// (empty) list, and the two must not disagree.
	r.FocusItems = nil
	if err := insertSelfReviewMatches(tx, r.ReviewID, r.MatchKeys); err != nil {
		return SelfReview{}, err
	}
	r.MatchKeys = distinctKeys(r.MatchKeys)
	r.Notes = map[string]SelfReviewNote{}
	return r, tx.Commit()
}

// distinctKeys drops repeats, first position kept — the composite PK would
// refuse a repeat, and a repeat is a caller's slip (a hand-edited bundle),
// not a second membership.
func distinctKeys(keys []string) []string {
	out := make([]string, 0, len(keys))
	seen := make(map[string]bool, len(keys))
	for _, k := range keys {
		if seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, k)
	}
	return out
}

func insertSelfReviewMatches(tx *sql.Tx, reviewID string, matchKeys []string) error {
	for i, k := range distinctKeys(matchKeys) {
		if _, err := tx.Exec(
			`INSERT INTO self_review_matches (review_id, match_key, sort_order) VALUES (?, ?, ?)`,
			reviewID, k, i); err != nil {
			return fmt.Errorf("add self review match %q: %w", k, err)
		}
	}
	return nil
}

func (s *SQLStore) UpdateSelfReview(reviewID, title string) error {
	res, err := s.db.Exec(
		`UPDATE self_reviews SET title = ?,
		   updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
		 WHERE review_id = ?`, title, reviewID)
	if err != nil {
		return fmt.Errorf("update self review: %w", err)
	}
	return requireAffected(res, ErrSelfReviewUnknown)
}

func (s *SQLStore) FinishSelfReview(reviewID string) error {
	res, err := s.db.Exec(
		`UPDATE self_reviews SET
		   finished_at = COALESCE(finished_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
		   updated_at  = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
		 WHERE review_id = ?`, reviewID)
	if err != nil {
		return fmt.Errorf("finish self review: %w", err)
	}
	return requireAffected(res, ErrSelfReviewUnknown)
}

func (s *SQLStore) DeleteSelfReview(reviewID string) error {
	// Membership, notes, tags and moments CASCADE.
	_, err := s.db.Exec(`DELETE FROM self_reviews WHERE review_id = ?`, reviewID)
	return err
}

func (s *SQLStore) SetSelfReviewMatches(reviewID string, matchKeys []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireSelfReview(tx, reviewID); err != nil {
		return err
	}
	matchKeys = distinctKeys(matchKeys)
	if err := removeDepartingSelfReviewMatches(tx, reviewID, matchKeys); err != nil {
		return err
	}
	for i, k := range matchKeys {
		if _, err := tx.Exec(
			`INSERT INTO self_review_matches (review_id, match_key, sort_order) VALUES (?, ?, ?)
			 ON CONFLICT(review_id, match_key) DO UPDATE SET sort_order = excluded.sort_order`,
			reviewID, k, i); err != nil {
			return fmt.Errorf("set self review match %q: %w", k, err)
		}
	}
	if _, err := tx.Exec(`UPDATE self_reviews SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE review_id = ?`, reviewID); err != nil {
		return fmt.Errorf("touch self review: %w", err)
	}
	return tx.Commit()
}

// removeDepartingSelfReviewMatches deletes only the keys that LEAVE the set,
// so a note on a match that stays is not cascaded away by a wholesale
// delete-then-insert; the survivors have their sort_order rewritten in place
// by the caller's upsert.
func removeDepartingSelfReviewMatches(tx *sql.Tx, reviewID string, matchKeys []string) error {
	keep := make(map[string]bool, len(matchKeys))
	for _, k := range matchKeys {
		keep[k] = true
	}
	current, err := loadSelfReviewMatchKeys(tx, reviewID)
	if err != nil {
		return err
	}
	for _, k := range current {
		if keep[k] {
			continue
		}
		if _, err := tx.Exec(`DELETE FROM self_review_matches WHERE review_id = ? AND match_key = ?`, reviewID, k); err != nil {
			return fmt.Errorf("remove self review match %q: %w", k, err)
		}
	}
	return nil
}

func requireSelfReview(tx *sql.Tx, reviewID string) error {
	var exists bool
	if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM self_reviews WHERE review_id = ?)`, reviewID).Scan(&exists); err != nil {
		return fmt.Errorf("check self review: %w", err)
	}
	if !exists {
		return ErrSelfReviewUnknown
	}
	return nil
}

func loadSelfReviewMatchKeys(q querier, reviewID string) ([]string, error) {
	rows, err := q.Query(`SELECT match_key FROM self_review_matches WHERE review_id = ? ORDER BY sort_order, match_key`, reviewID)
	if err != nil {
		return nil, fmt.Errorf("load self review matches: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, fmt.Errorf("load self review matches: %w", err)
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *SQLStore) LoadSelfReviews() ([]SelfReview, error) {
	return s.loadSelfReviews(``, nil)
}

func (s *SQLStore) LoadSelfReview(reviewID string) (SelfReview, bool, error) {
	all, err := s.loadSelfReviews(`WHERE review_id = ?`, []any{reviewID})
	if err != nil || len(all) == 0 {
		return SelfReview{}, false, err
	}
	return all[0], true, nil
}

// loadSelfReviews reads the parent rows newest first and hangs the member
// keys and notes off each. Two more round trips rather than one wide join:
// the sets are small and the shape stays readable.
func (s *SQLStore) loadSelfReviews(where string, args []any) ([]SelfReview, error) {
	// #nosec G202 -- where is one of the constant predicates above.
	rows, err := s.db.Query(
		`SELECT review_id, title, created_at, updated_at, COALESCE(finished_at, '')
		 FROM self_reviews `+where+` ORDER BY created_at DESC, review_id`, args...)
	if err != nil {
		return nil, fmt.Errorf("load self reviews: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []SelfReview
	for rows.Next() {
		var r SelfReview
		if err := rows.Scan(&r.ReviewID, &r.Title, &r.CreatedAt, &r.UpdatedAt, &r.FinishedAt); err != nil {
			return nil, fmt.Errorf("load self reviews: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load self reviews: %w", err)
	}
	for i := range out {
		if out[i].MatchKeys, err = loadSelfReviewMatchKeys(s.db, out[i].ReviewID); err != nil {
			return nil, err
		}
		if out[i].Notes, err = s.loadSelfReviewNotesFor(out[i].ReviewID); err != nil {
			return nil, err
		}
		if out[i].FocusItems, err = s.LoadSelfReviewFocusItems(out[i].ReviewID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// loadSelfReviewNotesFor reads one review's notes keyed by match_key, tags
// and moments attached.
func (s *SQLStore) loadSelfReviewNotesFor(reviewID string) (map[string]SelfReviewNote, error) {
	byID, err := s.loadSelfReviewNoteRows(`WHERE n.review_id = ?`, []any{reviewID})
	if err != nil {
		return nil, err
	}
	out := make(map[string]SelfReviewNote, len(byID))
	for _, n := range byID {
		out[n.MatchKey] = n.SelfReviewNote
	}
	return out, nil
}

// loadSelfReviewNoteRows is the one note reader: parent rows by the given
// predicate, then tags and moments attached by row id. Every note carries
// its review's identity, which the per-match read prints on the block and
// the per-review read simply drops.
func (s *SQLStore) loadSelfReviewNoteRows(where string, args []any) (map[int64]*SelfReviewNoteOnMatch, error) {
	// #nosec G202 -- where is one of the constant predicates in this file.
	rows, err := s.db.Query(
		`SELECT n.id, n.review_id, n.match_key, n.kind, n.text, n.match_clock, n.created_at, n.updated_at,
		        r.title, r.created_at, COALESCE(r.finished_at, '')
		 FROM self_review_notes n
		 JOIN self_reviews r ON r.review_id = n.review_id `+where+`
		 ORDER BY r.created_at, r.review_id`, args...)
	if err != nil {
		return nil, fmt.Errorf("load self review notes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	byID := map[int64]*SelfReviewNoteOnMatch{}
	var ids []int64
	for rows.Next() {
		var id int64
		n := &SelfReviewNoteOnMatch{}
		if err := rows.Scan(&id, &n.ReviewID, &n.MatchKey, &n.Kind, &n.Text, &n.MatchClock, &n.CreatedAt, &n.UpdatedAt,
			&n.ReviewTitle, &n.ReviewCreatedAt, &n.ReviewFinishedAt); err != nil {
			return nil, fmt.Errorf("load self review notes: %w", err)
		}
		byID[id] = n
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("load self review notes: %w", err)
	}
	if len(ids) == 0 {
		return byID, nil
	}
	if err := s.attachSelfReviewNoteChildren(byID, where, args); err != nil {
		return nil, err
	}
	return byID, nil
}

// attachSelfReviewNoteChildren hangs both tag sets and the moments off the
// loaded notes, scoped by the same predicate the parent read used.
func (s *SQLStore) attachSelfReviewNoteChildren(byID map[int64]*SelfReviewNoteOnMatch, where string, args []any) error {
	for _, child := range []struct {
		table  string
		assign func(*SelfReviewNoteOnMatch, string)
	}{
		{selfReviewNoteFocusTagsTable, func(n *SelfReviewNoteOnMatch, tag string) { n.FocusTags = append(n.FocusTags, tag) }},
		{selfReviewNoteExtraTagsTable, func(n *SelfReviewNoteOnMatch, tag string) { n.ExtraTags = append(n.ExtraTags, tag) }},
	} {
		// #nosec G202 -- table name comes from the constants above; where from this file.
		query := `SELECT t.` + selfReviewNoteParentColumn + `, t.tag FROM ` + child.table + ` t
		          JOIN self_review_notes n ON n.id = t.` + selfReviewNoteParentColumn + ` ` + where + `
		          ORDER BY t.` + selfReviewNoteParentColumn + `, t.tag`
		err := loadChildValuesByID(s.db, query, args, func(id int64, tag string) {
			if n, ok := byID[id]; ok {
				child.assign(n, tag)
			}
		})
		if err != nil {
			return fmt.Errorf("load %s: %w", child.table, err)
		}
	}
	// #nosec G202 -- where comes from this file.
	rows, err := s.db.Query(
		`SELECT m.self_review_note_id, m.moment_id, m.match_clock, m.text, m.focus_tag, m.sort_order, m.created_at, m.updated_at
		 FROM self_review_note_moments m
		 JOIN self_review_notes n ON n.id = m.self_review_note_id `+where+`
		 ORDER BY m.self_review_note_id, m.match_clock, m.sort_order`, args...)
	if err != nil {
		return fmt.Errorf("load self review moments: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var noteRow int64
		var m SelfReviewMoment
		if err := rows.Scan(&noteRow, &m.MomentID, &m.MatchClock, &m.Text, &m.FocusTag, &m.SortOrder, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return fmt.Errorf("load self review moments: %w", err)
		}
		if n, ok := byID[noteRow]; ok {
			n.Moments = append(n.Moments, m)
		}
	}
	return rows.Err()
}

func (s *SQLStore) UpsertSelfReviewNote(n SelfReviewNote) (SelfReviewNote, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return SelfReviewNote{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if err := requireSelfReviewMatch(tx, n.ReviewID, n.MatchKey); err != nil {
		return SelfReviewNote{}, err
	}
	// created_at is absent from the SET clause: the first save's instant is
	// kept, like every sibling. Both stamps honor a supplied instant on the
	// INSERT (a bundle restore replays them) and take the clock otherwise.
	suppliedUpdatedAt := n.UpdatedAt
	var id int64
	err = tx.QueryRow(
		`INSERT INTO self_review_notes (review_id, match_key, kind, text, match_clock, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, `+suppliedInstantOrNow+`, `+suppliedInstantOrNow+`)
		 ON CONFLICT(review_id, match_key) DO UPDATE SET
		   kind        = excluded.kind,
		   text        = excluded.text,
		   match_clock = excluded.match_clock,
		   updated_at  = excluded.updated_at
		 RETURNING id, created_at, updated_at`,
		n.ReviewID, n.MatchKey, n.Kind, n.Text, n.MatchClock, n.CreatedAt, n.UpdatedAt,
	).Scan(&id, &n.CreatedAt, &n.UpdatedAt)
	if err != nil {
		return SelfReviewNote{}, fmt.Errorf("upsert self review note: %w", err)
	}
	if err := replaceTagSetByID(tx, selfReviewNoteFocusTagsTable, selfReviewNoteParentColumn, id, n.FocusTags); err != nil {
		return SelfReviewNote{}, err
	}
	if err := replaceTagSetByID(tx, selfReviewNoteExtraTagsTable, selfReviewNoteParentColumn, id, n.ExtraTags); err != nil {
		return SelfReviewNote{}, err
	}
	n.FocusTags, n.ExtraTags = distinctSorted(n.FocusTags), distinctSorted(n.ExtraTags)
	if n.Moments, err = loadSelfReviewMomentsForNote(tx, id); err != nil {
		return SelfReviewNote{}, err
	}
	if err := touchSelfReviewUnlessReplay(tx, n.ReviewID, suppliedUpdatedAt); err != nil {
		return SelfReviewNote{}, err
	}
	return n, tx.Commit()
}

// touchSelfReviewUnlessReplay bumps the sitting's updated_at for a LIVE
// write — a note or moment written in the room is work on the sitting, and
// the shelf orders on it. A write that carries its own instant is a replay
// (a bundle restore, a profile move) and leaves the sitting's own stamp
// alone, so a restore brings back when the sitting was last worked on
// rather than when it was restored.
func touchSelfReviewUnlessReplay(tx *sql.Tx, reviewID, suppliedInstant string) error {
	if suppliedInstant != "" {
		return nil
	}
	if _, err := tx.Exec(`UPDATE self_reviews SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE review_id = ?`, reviewID); err != nil {
		return fmt.Errorf("touch self review: %w", err)
	}
	return nil
}

// requireSelfReviewMatch tells a missing review from a match outside it, so
// each maps to its own sentinel.
func requireSelfReviewMatch(tx *sql.Tx, reviewID, matchKey string) error {
	if err := requireSelfReview(tx, reviewID); err != nil {
		return err
	}
	var member bool
	if err := tx.QueryRow(`SELECT EXISTS (SELECT 1 FROM self_review_matches WHERE review_id = ? AND match_key = ?)`,
		reviewID, matchKey).Scan(&member); err != nil {
		return fmt.Errorf("check self review match: %w", err)
	}
	if !member {
		return ErrSelfReviewMatchUnknown
	}
	return nil
}

func loadSelfReviewMomentsForNote(q querier, noteRow int64) ([]SelfReviewMoment, error) {
	rows, err := q.Query(
		`SELECT moment_id, match_clock, text, focus_tag, sort_order, created_at, updated_at
		 FROM self_review_note_moments WHERE self_review_note_id = ?
		 ORDER BY match_clock, sort_order`, noteRow)
	if err != nil {
		return nil, fmt.Errorf("load self review moments: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []SelfReviewMoment
	for rows.Next() {
		var m SelfReviewMoment
		if err := rows.Scan(&m.MomentID, &m.MatchClock, &m.Text, &m.FocusTag, &m.SortOrder, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, fmt.Errorf("load self review moments: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *SQLStore) DeleteSelfReviewNote(ref SelfReviewNoteRef) error {
	reviewID, matchKey := ref.ReviewID, ref.MatchKey
	// Tags and moments CASCADE on the note's FK. A delete is always live work
	// on the sitting (nothing replays one), so it touches the sitting when it
	// removed something.
	return s.deleteTouchingSelfReview(reviewID,
		`DELETE FROM self_review_notes WHERE review_id = ? AND match_key = ?`, reviewID, matchKey)
}

// deleteTouchingSelfReview runs one DELETE and, when it removed a row, bumps
// the sitting's updated_at — the shelf orders on "last worked on", and taking
// a note out is work.
func (s *SQLStore) deleteTouchingSelfReview(reviewID, stmt string, args ...any) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	res, err := tx.Exec(stmt, args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		if err := touchSelfReviewUnlessReplay(tx, reviewID, ""); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// ensureSelfReviewNoteRow resolves a (review, match) to its note row id,
// opening a reviewed_only note when there is none. Inside the caller's
// transaction, so the open and the moment land together or not at all; a
// note write that commits first is left as it is (DO NOTHING), and one that
// commits after simply upgrades the reviewed_only mark it finds.
func ensureSelfReviewNoteRow(tx *sql.Tx, reviewID, matchKey string) (int64, error) {
	if err := requireSelfReviewMatch(tx, reviewID, matchKey); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(
		`INSERT INTO self_review_notes (review_id, match_key, kind) VALUES (?, ?, 'reviewed_only')
		 ON CONFLICT(review_id, match_key) DO NOTHING`, reviewID, matchKey); err != nil {
		return 0, fmt.Errorf("open self review note for moment: %w", err)
	}
	var id int64
	if err := tx.QueryRow(`SELECT id FROM self_review_notes WHERE review_id = ? AND match_key = ?`, reviewID, matchKey).Scan(&id); err != nil {
		return 0, fmt.Errorf("resolve self review note: %w", err)
	}
	return id, nil
}

func (s *SQLStore) UpsertSelfReviewMoment(ref SelfReviewNoteRef, m SelfReviewMoment) (SelfReviewMoment, error) {
	reviewID, matchKey := ref.ReviewID, ref.MatchKey
	if m.MomentID == "" {
		return SelfReviewMoment{}, errors.New("upsert self review moment: moment_id is required")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return SelfReviewMoment{}, err
	}
	defer func() { _ = tx.Rollback() }()
	noteRow, err := ensureSelfReviewNoteRow(tx, reviewID, matchKey)
	if err != nil {
		return SelfReviewMoment{}, err
	}
	suppliedUpdatedAt := m.UpdatedAt
	err = tx.QueryRow(
		`INSERT INTO self_review_note_moments (self_review_note_id, moment_id, match_clock, text, focus_tag, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, `+suppliedInstantOrNow+`, `+suppliedInstantOrNow+`)
		 ON CONFLICT(self_review_note_id, moment_id) DO UPDATE SET
		   match_clock = excluded.match_clock,
		   text        = excluded.text,
		   focus_tag   = excluded.focus_tag,
		   sort_order  = excluded.sort_order,
		   updated_at  = excluded.updated_at
		 RETURNING created_at, updated_at`,
		noteRow, m.MomentID, m.MatchClock, m.Text, m.FocusTag, m.SortOrder, m.CreatedAt, m.UpdatedAt,
	).Scan(&m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return SelfReviewMoment{}, fmt.Errorf("upsert self review moment: %w", err)
	}
	if err := touchSelfReviewUnlessReplay(tx, reviewID, suppliedUpdatedAt); err != nil {
		return SelfReviewMoment{}, err
	}
	return m, tx.Commit()
}

func (s *SQLStore) DeleteSelfReviewMoment(ref SelfReviewMomentRef) error {
	reviewID, matchKey, momentID := ref.ReviewID, ref.MatchKey, ref.MomentID
	return s.deleteTouchingSelfReview(reviewID,
		`DELETE FROM self_review_note_moments
		 WHERE moment_id = ? AND self_review_note_id IN (
		   SELECT id FROM self_review_notes WHERE review_id = ? AND match_key = ?
		 )`, momentID, reviewID, matchKey)
}

func (s *SQLStore) LoadSelfReviewNotes() (map[string][]SelfReviewNoteOnMatch, error) {
	byID, err := s.loadSelfReviewNoteRows(``, nil)
	if err != nil {
		return nil, err
	}
	// The row map loses the ORDER BY; re-sort per match on the same key the
	// query used so a match's blocks read oldest sitting first.
	out := make(map[string][]SelfReviewNoteOnMatch, len(byID))
	for _, n := range byID {
		out[n.MatchKey] = append(out[n.MatchKey], *n)
	}
	for k := range out {
		sortSelfReviewNotesBySitting(out[k])
	}
	return out, nil
}

// sortSelfReviewNotesBySitting orders one match's blocks by the review that
// wrote them, oldest sitting first — the order the player did the work in.
// Exported to the Fake through the same helper so both implementations
// agree on the tie-break.
func sortSelfReviewNotesBySitting(notes []SelfReviewNoteOnMatch) {
	slices.SortStableFunc(notes, func(a, b SelfReviewNoteOnMatch) int {
		if c := strings.Compare(a.ReviewCreatedAt, b.ReviewCreatedAt); c != 0 {
			return c
		}
		return strings.Compare(a.ReviewID, b.ReviewID)
	})
}

// SortSelfReviewNotesBySitting is the exported twin for dbtest.Fake.
func SortSelfReviewNotesBySitting(notes []SelfReviewNoteOnMatch) { sortSelfReviewNotesBySitting(notes) }
