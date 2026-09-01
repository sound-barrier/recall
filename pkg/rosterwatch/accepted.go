package rosterwatch

import (
	"bufio"
	"fmt"
	"io"
	"slices"
	"strings"
)

// The accepted-differences file: differences the maintainer has looked at and
// decided are correct as they stand.
//
// It exists because the alternative is a watch that reports the same thing
// every Thursday forever. scripts/ci/check-deps.sh records what that costs, in
// its own words: a gate that can never go green "is how a gate teaches people
// to ignore it."
//
// Format is deadcode-allow.txt's: one key per line, '#' starts a comment,
// blanks ignored. A key is "<kind>:<name>" — the same string Finding.Key()
// produces, so an entry either matches a real finding or is flagged as stale.

// acceptedKinds are the finding kinds an entry may name. Checked on parse
// because a typo'd kind can never match anything, and an exemption that can
// never match is worse than no exemption: it reads as handled.
var acceptedKinds = []string{
	KindHeroMissing, KindHeroSpelling, KindMapMissing,
	KindPatchMissing, KindSeasonExpired, KindChannelStale,
}

// ParseAccepted reads the accepted-differences file.
func ParseAccepted(r io.Reader) (Accepted, error) {
	out := Accepted{}
	sc := bufio.NewScanner(r)
	for line := 1; sc.Scan(); line++ {
		raw := sc.Text()
		key, reason := splitComment(raw)
		if key == "" {
			continue
		}
		kind, _, ok := strings.Cut(key, ":")
		if !ok {
			return nil, fmt.Errorf("roster-watch accepted list, line %d: %q has no '<kind>:' prefix", line, key)
		}
		if !slices.Contains(acceptedKinds, kind) {
			return nil, fmt.Errorf("roster-watch accepted list, line %d: %q is not a finding kind (%s)",
				line, kind, strings.Join(acceptedKinds, ", "))
		}
		out[key] = reason
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("roster-watch accepted list: %w", err)
	}
	return out, nil
}

// splitComment separates the key from a trailing reason. Split on '#' rather
// than on whitespace: a key carries a display name, and display names have
// spaces in them ("Practice Range", "King's Row").
func splitComment(line string) (key, reason string) {
	body, comment, _ := strings.Cut(line, "#")
	return strings.TrimSpace(body), strings.TrimSpace(comment)
}
