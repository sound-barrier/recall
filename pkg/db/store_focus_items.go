package db

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"
)

var (
	// ErrFocusItemUnknown reports an item_id no focus row carries.
	ErrFocusItemUnknown = errors.New("focus item not found")
	// ErrFocusItemStatusInvalid reports a status outside new/working/done.
	ErrFocusItemStatusInvalid = errors.New("invalid focus item status")
	// ErrFocusItemInvalid reports a list that breaks its own rules — a
	// non-UUID or repeated item_id, blank or over-long text, too many rows.
	ErrFocusItemInvalid = errors.New("invalid focus item")
)

// The focus list — "what to work on", as rows rather than one free-text
// blob. Three tables for the three lifetimes the coaching families already
// draw a line between (see the header note in schema.sql):
//
//   - coach_focus_items       what THIS user tells a player to work on
//   - self_review_focus_items what the player wrote in their own sitting
//   - received_focus_items    what a coach sent THIS user
//
// The player's list is the last two together. `status` is the player's own
// progress and has no 'denied' arm: a coach's item is active the moment it
// lands, accepting it acknowledges rather than admits it, and 'done' retires
// it from the live readout without deleting what was said.

// Focus-item statuses. A coach's item starts New; your own starts Working
// (you wrote it, you are on it); either ends Done.
const (
	FocusNew     = "new"
	FocusWorking = "working"
	FocusDone    = "done"
)

// FocusItem is one line of "what to work on". ItemID is a UUID minted
// client-side and stable across export/import — the identity rule note_id
// follows, for the same reason: an integer id would collide or reattach.
type FocusItem struct {
	ItemID    string
	Text      string
	Status    string
	SortOrder int
	CreatedAt string
	UpdatedAt string
}

// ReceivedFocusItem is a coach's item as it landed here, carrying who sent
// it and when so the player's list can say so and order by it.
type ReceivedFocusItem struct {
	FocusItem
	CoachName   string
	SessionDate string
}

// FocusItemStore is the focus list's surface.
type FocusItemStore interface {
	// SetCoachFocusItems replaces the coach's list for one player, in the
	// given order. An empty slice clears it.
	SetCoachFocusItems(playerRef int64, items []FocusItem) error
	// LoadCoachFocusItems reads the coach's list for one player, in order.
	LoadCoachFocusItems(playerRef int64) ([]FocusItem, error)

	// SetSelfReviewFocusItems replaces a sitting's list, in the given order.
	// ErrSelfReviewUnknown when no such review.
	SetSelfReviewFocusItems(reviewID string, items []FocusItem) error
	// LoadSelfReviewFocusItems reads one sitting's list, in order.
	LoadSelfReviewFocusItems(reviewID string) ([]FocusItem, error)
	// LoadAllSelfReviewFocusItems reads every sitting's list, keyed by review.
	LoadAllSelfReviewFocusItems() (map[string][]FocusItem, error)

	// UpsertReceivedFocusItem lands one coach item, keyed on item_id so
	// importing the same notes file twice updates rather than duplicates.
	// A re-import never resets a status the player has already moved.
	UpsertReceivedFocusItem(item ReceivedFocusItem) error
	// LoadReceivedFocusItems reads every received item, newest session first.
	LoadReceivedFocusItems() ([]ReceivedFocusItem, error)

	// SetFocusItemStatus moves one item — in either player-side family — to
	// new/working/done. ErrFocusItemUnknown when no item carries that id.
	SetFocusItemStatus(itemID, status string) error

	// DeleteReceivedFocusItemsFrom drops everything one archive landed,
	// keyed the way the archive identifies itself. Discarding a staged
	// return is the ONE way a coach's item leaves the player's list —
	// there is no per-item deny, so "I did not mean to import that" has
	// to have an answer somewhere.
	DeleteReceivedFocusItemsFrom(coachName, sessionDate string) error
}

func (s *SQLStore) SetCoachFocusItems(playerRef int64, items []FocusItem) error {
	return s.replaceFocusItems(focusReplace{
		deleteSQL: `DELETE FROM coach_focus_items WHERE player_ref = ?`,
		bornSQL:   `SELECT item_id, created_at FROM coach_focus_items WHERE player_ref = ?`,
		insertSQL: `INSERT INTO coach_focus_items (item_id, player_ref, text, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ` + suppliedInstantOrNow + `, ` + suppliedInstantOrNow + `)`,
		// The coach's authored list carries no status: it is what they are
		// telling the player, not the player's progress on it.
		withStatus: false,
		owner:      playerRef,
	}, items)
}

func (s *SQLStore) SetSelfReviewFocusItems(reviewID string, items []FocusItem) error {
	// The membership rows cascade off self_reviews, but an INSERT into the
	// child would happily land under a review_id that does not exist (the FK
	// is declared, and enforced — but a caller deserves the typed 404 its
	// siblings give rather than a constraint error).
	var exists int
	if err := s.db.QueryRow(`SELECT 1 FROM self_reviews WHERE review_id = ?`, reviewID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSelfReviewUnknown
		}
		return fmt.Errorf("look up self review: %w", err)
	}
	return s.replaceFocusItems(focusReplace{
		deleteSQL: `DELETE FROM self_review_focus_items WHERE review_id = ?`,
		bornSQL:   `SELECT item_id, created_at FROM self_review_focus_items WHERE review_id = ?`,
		insertSQL: `INSERT INTO self_review_focus_items (item_id, review_id, text, status, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ` + suppliedInstantOrNow + `, ` + suppliedInstantOrNow + `)`,
		withStatus: true,
		owner:      reviewID,
	}, items)
}

// focusReplace is one authored family's replacement shape.
type focusReplace struct {
	deleteSQL string
	insertSQL string
	// bornSQL reads (item_id, created_at) for the owner, so a wholesale
	// replacement can carry each surviving item's birthday across.
	bornSQL    string
	withStatus bool
	owner      any
}

// replaceFocusItems is the shared delete-then-insert both authored families
// use. Wholesale replacement rather than a per-row diff: the list is short,
// the client owns the order, and a reorder is then one statement instead of
// a sort-order dance. sort_order is the INDEX, not a value the caller sends
// — the order of the slice is the order of the list, so the two cannot drift.
func (s *SQLStore) replaceFocusItems(fam focusReplace, items []FocusItem) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("set focus items: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// When an item was FIRST written, read before the wipe takes it away.
	// Autosave calls this on every keystroke burst, so re-stamping created_at
	// each time would make every item look like it was written just now.
	born, err := bornAt(tx, fam)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(fam.deleteSQL, fam.owner); err != nil {
		return fmt.Errorf("clear focus items: %w", err)
	}
	for i, item := range items {
		args := []any{item.ItemID, fam.owner, item.Text}
		if fam.withStatus {
			args = append(args, statusOrDefault(item.Status, FocusWorking))
		}
		createdAt := item.CreatedAt
		if was, ok := born[item.ItemID]; ok && createdAt == "" {
			createdAt = was
		}
		args = append(args, i, createdAt, item.UpdatedAt)
		if _, err := tx.Exec(fam.insertSQL, args...); err != nil {
			return fmt.Errorf("insert focus item: %w", err)
		}
	}
	return commitFocus(tx, "set focus items")
}

func statusOrDefault(status, fallback string) string {
	switch status {
	case FocusNew, FocusWorking, FocusDone:
		return status
	default:
		return fallback
	}
}

func commitFocus(tx *sql.Tx, what string) error {
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit %s: %w", what, err)
	}
	return nil
}

func (s *SQLStore) LoadCoachFocusItems(playerRef int64) ([]FocusItem, error) {
	rows, err := s.db.Query(
		`SELECT item_id, text, '', sort_order, created_at, updated_at
		   FROM coach_focus_items WHERE player_ref = ? ORDER BY sort_order, id`, playerRef)
	if err != nil {
		return nil, fmt.Errorf("load coach focus items: %w", err)
	}
	return scanFocusItems(rows)
}

func (s *SQLStore) LoadSelfReviewFocusItems(reviewID string) ([]FocusItem, error) {
	rows, err := s.db.Query(
		`SELECT item_id, text, status, sort_order, created_at, updated_at
		   FROM self_review_focus_items WHERE review_id = ? ORDER BY sort_order, id`, reviewID)
	if err != nil {
		return nil, fmt.Errorf("load self review focus items: %w", err)
	}
	return scanFocusItems(rows)
}

func (s *SQLStore) LoadAllSelfReviewFocusItems() (map[string][]FocusItem, error) {
	rows, err := s.db.Query(
		`SELECT review_id, item_id, text, status, sort_order, created_at, updated_at
		   FROM self_review_focus_items ORDER BY review_id, sort_order, id`)
	if err != nil {
		return nil, fmt.Errorf("load all self review focus items: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := map[string][]FocusItem{}
	for rows.Next() {
		var reviewID string
		var it FocusItem
		if err := rows.Scan(&reviewID, &it.ItemID, &it.Text, &it.Status, &it.SortOrder, &it.CreatedAt, &it.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan self review focus item: %w", err)
		}
		out[reviewID] = append(out[reviewID], it)
	}
	return out, rows.Err()
}

func scanFocusItems(rows *sql.Rows) ([]FocusItem, error) {
	defer func() { _ = rows.Close() }()
	out := []FocusItem{}
	for rows.Next() {
		var it FocusItem
		if err := rows.Scan(&it.ItemID, &it.Text, &it.Status, &it.SortOrder, &it.CreatedAt, &it.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan focus item: %w", err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// UpsertReceivedFocusItem lands one coach item. The status is written only
// on FIRST landing: a re-import of the same notes file must not reset an
// item the player has already acknowledged or retired.
func (s *SQLStore) UpsertReceivedFocusItem(item ReceivedFocusItem) error {
	_, err := s.db.Exec(
		`INSERT INTO received_focus_items
		   (item_id, coach_name, session_date, text, status, sort_order, received_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, `+suppliedInstantOrNow+`, `+suppliedInstantOrNow+`)
		 ON CONFLICT(item_id) DO UPDATE SET
		   coach_name   = excluded.coach_name,
		   session_date = excluded.session_date,
		   text         = excluded.text,
		   sort_order   = excluded.sort_order,
		   updated_at   = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')`,
		item.ItemID, item.CoachName, item.SessionDate, item.Text,
		statusOrDefault(item.Status, FocusNew), item.SortOrder,
		item.CreatedAt, item.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert received focus item: %w", err)
	}
	return nil
}

// LoadReceivedFocusItems reads every received item, newest session first.
// coach_name sits before sort_order so two coaches whose archives share a
// session date read as two lists rather than interleaving item-by-item.
func (s *SQLStore) LoadReceivedFocusItems() ([]ReceivedFocusItem, error) {
	rows, err := s.db.Query(
		`SELECT item_id, coach_name, session_date, text, status, sort_order, received_at, updated_at
		   FROM received_focus_items ORDER BY session_date DESC, coach_name, sort_order, id`)
	if err != nil {
		return nil, fmt.Errorf("load received focus items: %w", err)
	}
	defer func() { _ = rows.Close() }()

	out := []ReceivedFocusItem{}
	for rows.Next() {
		var it ReceivedFocusItem
		if err := rows.Scan(&it.ItemID, &it.CoachName, &it.SessionDate, &it.Text,
			&it.Status, &it.SortOrder, &it.CreatedAt, &it.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan received focus item: %w", err)
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// SetFocusItemStatus moves an item in either player-side family. One method
// rather than two because the caller has an item id and nothing else — the
// UI's "Accept" and "Got this" know which row they are looking at, not which
// table it came from.
func (s *SQLStore) SetFocusItemStatus(itemID, status string) error {
	if statusOrDefault(status, "") == "" {
		return fmt.Errorf("%w: %q", ErrFocusItemStatusInvalid, status)
	}
	for _, table := range []string{"self_review_focus_items", "received_focus_items"} {
		// #nosec G202 -- table name comes from this hard-coded slice.
		res, err := s.db.Exec(
			`UPDATE `+table+` SET status = ?, updated_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'now')
			  WHERE item_id = ?`, status, itemID)
		if err != nil {
			return fmt.Errorf("set focus item status: %w", err)
		}
		if n, err := res.RowsAffected(); err == nil && n > 0 {
			return nil
		}
	}
	return ErrFocusItemUnknown
}

func (s *SQLStore) DeleteReceivedFocusItemsFrom(coachName, sessionDate string) error {
	_, err := s.db.Exec(
		`DELETE FROM received_focus_items WHERE coach_name = ? AND session_date = ?`,
		coachName, sessionDate)
	if err != nil {
		return fmt.Errorf("delete received focus items: %w", err)
	}
	return nil
}

// bornAt reads the created_at each surviving item already carries, keyed by
// item_id. The replacement is wholesale, so without this an item's birthday
// would move every time the list around it was edited.
func bornAt(tx *sql.Tx, fam focusReplace) (map[string]string, error) {
	rows, err := tx.Query(fam.bornSQL, fam.owner)
	if err != nil {
		return nil, fmt.Errorf("read focus item stamps: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := map[string]string{}
	for rows.Next() {
		var id, createdAt string
		if err := rows.Scan(&id, &createdAt); err != nil {
			return nil, fmt.Errorf("scan focus item stamp: %w", err)
		}
		out[id] = createdAt
	}
	return out, rows.Err()
}

// Bounds on a focus list, wherever it comes from — a coach's live PUT, the
// player's own sitting, a notes archive, a restored bundle.
const (
	// MaxFocusItemRunes bounds one line of what to work on: a sentence, not
	// an essay. The essay is the note.
	MaxFocusItemRunes = 2000
	// MaxFocusItems bounds the list. A sitting that concluded fifty things
	// concluded nothing.
	MaxFocusItems = 50
)

// ValidateFocusItems holds a list to its rules.
//
// ONE implementation, here beside the type, rather than one per package
// that writes a list: pkg/coach, pkg/review and pkg/bundle all reach the
// same three tables, and two rule sets that merely "agree" today are two
// that drift tomorrow. item_id follows note_id's identity rule for the same
// reason — it has to survive an export/import round trip without colliding.
func ValidateFocusItems(items []FocusItem) error {
	if len(items) > MaxFocusItems {
		return fmt.Errorf("%w: more than %d focus items", ErrFocusItemInvalid, MaxFocusItems)
	}
	seen := make(map[string]bool, len(items))
	for _, it := range items {
		if !IsUUID(it.ItemID) {
			return fmt.Errorf("%w: item_id %q is not a UUID", ErrFocusItemInvalid, it.ItemID)
		}
		if seen[it.ItemID] {
			return fmt.Errorf("%w: duplicate item_id %q", ErrFocusItemInvalid, it.ItemID)
		}
		seen[it.ItemID] = true
		if strings.TrimSpace(it.Text) == "" {
			return fmt.Errorf("%w: an item carries no text", ErrFocusItemInvalid)
		}
		if utf8.RuneCountInString(it.Text) > MaxFocusItemRunes {
			return fmt.Errorf("%w: an item exceeds %d characters", ErrFocusItemInvalid, MaxFocusItemRunes)
		}
	}
	return nil
}
