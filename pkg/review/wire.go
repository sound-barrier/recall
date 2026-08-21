package review

import "recall/pkg/db"

// The sitting as the API renders it. The shapes mirror the coach's session
// wire (coach.Note / coach.Moment) on purpose: the room's editor and desk are
// one set of components, and they read a self-review note the way they read
// a coach's draft.

// Session is one self-review sitting: the header, the member keys in the
// player's order, and the notes keyed by match.
type Session struct {
	ReviewID   string          `json:"review_id"`
	Title      string          `json:"title"`
	FocusItems []FocusItem     `json:"focus_items"`
	CreatedAt  string          `json:"created_at"`
	UpdatedAt  string          `json:"updated_at"`
	FinishedAt string          `json:"finished_at,omitempty"`
	MatchKeys  []string        `json:"match_keys"`
	Notes      map[string]Note `json:"notes"`
}

// Note is the sitting's note about one match, moments included.
type Note struct {
	MatchKey   string   `json:"match_key"`
	Kind       string   `json:"kind"`
	Text       string   `json:"text"`
	FocusTags  []string `json:"focus_tags"`
	ExtraTags  []string `json:"extra_tags"`
	MatchClock string   `json:"match_clock"`
	// Moments in reading order; omitempty so a note with none carries no key
	// rather than a null.
	Moments   []Moment `json:"moments,omitempty"`
	CreatedAt string   `json:"created_at"`
	UpdatedAt string   `json:"updated_at"`
}

// FocusItem is one line of what the sitting concluded — a thing to work on.
// Status is the player's own progress: new, working, done.
type FocusItem struct {
	ItemID string `json:"item_id"`
	Text   string `json:"text"`
	Status string `json:"status"`
}

// Moment is one timestamped observation inside a note.
type Moment struct {
	MomentID   string `json:"moment_id"`
	MatchClock string `json:"match_clock"`
	Text       string `json:"text"`
	FocusTag   string `json:"focus_tag,omitempty"`
	// SortOrder is the authored order, kept only to break ties between two
	// moments stamped at the same second.
	SortOrder int    `json:"-"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

func sessionFromRow(r db.SelfReview) Session {
	out := Session{
		ReviewID: r.ReviewID, Title: r.Title, FocusItems: focusItemsFromRows(r.FocusItems),
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt, FinishedAt: r.FinishedAt,
		MatchKeys: emptyIfNil(r.MatchKeys), Notes: make(map[string]Note, len(r.Notes)),
	}
	for k, n := range r.Notes {
		out.Notes[k] = noteFromRow(n)
	}
	return out
}

func sessionsFromRows(rows []db.SelfReview) []Session {
	out := make([]Session, 0, len(rows))
	for _, r := range rows {
		out = append(out, sessionFromRow(r))
	}
	return out
}

func noteFromRow(n db.SelfReviewNote) Note {
	out := Note{
		MatchKey: n.MatchKey, Kind: n.Kind, Text: n.Text,
		FocusTags: emptyIfNil(n.FocusTags), ExtraTags: emptyIfNil(n.ExtraTags),
		MatchClock: n.MatchClock, CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt,
	}
	for _, m := range n.Moments {
		out.Moments = append(out.Moments, momentFromRow(m))
	}
	return out
}

func momentFromRow(m db.SelfReviewMoment) Moment {
	return Moment{MomentID: m.MomentID, MatchClock: m.MatchClock, Text: m.Text, FocusTag: m.FocusTag, SortOrder: m.SortOrder, UpdatedAt: m.UpdatedAt}
}

// emptyIfNil keeps a required-array field an array on the wire.
func emptyIfNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func focusItemsFromRows(rows []db.FocusItem) []FocusItem {
	out := make([]FocusItem, 0, len(rows))
	for _, r := range rows {
		out = append(out, FocusItem{ItemID: r.ItemID, Text: r.Text, Status: string(r.Status)})
	}
	return out
}

// ValidateFocusItems holds the player's own list to its rules. Delegates:
// pkg/db owns the rule set, because pkg/coach and pkg/bundle write the same
// tables and two rule sets that merely agree today are two that drift.
func ValidateFocusItems(items []db.FocusItem) error {
	return db.ValidateFocusItems(items)
}
