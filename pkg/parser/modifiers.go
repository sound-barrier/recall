package parser

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
)

// modifiers.yaml is the single source for the rank-update modifier vocabulary.
// Like ranks.yaml, ORDER is meaning here: extractModifiers appends on the first
// substring hit, so the file's order is the order that lands in a golden.
// Embedded + user-override loaded via owdata.go::Reload; accessors Modifiers()
// and StorableModifiers(). Adding a modifier is a YAML edit — no Go changes.

type modifiersYAML struct {
	Modifiers          []string `yaml:"modifiers"`
	DetectedSeparately []string `yaml:"detected_separately"`
	NotModifiers       []string `yaml:"not_modifiers"`
}

// unmarshalModifiers decodes modifiers.yaml into the dataset. It rejects an
// empty list, blank entries, and duplicates ACROSS BOTH lists — a value in both
// would be matched as a substring and appended out-of-band, landing twice in
// one screenshot's modifier set and tripping the composite primary key on
// rank_modifiers.
func unmarshalModifiers(ds *owDataset, b []byte) error {
	var doc modifiersYAML
	if err := yaml.Unmarshal(b, &doc); err != nil {
		return fmt.Errorf("modifiers.yaml: %w", err)
	}
	if len(doc.Modifiers) == 0 {
		return errors.New("modifiers.yaml: no modifiers defined")
	}
	seen := make(map[string]bool, len(doc.Modifiers)+len(doc.DetectedSeparately))
	matched := make([]string, 0, len(doc.Modifiers))
	for i, m := range doc.Modifiers {
		if err := checkEntry("modifier", i, m); err != nil {
			return err
		}
		if seen[m] {
			return fmt.Errorf("modifiers.yaml: duplicate modifier %q", m)
		}
		seen[m] = true
		matched = append(matched, m)
	}
	storable := slices.Clone(matched)
	for i, m := range doc.DetectedSeparately {
		if err := checkEntry("detected_separately", i, m); err != nil {
			return err
		}
		if seen[m] {
			return fmt.Errorf("modifiers.yaml: %q is in both modifiers and detected_separately", m)
		}
		seen[m] = true
		storable = append(storable, m)
	}
	for i, m := range doc.NotModifiers {
		if err := checkEntry("not_modifiers", i, m); err != nil {
			return err
		}
		if seen[m] {
			return fmt.Errorf("modifiers.yaml: %q is both a modifier and a non-modifier", m)
		}
	}
	ds.modifiers = matched
	ds.storableModifiers = storable
	ds.notModifiers = slices.Clone(doc.NotModifiers)
	return nil
}

// checkEntry rejects an entry that could never match. Matching lowercases the
// OCR blob and compares against these values verbatim, so a capital or a stray
// space makes a permanently dead vocabulary slot — the silent-drop failure
// this file exists to end.
func checkEntry(field string, i int, m string) error {
	if m == "" {
		return fmt.Errorf("modifiers.yaml: %s %d is empty", field, i)
	}
	if m != strings.ToLower(strings.TrimSpace(m)) {
		return fmt.Errorf("modifiers.yaml: %s %q must be lowercase and unpadded — matching "+
			"is case-sensitive against this value, so it would never match", field, m)
	}
	return nil
}

// Modifiers returns the modifiers matched as substrings of the OCR'd pill row,
// in file order. The order is load-bearing: it is the order extractModifiers
// emits, which the golden corpus pins.
func Modifiers() []string {
	return slices.Clone(loadDataset().modifiers)
}

// StorableModifiers returns every value the parser can put on a MatchResult —
// Modifiers() plus the ones parseRank detects out-of-band (demotion
// protection, whose chip OCRs as a bare stem). This is the set a freshly
// created database's CHECK constraints must accept, which a test asserts.
//
// An upgraded install is a different matter and is handled in the store: its
// CHECK is frozen at whatever shipped when the DB was created, and SQLite
// cannot widen one, so UpsertRank logs and skips a modifier the local schema
// refuses rather than losing the rank row it belongs to.
func StorableModifiers() []string {
	return slices.Clone(loadDataset().storableModifiers)
}

// NotModifiers returns the known non-modifier text that shares the modifier
// row — post-match toasts and other UI that overlaps it. A token matching one
// of these is not "unrecognized": it is recognized, as something that was never
// a modifier.
func NotModifiers() []string {
	return slices.Clone(loadDataset().notModifiers)
}
