package coachreturn

import (
	"fmt"

	"recall/pkg/coach"
	"recall/pkg/db"
	"recall/pkg/match"
)

// MatchMaker materializes the match a note is about and returns its key.
//
// A func-var seam rather than three more methods on Store, per the
// one-method-dependency rule — and because the decision that an import may
// CREATE matches belongs in the shell that already gates writes, not in this
// package's data interface.
type MatchMaker func(coach.Note) (string, error)

// keyResolver binds the keys in a returned archive to keys in this history.
//
// Every key but one resolves to itself: a `match-…` key was minted from the
// player's own clock and either exists here or does not. A `replay-…` key
// was minted from six characters a coach typed, on a machine with none of
// this player's data — so it names nothing here until it is bound, by the
// code, to whichever match carries it.
//
// Built fresh on every read rather than written into the archive. Two things
// fall out of that, both wanted: the archive stays the verbatim document its
// content hash was taken over, and an unbound note HEALS — a player who adds
// the code to their own match after importing sees the note bind on the next
// read, with no re-import and nothing to explain.
type keyResolver struct{ byCode map[string]string }

func newKeyResolver(annotations map[string]db.Annotation) keyResolver {
	byCode := make(map[string]string, len(annotations))
	for key, a := range annotations {
		code, ok := match.NormalizeReplayCode(a.ReplayCode)
		if !ok {
			continue
		}
		// The store's open-time pass makes replay codes unique, so the last
		// writer here cannot be ambiguous — there is at most one match per
		// code by the time anything reads this.
		byCode[code] = key
	}
	return keyResolver{byCode: byCode}
}

// resolve returns the local key a note's key names, or the key unchanged
// when nothing here answers to it.
func (r keyResolver) resolve(noteKey string) string {
	k, err := match.ParseKey(noteKey)
	if err != nil || !k.IsReplay() {
		return noteKey
	}
	if local, ok := r.byCode[k.ReplayCode()]; ok {
		return local
	}
	return noteKey
}

// creatable reports whether a key names a match this history could still
// gain — which is exactly the replay keys that did not bind.
//
// This is why a replay note is never an orphan. An orphan is a note about a
// match that cannot be recovered; one about a replay always can be, by
// making it from the context the coach recorded. Reporting it as an orphan
// would tell a player their coach's work is unusable when it is one click
// from landing.
func (r keyResolver) creatable(noteKey string) bool {
	k, err := match.ParseKey(noteKey)
	return err == nil && k.IsReplay() && r.resolve(noteKey) == noteKey
}

// loadResolver reads the annotations the binding is built from.
func loadResolver(st Store) (keyResolver, error) {
	annotations, err := st.LoadAnnotations()
	if err != nil {
		return keyResolver{}, fmt.Errorf("coach: load annotations: %w", err)
	}
	return newKeyResolver(annotations), nil
}
