package coachreturn

import (
	"errors"
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
// `create` materializes the match a replay note is about, and is called ONLY
// on accept. That timing is the whole design: an import changes no match
// until the player says so, and discarding a return therefore leaves nothing
// stranded — DeleteCoachReturn can drop an archive, but it could never
// un-make a match that staging had already created.
func Decide(st Store, id int64, decisions []Verdict, localHandle string, create MatchMaker) (Sheet, error) {
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
	resolver, err := loadResolver(st)
	if err != nil {
		return Sheet{}, err
	}
	targets, err := resolveDecisions(f.Notes, keys, resolver, decisions)
	if err != nil {
		return Sheet{}, err
	}
	for _, t := range targets {
		if err := applyDecision(st, r.ID, f, t, create); err != nil {
			return Sheet{}, err
		}
	}
	return Get(st, id, localHandle)
}

// MaxCreatedPerBatch bounds how many matches one decision batch may bring
// into existence.
//
// A notes archive is a file from someone else, and coach.maxNotesPerFile
// lets it carry five thousand notes. Every note about a replay this history
// has never seen is a match accepting would CREATE, so an "accept
// everything" on a careless — or hostile — file could fabricate a career out
// of one import. A real coaching session is a handful of matches; anything
// past this is not a session, and refusing is the honest answer.
const MaxCreatedPerBatch = 25

// ErrTooManyCreated rejects a batch that would create more matches than a
// coaching session plausibly reviews.
var ErrTooManyCreated = errors.New("that file would add too many matches at once")

// decisionTarget is one validated decision paired with the note it names.
type decisionTarget struct {
	note     coach.Note
	decision Decision
}

// resolveDecisions checks every decision against the file and the local
// history before any is applied. Only an accept needs a match to land on:
// skipping is how a player dismisses a note about a match they no longer
// have, and refusing it would take the rest of the batch down too.
func resolveDecisions(notes []coach.Note, keys map[string]bool, resolver keyResolver, decisions []Verdict) ([]decisionTarget, error) {
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
		// An accept needs somewhere to land — either a match that is here,
		// or a replay this history can still gain. Only a note about a
		// screenshot-derived match the player no longer has is an orphan.
		if d.Decision == DecisionAccepted &&
			!keys[resolver.resolve(n.MatchKey)] && !resolver.creatable(n.MatchKey) {
			return nil, fmt.Errorf("%w: %s", ErrOrphan, n.MatchKey)
		}
		out = append(out, decisionTarget{note: n, decision: d.Decision})
	}
	if err := boundCreations(out, resolver); err != nil {
		return nil, err
	}
	return out, nil
}

// boundCreations refuses a batch that would make too many matches. Checked
// here, with the rest of the validation, so the refusal happens BEFORE
// anything is written — a batch that is going to be rejected must not leave
// half a history behind it.
func boundCreations(targets []decisionTarget, resolver keyResolver) error {
	creating := 0
	for _, t := range targets {
		if t.decision == DecisionAccepted && resolver.creatable(t.note.MatchKey) {
			creating++
		}
	}
	if creating > MaxCreatedPerBatch {
		return fmt.Errorf("%w: %d matches, limit %d", ErrTooManyCreated, creating, MaxCreatedPerBatch)
	}
	return nil
}

func applyDecision(st Store, returnID int64, f coach.NotesFile, t decisionTarget, create MatchMaker) error {
	var err error
	if t.decision == DecisionAccepted {
		err = acceptNote(st, f, t.note, create)
	} else {
		err = skipNote(st, t.note)
	}
	if err != nil {
		return err
	}
	if err := st.SetCoachReturnDecision(returnID, t.note.NoteID, string(t.decision)); err != nil {
		return fmt.Errorf("coach: record decision: %w", err)
	}
	return nil
}

// acceptNote writes the accept's effect: the block for a note, then the
// coach review either way. The store stamps reviewed_at with its own clock;
// dating it with the coach's session date is left to the store's caller.
func acceptNote(st Store, f coach.NotesFile, n coach.Note, create MatchMaker) error {
	// Bind first, and MAKE the match if nothing here answers to the code.
	// Everything below writes on the resolved key: writing on the coach's
	// replay key would put their words on a match the player cannot see.
	local, err := landingKeyFor(st, n, create)
	if err != nil {
		return err
	}
	n.MatchKey = local

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

// landingKeyFor answers where an accepted note goes: the local match that
// carries its replay code, or a match made from the context the coach
// recorded. Re-resolved here rather than carried down from resolveDecisions
// because creating one match can be what binds the next note.
func landingKeyFor(st Store, n coach.Note, create MatchMaker) (string, error) {
	resolver, err := loadResolver(st)
	if err != nil {
		return "", err
	}
	if local := resolver.resolve(n.MatchKey); local != n.MatchKey {
		return local, nil
	}
	if !resolver.creatable(n.MatchKey) {
		return n.MatchKey, nil
	}
	created, err := create(n)
	if err != nil {
		return "", fmt.Errorf("coach: create match for note %s: %w", n.NoteID, err)
	}
	return created, nil
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
