package app

import (
	"fmt"
	"slices"
	"strings"

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

// FocusEntry is one line of the player's list, with enough provenance for
// the UI to say where it came from and to sort it.
type FocusEntry struct {
	ItemID string `json:"item_id"`
	Text   string `json:"text"`
	Status string `json:"status"`
	// Source is "coach" or "self"; coach entries carry the name that sent it.
	Source    string `json:"source"`
	CoachName string `json:"coach_name,omitempty"`
	// From is the session date (coach) or the sitting's creation day (self),
	// which is what the list orders by within each source.
	From string `json:"from"`
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
			ItemID: it.ItemID, Text: it.Text, Status: it.Status,
			Source: "coach", CoachName: it.CoachName, From: it.SessionDate,
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
	// Newest sitting first, so the player's own half reads the way the
	// coach's half does.
	for _, s := range slices.Backward(sittings) {
		for _, it := range byReview[s.ReviewID] {
			out = append(out, FocusEntry{
				ItemID: it.ItemID, Text: it.Text, Status: it.Status,
				Source: "self", From: day(s.CreatedAt),
			})
		}
	}
	return out, nil
}

func day(instant string) string {
	if len(instant) >= 10 {
		return instant[:10]
	}
	return instant
}

// SetFocusItemStatus moves one of the player's items. There is no "denied":
// a coach's item is active the moment it lands, Accept acknowledges it
// (new → working), and "Got this" retires it (→ done) without deleting what
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
	return a.store.SetFocusItemStatus(itemID, status)
}
