package app

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"recall/pkg/db"
)

// The PLAYER's focus list — "what you're working on" — assembled from the
// two families that feed it: what a coach sent (received_focus_items) and
// what the player wrote in their own sittings (self_review_focus_items).
//
// Order is the product decision, not a detail: a COACH's items come first,
// newest session first, then the player's own, newest sitting first. That is
// what "coach is priority" means for the live-session readout, and the list
// and the readout must agree or the readout is arbitrary.

// Where a focus item came from. Named because these two strings are the whole
// vocabulary of the `source` field, and the frontend switches on them.
const (
	SourceCoach = "coach"
	SourceSelf  = "self"
)

// FocusEntry is one line of the player's list, with enough provenance for
// the UI to say where it came from and to sort it.
type FocusEntry struct {
	ItemID string `json:"item_id"`
	Text   string `json:"text"`
	Status string `json:"status"`
	// Source says who wrote it — SourceCoach or SourceSelf. Coach entries carry
	// the name that sent it.
	Source    string `json:"source"`
	CoachName string `json:"coach_name,omitempty"`
	// From is the session date (coach) or the sitting's creation day (self),
	// which is what the list orders by within each source.
	From string `json:"from"`
	// SourceID is the way back: the return sheet's id (coach) or the
	// sitting's review id (self). The band turns provenance into a door
	// with it — an item's origin was previously named but unreachable.
	SourceID string `json:"source_id,omitempty"`
}

// FocusList returns the player's whole list, coach items first, each source
// newest-first. Done items are included — retiring one is not deleting it —
// and the caller decides what to show.
func (a *App) FocusList() ([]FocusEntry, error) {
	received, err := a.store.LoadReceivedFocusItems()
	if err != nil {
		return nil, fmt.Errorf("focus: load received items: %w", err)
	}
	out := make([]FocusEntry, 0, len(received))
	for _, it := range received {
		out = append(out, FocusEntry{
			ItemID: it.ItemID, Text: it.Text, Status: string(it.Status),
			Source: SourceCoach, CoachName: it.CoachName, From: it.SessionDate,
			SourceID: strconv.FormatInt(it.ReturnID, 10),
		})
	}

	sittings, err := a.store.LoadSelfReviews()
	if err != nil {
		return nil, fmt.Errorf("focus: load sittings: %w", err)
	}
	byReview, err := a.store.LoadAllSelfReviewFocusItems()
	if err != nil {
		return nil, fmt.Errorf("focus: load own items: %w", err)
	}
	// LoadSelfReviews is already newest-first (ORDER BY created_at DESC),
	// which is the order this half wants: a walk BACKWARD over it led the
	// player's own items with whatever they concluded six months ago.
	for _, s := range sittings {
		for _, it := range byReview[s.ReviewID] {
			out = append(out, FocusEntry{
				ItemID: it.ItemID, Text: it.Text, Status: string(it.Status),
				Source: SourceSelf, From: day(s.CreatedAt),
				SourceID: s.ReviewID,
			})
		}
	}
	return out, nil
}

// day is the calendar day an instant falls on IN THE VIEWER'S ZONE.
//
// A sitting opened at 18:00 in UTC-7 is stamped past midnight UTC, so
// slicing the first ten characters printed tomorrow's date under something
// the player wrote this evening.
func day(instant string) string {
	if t, err := time.Parse(time.RFC3339, instant); err == nil {
		return t.Local().Format(time.DateOnly)
	}
	if len(instant) >= 10 {
		return instant[:10]
	}
	return instant
}

// SetFocusItemStatus moves one of the player's items. There is no "denied":
// a coach's item is active the moment it lands, Accept acknowledges it
// (new → working), and "Done with this" retires it (→ done) without deleting what
// was said.
func (a *App) SetFocusItemStatus(itemID, status string) error {
	// The one lock: while a coach session is open the visible records are
	// someone else's loan, and this list is the player's own.
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	if strings.TrimSpace(itemID) == "" {
		return fmt.Errorf("%w: no item id", db.ErrFocusItemUnknown)
	}
	// The wire carries a string; this is the one place it becomes a status.
	return a.store.SetFocusItemStatus(itemID, db.FocusStatus(status))
}
