package dbtest

import (
	"cmp"
	"slices"
	"time"

	"recall/pkg/db"
)

// The focus list, in memory. Same contract as the SQL store: the slice's
// ORDER is the list's order (sort_order is the index, never a caller value),
// a re-landed coach item keeps the status the player moved it to, and a
// status change finds an item in either player-side family by id alone.

// stampFocus mirrors the SQL store's replacement: sort_order is the index,
// and an item already in the list keeps the created_at it was born with —
// the replacement is wholesale, so without `born` every autosave would move
// every item's birthday to now.
func stampFocus(items, born []db.FocusItem) []db.FocusItem {
	wasBorn := make(map[string]string, len(born))
	for _, it := range born {
		wasBorn[it.ItemID] = it.CreatedAt
	}
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	out := make([]db.FocusItem, 0, len(items))
	for i, it := range items {
		if it.CreatedAt == "" {
			it.CreatedAt = wasBorn[it.ItemID]
		}
		if it.CreatedAt == "" {
			it.CreatedAt = now
		}
		if it.UpdatedAt == "" {
			it.UpdatedAt = now
		}
		it.SortOrder = i
		out = append(out, it)
	}
	return out
}

func focusStatusOr(status, fallback string) string {
	switch status {
	case db.FocusNew, db.FocusWorking, db.FocusDone:
		return status
	default:
		return fallback
	}
}

func (f *Fake) SetCoachFocusItems(playerRef int64, items []db.FocusItem) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.CoachFocusItems == nil {
		f.CoachFocusItems = map[int64][]db.FocusItem{}
	}
	stamped := stampFocus(items, f.CoachFocusItems[playerRef])
	// The coach's authored list carries no status — mirror the SQL columns.
	for i := range stamped {
		stamped[i].Status = ""
	}
	f.CoachFocusItems[playerRef] = stamped
	return nil
}

func (f *Fake) LoadCoachFocusItems(playerRef int64) ([]db.FocusItem, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]db.FocusItem(nil), f.CoachFocusItems[playerRef]...), nil
}

func (f *Fake) SetSelfReviewFocusItems(reviewID string, items []db.FocusItem) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.SelfReviews[reviewID]; !ok {
		return db.ErrSelfReviewUnknown
	}
	if f.SelfReviewFocusItems == nil {
		f.SelfReviewFocusItems = map[string][]db.FocusItem{}
	}
	stamped := stampFocus(items, f.SelfReviewFocusItems[reviewID])
	for i := range stamped {
		stamped[i].Status = focusStatusOr(stamped[i].Status, db.FocusWorking)
	}
	f.SelfReviewFocusItems[reviewID] = stamped
	return nil
}

func (f *Fake) LoadSelfReviewFocusItems(reviewID string) ([]db.FocusItem, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]db.FocusItem(nil), f.SelfReviewFocusItems[reviewID]...), nil
}

func (f *Fake) LoadAllSelfReviewFocusItems() (map[string][]db.FocusItem, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string][]db.FocusItem{}
	for id, items := range f.SelfReviewFocusItems {
		if len(items) > 0 {
			out[id] = append([]db.FocusItem(nil), items...)
		}
	}
	return out, nil
}

func (f *Fake) UpsertReceivedFocusItem(item db.ReceivedFocusItem) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	if item.CreatedAt == "" {
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	for i, existing := range f.ReceivedFocusItems {
		if existing.ItemID != item.ItemID {
			continue
		}
		// A re-import updates the words and the order but NEVER the status:
		// the player has already acted on this one.
		existing.ReturnID = item.ReturnID
		existing.Text = item.Text
		existing.SortOrder = item.SortOrder
		existing.UpdatedAt = now
		f.ReceivedFocusItems[i] = existing
		return nil
	}
	item.Status = focusStatusOr(item.Status, db.FocusNew)
	f.ReceivedFocusItems = append(f.ReceivedFocusItems, item)
	return nil
}

// LoadReceivedFocusItems mirrors the SQL join: an item's coach and session
// date come from the return it arrived in, never from the item row, so a
// caller cannot read a provenance the archive did not write.
func (f *Fake) LoadReceivedFocusItems() ([]db.ReceivedFocusItem, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	returns := map[int64]db.CoachReturn{}
	for _, r := range f.CoachReturns {
		returns[r.ID] = r
	}
	out := make([]db.ReceivedFocusItem, 0, len(f.ReceivedFocusItems))
	for _, it := range f.ReceivedFocusItems {
		r, ok := returns[it.ReturnID]
		if !ok {
			continue // the SQL FK makes this state unreachable
		}
		it.CoachName, it.SessionDate = r.CoachName, r.SessionDate
		out = append(out, it)
	}
	slices.SortStableFunc(out, func(a, b db.ReceivedFocusItem) int {
		if c := cmp.Compare(b.SessionDate, a.SessionDate); c != 0 {
			return c
		}
		if c := cmp.Compare(a.CoachName, b.CoachName); c != 0 {
			return c
		}
		return cmp.Compare(a.SortOrder, b.SortOrder)
	})
	return out, nil
}

func (f *Fake) SetFocusItemStatus(itemID, status string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if focusStatusOr(status, "") == "" {
		return db.ErrFocusItemStatusInvalid
	}
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	for reviewID, items := range f.SelfReviewFocusItems {
		for i, it := range items {
			if it.ItemID != itemID {
				continue
			}
			items[i].Status = status
			items[i].UpdatedAt = now
			f.SelfReviewFocusItems[reviewID] = items
			return nil
		}
	}
	for i, it := range f.ReceivedFocusItems {
		if it.ItemID != itemID {
			continue
		}
		f.ReceivedFocusItems[i].Status = status
		f.ReceivedFocusItems[i].UpdatedAt = now
		return nil
	}
	return db.ErrFocusItemUnknown
}
