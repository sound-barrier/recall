package coach

import (
	"fmt"

	"recall/pkg/db"
)

// sheetState is the store snapshot a note's status is derived from: which
// keys the player tracks, which matches are coach-reviewed, and which
// accepted blocks exist, by note_id.
type sheetState struct {
	keys          map[string]bool
	reviews       map[string]db.ReviewState
	blockByNoteID map[string]db.MatchCoachNote
}

func loadSheetState(st ReturnStore) (sheetState, error) {
	keys, err := st.LoadMatchKeys()
	if err != nil {
		return sheetState{}, fmt.Errorf("coach: load match keys: %w", err)
	}
	reviews, err := st.LoadReviews()
	if err != nil {
		return sheetState{}, fmt.Errorf("coach: load reviews: %w", err)
	}
	blocks, err := loadBlocksByNoteID(st)
	if err != nil {
		return sheetState{}, err
	}
	return sheetState{keys: keys, reviews: reviews, blockByNoteID: blocks}, nil
}

func loadBlocksByNoteID(st ReturnStore) (map[string]db.MatchCoachNote, error) {
	byKey, err := st.LoadMatchCoachNotes()
	if err != nil {
		return nil, fmt.Errorf("coach: load coach notes: %w", err)
	}
	out := map[string]db.MatchCoachNote{}
	for _, blocks := range byKey {
		for _, b := range blocks {
			out[b.NoteID] = b
		}
	}
	return out, nil
}

// statusOf applies the precedence: orphan (match not in history) › the
// recorded decision › accepted when the accept's effect is already visible
// (a block with this note_id, or a coach review for a reviewed_only mark)
// › pending.
func (s sheetState) statusOf(n Note, decisions map[string]db.CoachDecision) string {
	if !s.keys[n.MatchKey] {
		return StatusOrphan
	}
	if d, ok := decisions[n.NoteID]; ok {
		return d.Decision
	}
	if s.accepted(n) {
		return StatusAccepted
	}
	return StatusPending
}

func (s sheetState) accepted(n Note) bool {
	if n.Kind == KindReviewedOnly {
		return s.reviews[n.MatchKey].ReviewedBy == reviewedByCoach
	}
	_, ok := s.blockByNoteID[n.NoteID]
	return ok
}
