package app

import (
	"errors"
	"fmt"
)

// validPlayModes enumerates the two play-mode states a match can be
// classified as:
//   - "quickplay"   — casual game (any rank rules off)
//   - "competitive" — ranked game (SR + rank progress applies)
//
// The empty string is the third logical state ("not set, fall back to
// what the parser captured") and goes through ClearMatchPlayMode, not
// SetMatchPlayMode.
var validPlayModes = map[string]bool{"quickplay": true, "competitive": true}

// ErrInvalidPlayMode is returned by SetMatchPlayMode when the
// play_mode value isn't 'quickplay' or 'competitive'. HTTP handlers
// map this to 400 — user-input error, not a server fault.
var ErrInvalidPlayMode = errors.New("invalid play_mode: must be 'quickplay' or 'competitive'")

// SetMatchPlayMode overrides the parser's play-mode read for a
// specific match. The aggregator prefers this value over the parsed
// data.mode when set. Idempotent — repeated identical calls succeed;
// calling with a different value overwrites.
//
// Use ClearMatchPlayMode to revert to "follow the parser."
func (a *App) SetMatchPlayMode(matchKey, playMode string) error {
	if matchKey == "" {
		return fmt.Errorf("match_key required")
	}
	if !validPlayModes[playMode] {
		return ErrInvalidPlayMode
	}
	return a.store.SetMatchPlayMode(matchKey, playMode)
}

// ClearMatchPlayMode removes the override row, reverting to "fall
// back to the parser." Idempotent — clearing a match with no
// override is a no-op.
func (a *App) ClearMatchPlayMode(matchKey string) error {
	if matchKey == "" {
		return fmt.Errorf("match_key required")
	}
	return a.store.ClearMatchPlayMode(matchKey)
}
