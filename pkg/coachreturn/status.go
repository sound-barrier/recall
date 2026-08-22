package coachreturn

import (
	"fmt"

	"recall/pkg/coach"
	"recall/pkg/db"
)

// sheetState is the store snapshot a note's status is derived from: which
// keys the player tracks, which matches are coach-reviewed, and which
// accepted blocks exist, by note_id.
type sheetState struct {
	keys          map[string]bool
	reviews       map[string]db.ReviewState
	blockByNoteID map[string]db.MatchCoachNote
	// resolver binds a coach's replay key to whichever local match carries
	// that code. Every other key resolves to itself.
	resolver keyResolver
}

// localKeyFor is the key a note actually concerns on THIS machine.
func (s sheetState) localKeyFor(n coach.Note) string {
	return s.resolver.resolve(n.MatchKey)
}

func loadSheetState(st Store) (sheetState, error) {
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
	resolver, err := loadResolver(st)
	if err != nil {
		return sheetState{}, err
	}
	return sheetState{keys: keys, reviews: reviews, blockByNoteID: blocks, resolver: resolver}, nil
}

func loadBlocksByNoteID(st Store) (map[string]db.MatchCoachNote, error) {
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
func (s sheetState) statusOf(n coach.Note, decisions map[string]db.CoachDecision) Status {
	// A replay note that binds to nothing is NOT an orphan. An orphan is a
	// note about a match that cannot be recovered; this one can, by making
	// it from the context the coach recorded, which is what accepting does.
	// Calling it an orphan would tell a player their coach's work is
	// unusable when it is one click from landing.
	if !s.keys[s.localKeyFor(n)] && !s.resolver.creatable(n.MatchKey) {
		return StatusOrphan
	}
	if d, ok := decisions[n.NoteID]; ok {
		// The store speaks strings; the vocabulary is this package's.
		return Status(d.Decision)
	}
	if s.accepted(n) {
		return StatusAccepted
	}
	return StatusPending
}

func (s sheetState) accepted(n coach.Note) bool {
	if n.Kind == coach.KindReviewedOnly {
		return s.reviews[s.localKeyFor(n)].ReviewedBy == reviewedByCoach
	}
	_, ok := s.blockByNoteID[n.NoteID]
	return ok
}
