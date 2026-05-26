package app

import (
	"errors"
	"fmt"

	"recall/pkg/db"
)

// validLeavers enumerates the three scenarios users can annotate a
// match with:
//   - "self"  — the user themselves left the match (data is partial)
//   - "team"  — an ally left the match
//   - "enemy" — an opposing-team player left the match
//
// The empty string means "no annotation"; callers use
// ClearLeaverAnnotation to remove an existing one instead of passing
// "".
var validLeavers = map[string]bool{"self": true, "team": true, "enemy": true}

// ErrInvalidLeaver is returned by SetLeaverAnnotation when the leaver
// value isn't one of the three allowed scenarios. HTTP handlers map
// this to 400 (user-input error) rather than 500.
var ErrInvalidLeaver = errors.New("invalid leaver: must be 'self', 'team', or 'enemy'")

// SetLeaverAnnotation upserts a user-curated leaver annotation for the
// match identified by matchKey. The leaver string is validated
// client-side AND server-side (the SQLite CHECK constraint is the
// last line of defence). `note` is reserved free-text storage —
// currently unused in the UI but plumbed through so future per-match
// commentary can ride the same channel.
func (a *App) SetLeaverAnnotation(matchKey, leaver, note string) error {
	if matchKey == "" {
		return fmt.Errorf("match_key required")
	}
	if !validLeavers[leaver] {
		return ErrInvalidLeaver
	}
	return a.store.SetAnnotation(db.Annotation{
		MatchKey: matchKey,
		Leaver:   leaver,
		Note:     note,
	})
}

// ClearLeaverAnnotation removes any annotation for matchKey. Idempotent
// — deleting a non-existent annotation is a no-op, not an error.
func (a *App) ClearLeaverAnnotation(matchKey string) error {
	if matchKey == "" {
		return fmt.Errorf("match_key required")
	}
	return a.store.DeleteAnnotation(matchKey)
}
