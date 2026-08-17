package matchedit

import (
	"errors"

	"recall/pkg/db"
)

// validPlayModes enumerates the two play-mode states a match can be
// classified as:
//   - "quickplay"   — casual game (any rank rules off)
//   - "competitive" — ranked game (SR + rank progress applies)
//
// The empty string is the third logical state ("not set, fall back to
// what the parser captured") and goes through ClearPlayMode, not
// SetPlayMode.
var validPlayModes = map[string]bool{"quickplay": true, "competitive": true}

// ErrInvalidPlayMode is returned by SetPlayMode when the play_mode
// value isn't 'quickplay' or 'competitive'. HTTP handlers map this to
// 400 — user-input error, not a server fault.
var ErrInvalidPlayMode = errors.New("invalid play_mode: must be 'quickplay' or 'competitive'")

// IsValidPlayMode reports whether playMode is one of the two stored
// values. Exported for the manual-match form, where the field is
// optional and only a SUPPLIED value has to be valid.
func IsValidPlayMode(playMode string) bool { return validPlayModes[playMode] }

// SetPlayMode overrides the parser's play-mode read for a specific
// match. The aggregator prefers this value over the parsed data.mode
// when set. Idempotent — repeated identical calls succeed; calling
// with a different value overwrites.
//
// Use ClearPlayMode to revert to "follow the parser."
func SetPlayMode(s db.Store, matchKey, playMode string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	if !validPlayModes[playMode] {
		return ErrInvalidPlayMode
	}
	if err := AssertMatchExists(s, matchKey); err != nil {
		return err
	}
	return s.SetMatchPlayMode(matchKey, playMode)
}

// ClearPlayMode removes the override row, reverting to "fall back to
// the parser." Idempotent — clearing a match with no override is a
// no-op.
func ClearPlayMode(s db.Store, matchKey string) error {
	if matchKey == "" {
		return ErrMatchKeyRequired
	}
	return s.ClearMatchPlayMode(matchKey)
}

// BulkSetPlayMode applies the same play_mode to every key in the slice
// in one transaction. playMode="" clears the rows (bulk clear).
// Validates the value before reaching SQL so an invalid input never
// starts a partial-write.
func BulkSetPlayMode(s db.Store, matchKeys []string, playMode string) error {
	if playMode != "" && !validPlayModes[playMode] {
		return ErrInvalidPlayMode
	}
	// Only the set direction creates rows — see BulkSetQueue.
	if playMode != "" {
		if err := assertMatchesExist(s, matchKeys); err != nil {
			return err
		}
	}
	return s.BulkSetMatchPlayMode(matchKeys, playMode)
}
