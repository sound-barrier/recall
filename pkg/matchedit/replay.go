package matchedit

import (
	"fmt"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// CreateFromReplay materializes the match a coach's review is about, when
// the player does not have it.
//
// Deliberately NOT CreateManual, which is wrong here in all three of its
// load-bearing decisions: it mints the key from a wall clock (this key comes
// from the code, which is the point), it answers ErrMatchKeyExists on a
// collision (re-opening an archive you already accepted is not a mistake,
// and has to be a quiet no-op), and it requires a map and a result (the
// player was there; a coach may have observed only that the match happened).
//
// Idempotent by construction: an existing key returns unchanged, so the
// match the PLAYER has always wins over what a coach typed about it.
func CreateFromReplay(s db.Store, in match.ReplayMatchInput) (string, error) {
	key, ok := match.NewReplayMatchKey(in.Code)
	if !ok {
		return "", fmt.Errorf("%w: %q", match.ErrInvalidReplayCode, in.Code)
	}
	if err := validateReplayInput(in); err != nil {
		return "", err
	}
	exists, err := s.MatchKeyExists(key.String())
	if err != nil {
		return "", err
	}
	if exists {
		return key.String(), nil
	}
	// The player may already hold this replay under their OWN key — they
	// screenshotted the match and annotated it with the code. That match is
	// the one the review is about, so yield to it: creating a second would
	// collide with the unique index, and would be wrong even if it did not.
	if owner, err := matchCarryingCode(s, key.ReplayCode()); err != nil {
		return "", err
	} else if owner != "" {
		return owner, nil
	}
	if err := s.UpsertUserMatchData(replayUserData(key.String(), in)); err != nil {
		return "", err
	}
	if err := SetAnnotation(s, AnnotationInput{
		MatchKey: key.String(), ReplayCode: key.ReplayCode(),
	}); err != nil {
		return "", err
	}
	return key.String(), nil
}

// matchCarryingCode finds the match already annotated with this code, if any.
func matchCarryingCode(s db.Store, code string) (string, error) {
	annotations, err := s.LoadAnnotations()
	if err != nil {
		return "", fmt.Errorf("load annotations: %w", err)
	}
	for key, a := range annotations {
		if a.ReplayCode == code {
			return key, nil
		}
	}
	return "", nil
}

// validateReplayInput holds each supplied field to the vocabulary the rest
// of the app answers to. Only omission is free — the same doctrine the
// manual form states, and the reason a coach's observed context is checked
// on THEIR side too: a context that passes there passes here.
func validateReplayInput(in match.ReplayMatchInput) error {
	if in.Map != "" && !parser.IsKnownMap(in.Map) {
		return fmt.Errorf("%w: %s", ErrUnknownMap, in.Map)
	}
	if in.Hero != "" && !parser.IsKnownHero(in.Hero) {
		return fmt.Errorf("%w: %s", ErrUnknownHero, in.Hero)
	}
	if in.Result != "" && !validResults[in.Result] {
		return ErrInvalidResult
	}
	return nil
}

// replayUserData projects what the coach observed onto the override row.
// Absent fields stay NULL, which is what "not overridden" means everywhere
// else in this layer — an empty string would claim the coach saw a match
// with no map.
func replayUserData(key string, in match.ReplayMatchInput) db.UserMatchData {
	return db.UserMatchData{
		MatchKey:   key,
		Map:        observed(in.Map),
		Hero:       observed(in.Hero),
		Result:     observed(in.Result),
		Date:       observed(in.Date),
		FinishedAt: observed(in.FinishedAt),
	}
}

// observed returns nil for a field the coach left blank, so it stays NULL.
func observed(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
