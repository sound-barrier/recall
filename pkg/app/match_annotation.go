package app

import (
	"errors"
	"strings"

	"recall/pkg/db"
)

// validDisruptionSides enumerates who a leaver / thrower annotation can name:
//   - "self"  — the user themselves (their own data is partial, or they threw)
//   - "team"  — an ally
//   - "enemy" — an opposing-team player
//
// Both kinds are SETS: a match can carry a thrower on either team (or both),
// and the leaver-exit quick-add records "a teammate left, then I left" as two
// leaver sides on one match. An empty set means "not tagged"; an annotation row
// can exist without either as long as note / replay_code / members / tags
// carries something.
var validDisruptionSides = map[string]bool{"self": true, "team": true, "enemy": true}

// ErrInvalidLeaver is returned by SetMatchAnnotation when a leaver side isn't
// one of the three allowed values. HTTP handlers map this to 400 (user-input
// error) rather than 500.
var ErrInvalidLeaver = errors.New("invalid leaver: each side must be 'self', 'team', or 'enemy'")

// ErrInvalidThrower is the thrower-side twin of ErrInvalidLeaver. Separate
// sentinels so the 400's message names the field the user actually got wrong.
var ErrInvalidThrower = errors.New("invalid thrower: each side must be 'self', 'team', or 'enemy'")

// ErrEmptyAnnotation is returned by SetMatchAnnotation when the input carries no
// content after trimming. PUT /annotation is upsert-only; clearing an annotation
// is the explicit DeleteMatchAnnotation (DELETE) so the verb states the intent
// rather than an all-empty PUT meaning "delete." HTTP handlers map this to 400.
var ErrEmptyAnnotation = errors.New("annotation has no content; use DELETE to clear it")

// AnnotationInput is the App-layer DTO for SetMatchAnnotation. Each
// field is optional, but at least one must carry content: an all-empty
// input is rejected with ErrEmptyAnnotation (clearing is DeleteMatchAnnotation).
type AnnotationInput struct {
	MatchKey string
	// Leavers / Throwers are sets of validDisruptionSides values. Order is not
	// significant; duplicates are collapsed before reaching SQL.
	Leavers    []string
	Throwers   []string
	Note       string
	ReplayCode string
	Members    []string
	// Free-form user tags. `stack`, `stream`, `placement` are the
	// conventional three (quick-add toggles in the inline editor);
	// the user can add anything. Normalized via normalizeTags before
	// reaching the store (lowercased + trimmed + deduped).
	Tags []string
}

// SetMatchAnnotation upserts a per-match annotation. It is upsert-only: an
// all-empty input is rejected with ErrEmptyAnnotation rather than silently
// deleting, so the API verb states intent (clearing is DeleteMatchAnnotation).
// Keeping content-free rows out of the table still keeps the FilterRail
// "leaver / note count" gates accurate.
//
// Validation:
//   - match_key required.
//   - every leaver / thrower side must be in {self, team, enemy}; each set is
//     trimmed + deduped.
//   - members are trimmed + deduped + dropped-if-empty before reaching
//     SQL; the composite-PK on the child table also guards duplicates.
//   - tags are lowercased + trimmed + deduped (case-insensitive
//     equivalence — `Stack` and `stack` collapse to one).
//   - replay_code is left as-is — Overwatch's format isn't pinned
//     strongly enough to validate client-side.
func (a *App) SetMatchAnnotation(in AnnotationInput) error {
	if in.MatchKey == "" {
		return errors.New("match_key required")
	}
	leavers, err := normalizeSides(in.Leavers, ErrInvalidLeaver)
	if err != nil {
		return err
	}
	throwers, err := normalizeSides(in.Throwers, ErrInvalidThrower)
	if err != nil {
		return err
	}
	note := strings.TrimSpace(in.Note)
	replay := strings.TrimSpace(in.ReplayCode)
	members := normalizeMembers(in.Members)
	tags := normalizeTags(in.Tags)

	// All-empty input is rejected — clearing an annotation is the explicit
	// DeleteMatchAnnotation, not an all-empty upsert.
	if len(leavers) == 0 && len(throwers) == 0 && note == "" && replay == "" && len(members) == 0 && len(tags) == 0 {
		return ErrEmptyAnnotation
	}
	return a.store.SetAnnotation(db.Annotation{
		MatchKey:   in.MatchKey,
		Leavers:    leavers,
		Throwers:   throwers,
		Note:       note,
		ReplayCode: replay,
		Members:    members,
		Tags:       tags,
	})
}

// normalizeSides trims, drops empties, dedupes, and validates every side
// against validDisruptionSides, returning invalidErr for the first bad value.
// Empty input yields a nil set, which callers read as "not tagged".
func normalizeSides(in []string, invalidErr error) ([]string, error) {
	if len(in) == 0 {
		return nil, nil
	}
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		if !validDisruptionSides[s] {
			return nil, invalidErr
		}
		seen[s] = true
		out = append(out, s)
	}
	return out, nil
}

// DeleteMatchAnnotation removes a match's annotation row entirely (members and
// tags cascade away with it). Idempotent — deleting a match that has no
// annotation is a no-op, so a stale UI firing twice is safe.
func (a *App) DeleteMatchAnnotation(matchKey string) error {
	if matchKey == "" {
		return errors.New("match_key required")
	}
	return a.store.DeleteAnnotation(matchKey)
}

// normalizeMembers trims whitespace, drops empties, and dedupes
// case-preserving. Members are stored verbatim (`Apollo#11234` and
// `apollo#11234` would be distinct rows), so we don't lowercase.
func normalizeMembers(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, m := range in {
		m = strings.TrimSpace(m)
		if m == "" || seen[m] {
			continue
		}
		seen[m] = true
		out = append(out, m)
	}
	return out
}

// normalizeTags trims, lowercases, drops empties, and dedupes. Tags
// are user-facing labels with no significant case (`Stack` and
// `stack` should collapse into one), unlike Members where case can
// be load-bearing.
func normalizeTags(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}
