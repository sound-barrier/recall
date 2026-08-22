package coach

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"recall/pkg/match"
	"recall/pkg/parser"
)

// ErrNoReplayCodes rejects opening a session with nothing to review.
var ErrNoReplayCodes = errors.New("a replay session needs at least one replay code")

// ErrNotAReplaySession rejects growing a corpus that was loaned rather than
// typed. A bundle session's matches are the player's; the coach does not get
// to add to them.
var ErrNotAReplaySession = errors.New("this session's matches came from a bundle and cannot be added to")

// ErrMatchNotInThisSession rejects describing a match the session does not hold.
var ErrMatchNotInThisSession = errors.New("that match is not in this session")

// ErrObservedContextInvalid rejects a context field the player's side would
// refuse on import.
var ErrObservedContextInvalid = errors.New("invalid match context")

// ObservedContext is what the coach saw while watching a replay: as much or
// as little of the match card as they cared to record.
//
// Every field is optional. A coach who noticed the map and nothing else
// should be able to say so — inventing a hero to satisfy a form would be
// fabricating data, which is the same rule the manual-match path states as
// "only omission is free". But a value that IS supplied has to be one the
// player's import will accept, or the coach fills in a form and the handoff
// fails on the far side, where they cannot see it.
type ObservedContext struct {
	Map        string `json:"map"`
	Hero       string `json:"hero"`
	Result     string `json:"result"`
	Date       string `json:"date"`
	FinishedAt string `json:"finished_at"`
}

// OpenReplaySession builds a session from replay codes alone.
//
// This is the session with no bundle behind it: no screenshots, no parsed
// data, no player identity in the payload. Each code becomes one empty frame
// whose key is minted from the code, which is the only identity a coach and a
// player can both arrive at without exchanging a file.
//
// The session carries no player. That is deliberate rather than an omission:
// the room already knows how to ask a coach who they are coaching, because a
// plain bundle export carries no handle either, and ErrHandleRequired already
// keeps the first note out until they answer. One prompt, not two.
func OpenReplaySession(codes []string, now time.Time) (*Session, error) {
	canonical, err := canonicalReplayCodes(codes)
	if err != nil {
		return nil, err
	}
	if len(canonical) == 0 {
		return nil, ErrNoReplayCodes
	}
	s := &Session{
		OpenedAt: now.UTC().Format(time.RFC3339),
		Source:   SessionFromReplay,
	}
	recs := make([]match.Record, 0, len(canonical))
	for _, code := range canonical {
		recs = append(recs, replayRecord(code))
	}
	s.setRecords(recs)
	return s, nil
}

// canonicalReplayCodes normalizes, drops blanks and dedupes while keeping the
// order the coach typed. A blank is not an error — a textarea with a trailing
// newline is not a mistake worth refusing — but a malformed code is, because
// silently dropping it would leave the coach reviewing a replay they never
// asked for and wondering where the other one went.
func canonicalReplayCodes(codes []string) ([]string, error) {
	seen := map[string]bool{}
	out := make([]string, 0, len(codes))
	for _, raw := range codes {
		if strings.Trim(raw, " \t\n\r\v\f") == "" {
			continue
		}
		code, ok := match.NormalizeReplayCode(raw)
		if !ok {
			return nil, fmt.Errorf("%w: %q", match.ErrInvalidReplayCode, raw)
		}
		if seen[code] {
			continue
		}
		seen[code] = true
		out = append(out, code)
	}
	return out, nil
}

// replayRecord is one empty frame: a key, a code, and nothing else until the
// coach describes what they saw.
func replayRecord(code string) match.Record {
	key, _ := match.NewReplayMatchKey(code)
	return match.Record{
		MatchKey:    key.String(),
		Source:      match.SourceReplay,
		SourceFiles: []string{},
		Annotation:  &match.Annotation{ReplayCode: code, Leavers: []string{}, Throwers: []string{}},
	}
}

// AddReplayCode grows the reel mid-session, because codes arrive one at a
// time over voice chat. Re-adding one already in the reel is a no-op.
func (s *Session) AddReplayCode(code string) error {
	if s.Source != SessionFromReplay {
		return ErrNotAReplaySession
	}
	canonical, ok := match.NormalizeReplayCode(code)
	if !ok {
		return fmt.Errorf("%w: %q", match.ErrInvalidReplayCode, code)
	}
	key, _ := match.NewReplayMatchKey(canonical)
	if s.HasMatch(key.String()) {
		return nil
	}
	s.setRecords(append(s.records, replayRecord(canonical)))
	return nil
}

// SetObservedContext records what the coach saw for one match.
//
// Mutates the in-memory record and nothing else. The "records never reach a
// store" rule is untouched: this corpus is discarded with the session, and
// the context travels to the player inside the notes archive rather than by
// being persisted here.
func (s *Session) SetObservedContext(key string, ctx ObservedContext) error {
	i, ok := s.indexByKey[key]
	if !ok {
		return fmt.Errorf("%w: %q", ErrMatchNotInThisSession, key)
	}
	if err := ValidateObservedContext(ctx); err != nil {
		return err
	}
	d := &s.records[i].Data
	d.Map, d.Hero, d.Result = ctx.Map, ctx.Hero, ctx.Result
	d.Date, d.FinishedAt = ctx.Date, ctx.FinishedAt
	return nil
}

// ValidateObservedContext holds each supplied field to the same vocabulary
// the player's own writes answer to.
//
// Delegating to parser.IsKnownMap / IsKnownHero rather than re-listing them
// is the point: a context the coach types has to be one matchedit will
// accept, and two copies of "what counts as a map" drift.
func ValidateObservedContext(ctx ObservedContext) error {
	for _, f := range observedFields(ctx) {
		if f.value == "" || f.valid(f.value) {
			continue
		}
		return fmt.Errorf("%w: %s %q %s", ErrObservedContextInvalid, f.name, f.value, f.expected)
	}
	return nil
}

// observedField is one thing a coach may have written down, paired with what
// counts as a legal value for it.
type observedField struct {
	name     string
	value    string
	valid    func(string) bool
	expected string
}

// observedFields is the table ValidateObservedContext walks. A registry
// rather than five near-identical `if field != "" && !ok` branches: each
// field's rule is one row, the "empty is fine" half of the rule is stated
// once instead of five times, and a sixth thing a coach might observe costs
// a row rather than another branch to keep in step.
func observedFields(ctx ObservedContext) []observedField {
	return []observedField{
		{"map", ctx.Map, parser.IsKnownMap, "is not in the Overwatch roster"},
		{"hero", ctx.Hero, parser.IsKnownHero, "is not in the Overwatch roster"},
		{"result", ctx.Result, func(v string) bool { return validObservedResults[v] },
			"must be victory, defeat, or draw"},
		{"date", ctx.Date, func(v string) bool { return parses(time.DateOnly, v) },
			"is not YYYY-MM-DD"},
		{"finished_at", ctx.FinishedAt, func(v string) bool { return parses(observedClockLayout, v) },
			"is not HH:MM"},
	}
}

// observedClockLayout is the scoreboard's wall-clock shape — the same naive
// local HH:MM the parser reads off a SUMMARY screenshot, not a duration.
const observedClockLayout = "15:04"

// parses reports whether v matches layout exactly. The date and clock rules
// are the ones the notes file and the manual form already state; this keeps
// them stated once here rather than twice inline.
func parses(layout, v string) bool {
	_, err := time.Parse(layout, v)
	return err == nil
}

var validObservedResults = map[string]bool{"victory": true, "defeat": true, "draw": true}
