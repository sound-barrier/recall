package rosterwatch_test

import (
	"strings"
	"testing"

	"recall/pkg/rosterwatch"
)

// The accepted list is what lets the watch reach green, and a format nobody can
// read is a format nobody maintains. Same shape as scripts/ci/deadcode-allow.txt:
// one key per line, '#' comments, blank lines ignored.

func TestParseAccepted_ReadsKeysAndTheirReasons(t *testing.T) {
	got, err := rosterwatch.ParseAccepted(strings.NewReader(`
# The scoreboard renders it with a lowercase v; Blizzard's hero page uses
# a capital V. The scoreboard is what OCR reads, so the roster keeps its own.
hero-spelling:D.Va

# a blank line and a trailing comment below
map-missing:Practice Range  # not a real competitive map
`))
	if err != nil {
		t.Fatalf("ParseAccepted: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("entries = %v, want 2", got)
	}
	if _, ok := got["hero-spelling:D.Va"]; !ok {
		t.Errorf("entries = %v, want the D.Va key", got)
	}
	// A key whose value carries a name with a space must survive whole — map
	// names have spaces, and a split on whitespace would truncate them.
	if _, ok := got["map-missing:Practice Range"]; !ok {
		t.Errorf("entries = %v, want the full map name as the key", got)
	}
}

func TestParseAccepted_RefusesALineWithNoKind(t *testing.T) {
	// Without a kind the key can never match a finding, so the entry would sit
	// there forever looking like it did something.
	_, err := rosterwatch.ParseAccepted(strings.NewReader("D.Va\n"))
	if err == nil {
		t.Fatal("ParseAccepted accepted a line with no '<kind>:' prefix")
	}
}

func TestParseAccepted_RefusesAKindItDoesNotHave(t *testing.T) {
	_, err := rosterwatch.ParseAccepted(strings.NewReader("hero-spelt-wrong:D.Va\n"))
	if err == nil {
		t.Fatal("ParseAccepted accepted an unknown finding kind — a typo would silently never match")
	}
}
