package app

import (
	"errors"
	"fmt"
	"strings"

	"recall/pkg/db"
)

// validLeavers enumerates the three scenarios users can annotate a
// match with:
//   - "self"  — the user themselves left the match (data is partial)
//   - "team"  — an ally left the match
//   - "enemy" — an opposing-team player left the match
//
// The empty string means "no leaver tag set"; an annotation row can
// exist without a leaver as long as at least one of note /
// replay_code / members is populated.
var validLeavers = map[string]bool{"self": true, "team": true, "enemy": true}

// ErrInvalidLeaver is returned by SetMatchAnnotation when the leaver
// value isn't one of the three allowed scenarios (or empty for "no
// tag"). HTTP handlers map this to 400 (user-input error) rather than
// 500.
var ErrInvalidLeaver = errors.New("invalid leaver: must be 'self', 'team', or 'enemy'")

// AnnotationInput is the App-layer DTO for SetMatchAnnotation. Each
// field is optional; if every field is empty after trimming, the
// annotation row is deleted entirely (cascading members + tags away).
type AnnotationInput struct {
	MatchKey   string
	Leaver     string
	Note       string
	ReplayCode string
	Members    []string
	// Free-form user tags. `stack`, `stream`, `placement` are the
	// conventional three (quick-add toggles in the inline editor);
	// the user can add anything. Normalized via normalizeTags before
	// reaching the store (lowercased + trimmed + deduped).
	Tags []string
}

// SetMatchAnnotation upserts (or deletes) a per-match annotation. The
// "delete on empty" policy keeps the annotation table small and the
// FilterRail "leaver / note count" gates accurate — a row that
// carries no user content shouldn't pretend to exist.
//
// Validation:
//   - match_key required.
//   - leaver, when non-empty, must be in {self, team, enemy}.
//   - members are trimmed + deduped + dropped-if-empty before reaching
//     SQL; the composite-PK on the child table also guards duplicates.
//   - tags are lowercased + trimmed + deduped (case-insensitive
//     equivalence — `Stack` and `stack` collapse to one).
//   - replay_code is left as-is — Overwatch's format isn't pinned
//     strongly enough to validate client-side.
func (a *App) SetMatchAnnotation(in AnnotationInput) error {
	if in.MatchKey == "" {
		return fmt.Errorf("match_key required")
	}
	leaver := strings.TrimSpace(in.Leaver)
	if leaver != "" && !validLeavers[leaver] {
		return ErrInvalidLeaver
	}
	note := strings.TrimSpace(in.Note)
	replay := strings.TrimSpace(in.ReplayCode)
	members := normalizeMembers(in.Members)
	tags := normalizeTags(in.Tags)

	// All-empty input → delete the row entirely. Idempotent — deleting
	// a non-existent row is a no-op.
	if leaver == "" && note == "" && replay == "" && len(members) == 0 && len(tags) == 0 {
		return a.store.DeleteAnnotation(in.MatchKey)
	}
	return a.store.SetAnnotation(db.Annotation{
		MatchKey:   in.MatchKey,
		Leaver:     leaver,
		Note:       note,
		ReplayCode: replay,
		Members:    members,
		Tags:       tags,
	})
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
