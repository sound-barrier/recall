package coachreturn

import (
	"fmt"

	"recall/pkg/coach"
	"recall/pkg/db"
)

// Decide records the player's verdicts on a staged return and applies each
// one: an accept writes the coach's block onto the match (or, for a
// reviewed_only mark, only the flag) and marks the match reviewed by coach;
// a skip removes a block an earlier accept wrote. The batch is validated
// whole before anything is written — an unknown note_id or decision value
// is coach.ErrNoteInvalid, and ACCEPTING a note whose match is not in the
// player's history is ErrOrphan — and the recomputed sheet is
// returned (localHandle feeds its PlayerMismatch flag). Partial and
// repeatable: undecided notes stay pending, a repeat accept upserts.
func Decide(st Store, id int64, decisions []Verdict, localHandle string) (Sheet, error) {
	r, ok, err := st.LoadCoachReturn(id)
	if err != nil {
		return Sheet{}, fmt.Errorf("coach: load return %d: %w", id, err)
	}
	if !ok {
		return Sheet{}, db.ErrCoachReturnUnknown
	}
	f, err := coach.DecodeNotesFile(r.NotesJSON)
	if err != nil {
		return Sheet{}, err
	}
	keys, err := st.LoadMatchKeys()
	if err != nil {
		return Sheet{}, fmt.Errorf("coach: load match keys: %w", err)
	}
	targets, err := resolveDecisions(f.Notes, keys, decisions)
	if err != nil {
		return Sheet{}, err
	}
	for _, t := range targets {
		if err := applyDecision(st, r.ID, f, t); err != nil {
			return Sheet{}, err
		}
	}
	return Get(st, id, localHandle)
}

// decisionTarget is one validated decision paired with the note it names.
type decisionTarget struct {
	note     coach.Note
	decision string
}

// resolveDecisions checks every decision against the file and the local
// history before any is applied. Only an accept needs a match to land on:
// skipping is how a player dismisses a note about a match they no longer
// have, and refusing it would take the rest of the batch down too.
func resolveDecisions(notes []coach.Note, keys map[string]bool, decisions []Verdict) ([]decisionTarget, error) {
	byID := make(map[string]coach.Note, len(notes))
	for _, n := range notes {
		byID[n.NoteID] = n
	}
	out := make([]decisionTarget, 0, len(decisions))
	for _, d := range decisions {
		n, ok := byID[d.NoteID]
		if !ok {
			return nil, fmt.Errorf("%w: note %q is not on this sheet", coach.ErrNoteInvalid, d.NoteID)
		}
		if d.Decision != DecisionAccepted && d.Decision != DecisionSkipped {
			return nil, fmt.Errorf("%w: decision %q must be %q or %q", coach.ErrNoteInvalid, d.Decision, DecisionAccepted, DecisionSkipped)
		}
		if d.Decision == DecisionAccepted && !keys[n.MatchKey] {
			return nil, fmt.Errorf("%w: %s", ErrOrphan, n.MatchKey)
		}
		out = append(out, decisionTarget{note: n, decision: d.Decision})
	}
	return out, nil
}

func applyDecision(st Store, returnID int64, f coach.NotesFile, t decisionTarget) error {
	var err error
	if t.decision == DecisionAccepted {
		err = acceptNote(st, f, t.note)
	} else {
		err = skipNote(st, t.note)
	}
	if err != nil {
		return err
	}
	if err := st.SetCoachReturnDecision(returnID, t.note.NoteID, t.decision); err != nil {
		return fmt.Errorf("coach: record decision: %w", err)
	}
	return nil
}

// acceptNote writes the accept's effect: the block for a note, then the
// coach review either way. The store stamps reviewed_at with its own clock;
// dating it with the coach's session date is left to the store's caller.
func acceptNote(st Store, f coach.NotesFile, n coach.Note) error {
	// A reviewed_only mark carries nothing to keep — UNLESS it carries
	// moments. That is not an edge case: stamping a timestamp on a match the
	// coach has not written a paragraph about opens exactly a reviewed_only
	// note, so a review made entirely of moments is entirely this shape. The
	// kind check alone threw the whole payload away on accept, silently, and
	// then reported the note accepted.
	if n.Kind != coach.KindReviewedOnly || len(n.Moments) > 0 {
		if _, err := st.UpsertMatchCoachNote(coach.MatchCoachNoteFromNote(n, f.CoachName, f.SessionDate)); err != nil {
			return fmt.Errorf("coach: accept note %s: %w", n.NoteID, err)
		}
	}
	if err := st.SetReview(n.MatchKey, reviewedByCoach); err != nil {
		return fmt.Errorf("coach: mark %s reviewed: %w", n.MatchKey, err)
	}
	return nil
}

// skipNote undoes an earlier accept's block, if one exists; the review
// flag stays (whether it was the player's own cannot be known).
func skipNote(st Store, n coach.Note) error {
	blocks, err := loadBlocksByNoteID(st)
	if err != nil {
		return err
	}
	b, ok := blocks[n.NoteID]
	if !ok {
		return nil
	}
	if err := st.DeleteMatchCoachNote(b.ID); err != nil {
		return fmt.Errorf("coach: remove block for %s: %w", n.NoteID, err)
	}
	return nil
}
