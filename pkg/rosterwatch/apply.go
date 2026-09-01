package rosterwatch

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
)

// The proposed edit.
//
// heroes.yaml and maps.yaml are both "key: list of display names", so one
// writer serves both. It edits the TEXT rather than round-tripping through
// yaml.Marshal: the files carry comments — including the caveat this writer
// adds — and a marshal would drop every one of them.
//
// What lands is an entry marked unconfirmed, in the form heroes.yaml already
// uses for the last hero added by hand:
//
//	# Season 4 (2026-08-11). Spelling and role transcribed from Blizzard's own
//	# hero page — capital M — NOT from parser output, and NOT yet checked against
//	# a real scoreboard, so the in-game rendering OCR will see is unconfirmed.
//
// The distinction that comment draws is the one that matters. A name from
// Blizzard is a good candidate; a name OCR has actually rendered is the truth.
// Only a human closes that gap, which is why this writes a draft and not a
// merge.

// ApplyHero appends a hero under its role key.
func ApplyHero(doc []byte, h Hero, season string) ([]byte, error) {
	if h.Role == "" {
		return nil, fmt.Errorf("rosterwatch: refusing to write hero %q with no role — "+
			"upstream did not say which key it files under, and guessing puts it behind the wrong filter", h.Name)
	}
	return appendEntry(doc, h.Role, h.Name, heroCaveat(season))
}

// ApplyMap appends a map under its game mode.
func ApplyMap(doc []byte, m Map, season string) ([]byte, error) {
	if m.GameMode == "" {
		return nil, fmt.Errorf("rosterwatch: refusing to write map %q with no game mode", m.Name)
	}
	return appendEntry(doc, m.GameMode, m.Name, mapCaveat(season))
}

func heroCaveat(season string) []string {
	return []string{
		season + ". Spelling and role transcribed by roster-watch from",
		"Blizzard's own hero page — NOT from parser output, and",
		"NOT yet checked against a real scoreboard, so the in-game",
		"rendering OCR will see is unconfirmed. The first match parsed",
		"on this hero is the check.",
	}
}

func mapCaveat(season string) []string {
	return []string{
		season + ". Name and game mode read by roster-watch from the",
		"upstream map list — NOT from parser output, and",
		"NOT yet checked against a real scoreboard. See the Neon Junction",
		"entry for what a garbled name made canonical costs.",
	}
}

// ParseGroups decodes a "key: []name" roster file. Exported so the caller —
// and the tests — can read a written file back as structure rather than text.
func ParseGroups(doc []byte) (map[string][]string, error) {
	var groups map[string][]string
	if err := yaml.Unmarshal(doc, &groups); err != nil {
		return nil, fmt.Errorf("rosterwatch: parse roster file: %w", err)
	}
	return groups, nil
}

// appendEntry inserts `name` at the end of `key`'s block, preceded by the
// caveat comment. When the key is absent it is appended as a new block.
//
// Entries land at the end of their block rather than in sorted position on
// purpose: a new name is the one a reader wants to find, and the loader sorts
// for display anyway (heroesByRole is sorted at load).
func appendEntry(doc []byte, key, name string, caveat []string) ([]byte, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("rosterwatch: refusing to write an empty name")
	}
	groups, err := ParseGroups(doc)
	if err != nil {
		return nil, err
	}
	if slices.Contains(groups[key], name) {
		return doc, nil // already there; writing twice is not an edit
	}

	block := make([]string, 0, len(caveat)+1)
	for _, line := range caveat {
		block = append(block, "  # "+line)
	}
	block = append(block, "  - "+quoteIfNeeded(name))

	lines := strings.Split(strings.TrimRight(string(doc), "\n"), "\n")
	insertAt, found := endOfBlock(lines, key)
	if !found {
		fresh := make([]string, 0, len(lines)+len(block)+1)
		fresh = append(fresh, lines...)
		fresh = append(fresh, key+":")
		fresh = append(fresh, block...)
		return []byte(strings.Join(fresh, "\n") + "\n"), nil
	}
	out := make([]string, 0, len(lines)+len(block))
	out = append(out, lines[:insertAt]...)
	out = append(out, block...)
	out = append(out, lines[insertAt:]...)
	return []byte(strings.Join(out, "\n") + "\n"), nil
}

// endOfBlock finds the line index just past the last entry under `key`.
func endOfBlock(lines []string, key string) (int, bool) {
	start := -1
	for i, l := range lines {
		if strings.HasPrefix(l, key+":") {
			start = i
			break
		}
	}
	if start < 0 {
		return 0, false
	}
	end := len(lines)
	for i := start + 1; i < len(lines); i++ {
		l := lines[i]
		// A non-indented, non-blank line starts the next block.
		if strings.TrimSpace(l) != "" && !strings.HasPrefix(l, " ") {
			end = i
			break
		}
	}
	// Walk back over trailing blanks so the entry joins the list rather than
	// floating after it.
	for end > start+1 && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	return end, true
}

// quoteIfNeeded quotes a name YAML would otherwise mis-read — the colon in
// "Soldier: 76" is the case that actually occurs.
func quoteIfNeeded(name string) string {
	if strings.ContainsAny(name, `:#{}[],&*?|<>=!%@\"'`) || strings.TrimSpace(name) != name {
		return `"` + strings.ReplaceAll(name, `"`, `\"`) + `"`
	}
	return name
}
