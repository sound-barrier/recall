package matchedit

import (
	"errors"

	"recall/pkg/parser"
)

// The value rules the override layer (userdata.go) and the manual form
// (manual.go) share. Both surfaces echo what they are handed straight back
// into a MatchResult response, so a value outside these bounds would emit a
// record that violates the schema api/openapi.yaml promises.

// validResults enumerates the three match outcomes. The empty string is not a
// valid override — omit the field to leave the OCR result untouched.
var validResults = map[string]bool{"victory": true, "defeat": true, "draw": true}

// Numeric bounds mirrored from the request / MatchResult schemas in
// api/openapi.yaml. The override layer echoes overrides straight into the
// response, so anything outside these would emit a schema-violating record.
const (
	statMin, statMax     = 0, 1_000_000          // E/A/D, damage, healing, mitigation, hero-stat value, SR
	levelMin, levelMax   = 0, 5                  // level (rank division)
	pctMin, pctMax       = 0, 100                // rank_progress, percent_played
	changeMin, changeMax = -1_000_000, 1_000_000 // change_percent, SR change
)

var (
	// ErrInvalidResult maps to 400 — result must be victory / defeat / draw.
	ErrInvalidResult = errors.New("invalid result: must be 'victory', 'defeat', or 'draw'")
	// ErrUnknownMap maps to 409 — the map isn't in the Overwatch roster. 409
	// (not 400) because the value is spec-valid free-text the server can't accept.
	ErrUnknownMap = errors.New("unknown map: not in the Overwatch roster")
	// ErrUnknownHero maps to 409 — the hero isn't in the Overwatch roster.
	ErrUnknownHero = errors.New("unknown hero: not in the Overwatch roster")
)

func inRange(v, lo, hi int) bool         { return v >= lo && v <= hi }
func ptrInRange(p *int, lo, hi int) bool { return p == nil || inRange(*p, lo, hi) }

// validateKnownHeroes rejects any non-empty hero name outside the roster.
func validateKnownHeroes(heroes []string) error {
	for _, h := range heroes {
		if h != "" && !parser.IsKnownHero(h) {
			return ErrUnknownHero
		}
	}
	return nil
}
