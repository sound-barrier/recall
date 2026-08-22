package match

import (
	"errors"
	"strings"
)

// ErrInvalidReplayCode rejects a replay code that is not six ASCII
// alphanumerics.
//
// It lives here, beside the rule it names, because three packages refuse the
// same thing for the same reason — the annotation write, the manual-match
// form, and a coach opening a session from codes. Two sentinels carrying one
// meaning is how a problem+json `detail` starts drifting from the check that
// produced it.
var ErrInvalidReplayCode = errors.New("invalid replay_code: must be six letters or digits")

// replayCodeLen is the length of an Overwatch replay code: six characters,
// drawn from the digits and the unaccented capitals.
const replayCodeLen = 6

// asciiSpace is the cutset NormalizeReplayCode trims.
//
// Deliberately NOT strings.TrimSpace, and the reason is the whole point of
// this file: a replay code is the ONLY token a coach and a player can both
// derive a match key from, and they derive it in different languages. Go's
// unicode.IsSpace and JavaScript's \s do not agree on the same set of code
// points, so a key minted from a pasted non-breaking space would differ
// across the handoff and the note would land nowhere. Spelling the set out
// in ASCII is what makes the two implementations provably identical.
const asciiSpace = " \t\n\r\v\f"

// NormalizeReplayCode canonicalizes a typed replay code and reports whether
// it is one at all. The canonical form is six uppercase ASCII alphanumerics.
//
// Case-folding is ASCII-only for the same reason the trim is: Unicode
// case-folding is language-specific and would let two different typings
// normalize to one code in Go and to two in TypeScript.
//
// An empty input is not a code — callers that treat "no code" as legal
// check for the empty string themselves before asking.
func NormalizeReplayCode(raw string) (string, bool) {
	trimmed := strings.Trim(raw, asciiSpace)
	// Byte length, not rune count: any multi-byte character makes the
	// string the wrong size here and is refused before the loop sees it.
	if len(trimmed) != replayCodeLen {
		return "", false
	}
	out := []byte(trimmed)
	for i, c := range out {
		switch {
		case c >= 'a' && c <= 'z':
			out[i] = c - ('a' - 'A')
		case c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		default:
			return "", false
		}
	}
	return string(out), true
}
