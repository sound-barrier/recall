package app

import (
	"errors"
	"fmt"

	"recall/pkg/db"
	"recall/pkg/match"
)

// ErrInvalidAmbiguousKey is returned when an ambiguous-resolution
// request supplies a match key that doesn't start with "ambiguous-".
// HTTP layer maps this to 400.
var ErrInvalidAmbiguousKey = errors.New("invalid ambiguous match key")

// ErrInvalidResolution is returned when the user picks a target match
// key that isn't in the original candidate list AND doesn't follow the
// fresh-key escape hatch ("match-<ts>" derived from the screenshot
// itself). HTTP layer maps this to 400.
var ErrInvalidResolution = errors.New("resolved_to is not a valid candidate")

// ErrAmbiguousNotFound is returned when there's no ambiguous row to
// resolve for the given match_key. HTTP layer maps this to 404.
var ErrAmbiguousNotFound = errors.New("ambiguous screenshot not found")

// ResolveAmbiguousMatch rewrites every parent row carrying the given
// ambiguous match_key to resolvedTo. The user has chosen one of the
// recorded candidates (or, via the escape hatch, a fresh
// "match-<ts>" minted from the screenshot's filename timestamp).
//
//   - ambiguousMatchKey must start with "ambiguous-" — anything else
//     is rejected as ErrInvalidAmbiguousKey.
//   - resolvedTo must either be in the screenshot's stored candidate
//     list, or be a "match-<...>" key. Other shapes are rejected as
//     ErrInvalidResolution. The fresh-key escape hatch is the
//     "treat as new match" affordance in the Unknown tab.
//   - Returns ErrAmbiguousNotFound when there's no ambiguous row
//     to resolve; HTTP layer maps this to 404.
//
// On success, the in-memory aggregate cache (delivered via SSE) is
// refreshed by re-emitting a match-updated event for resolvedTo.
func (a *App) ResolveAmbiguousMatch(ambiguousMatchKey, resolvedTo string) error {
	mk, err := match.ParseMatchKey(ambiguousMatchKey)
	if err != nil || !mk.IsAmbiguous() {
		return fmt.Errorf("%w: %q", ErrInvalidAmbiguousKey, ambiguousMatchKey)
	}
	cands, err := a.store.LoadAmbiguousCandidatesFor(mk.Filename())
	if err != nil {
		return err
	}
	if len(cands) == 0 {
		return ErrAmbiguousNotFound
	}
	if !validResolution(resolvedTo, cands) {
		return fmt.Errorf("%w: %q", ErrInvalidResolution, resolvedTo)
	}
	ok, err := a.store.ResolveAmbiguous(ambiguousMatchKey, resolvedTo)
	if err != nil {
		return err
	}
	if !ok {
		return ErrAmbiguousNotFound
	}
	// Re-aggregate the resolved match so subscribers see the updated
	// state without needing to re-fetch the full match list.
	snap, err := a.store.LoadAll()
	if err == nil {
		annos, _ := a.store.LoadAnnotations()
		hidden, _ := a.store.LoadHiddenKeys()
		reviews, _ := a.store.LoadReviews()
		if rec, ok := aggregateMatchKey(resolvedTo, snap, annos, hidden, reviews); ok {
			a.emitMatchUpdated(rec)
		}
	}
	return nil
}

// validResolution accepts the picked target if it's one of the
// recorded candidates OR a fresh "match-<...>" key the user minted
// via the "treat as new match" escape hatch.
func validResolution(resolvedTo string, cands []db.AmbiguousCandidate) bool {
	for _, c := range cands {
		if c.MatchKey == resolvedTo {
			return true
		}
	}
	mk, err := match.ParseMatchKey(resolvedTo)
	return err == nil && mk.IsTracked()
}
