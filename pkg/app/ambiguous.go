package app

import (
	"errors"
	"fmt"
	"slices"

	"recall/pkg/aggregate"
	"recall/pkg/applog"
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
	if serr := a.assertNoCoachSession(); serr != nil {
		return serr
	}
	mk, err := match.ParseKey(ambiguousMatchKey)
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
	ok, err := a.store.ResolveAmbiguous(mk.Filename(), ambiguousMatchKey, resolvedTo)
	if err != nil {
		return err
	}
	if !ok {
		return ErrAmbiguousNotFound
	}
	a.rememberKeepSeparate(resolvedTo, cands)
	a.emitResolvedMatch(resolvedTo)
	return nil
}

// rememberKeepSeparate records the user's verdict when they resolved a
// possible duplicate to a fresh key instead of merging it — the judgment
// they made by reading two scoreboards, so nothing asks them to make it
// again and both cards can say so.
//
// Only a candidate a sweep proposed as a DUPLICATE earns a link. An
// ordinary EAD / timestamp-window near-miss is routine attribution, and a
// "possible duplicate of" chip there would be a claim nobody made.
//
// Only the closest such candidate: duplicate_matches keys on match_key, one
// verdict per match. Candidates arrive sorted by distance ascending, so the
// first is the one the user was most plausibly deciding against.
//
// Best-effort — the resolution already committed, and losing a chip is not
// worth failing the write the user actually asked for.
func (a *App) rememberKeepSeparate(resolvedTo string, cands []db.AmbiguousCandidate) {
	if slices.ContainsFunc(cands, func(c db.AmbiguousCandidate) bool { return c.MatchKey == resolvedTo }) {
		return // a merge: the two are one match now, nothing left to point at
	}
	for _, c := range cands {
		if c.Reason == "" {
			continue
		}
		if err := a.store.LinkDuplicateMatches(resolvedTo, c.MatchKey); err != nil {
			applog.Subsystem("parse").Error("keep-separate: link failed",
				"match_key", resolvedTo, "duplicate_of", c.MatchKey, "err", err)
		}
		return
	}
}

// emitResolvedMatch re-aggregates the just-resolved match and broadcasts
// it so subscribers see the new state without re-fetching the full list.
// Best-effort: a read failure costs a refresh, not the resolution.
func (a *App) emitResolvedMatch(matchKey string) {
	snap, err := a.store.LoadAll()
	if err != nil {
		return
	}
	if rec, ok := aggregate.MatchKey(matchKey, snap, a.loadSidecars()); ok {
		a.emitMatchUpdated(rec)
	}
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
	mk, err := match.ParseKey(resolvedTo)
	return err == nil && mk.IsTracked()
}
