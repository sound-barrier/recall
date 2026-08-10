package parser_test

import (
	"strings"
	"testing"

	"recall/pkg/parser"
)

// candidateNameFromOCR is the `*_raw` fallback: when no matcher recognizes
// the text, this is what the leaf-row chip shows in parentheses ("Unknown
// hero (miyazaki?)"), and it is the only signal telling the maintainer a
// hero is missing from heroes.yaml. If it returns noise the chip is
// useless; if it returns "" a genuinely new hero leaves no trace at all.
func TestCandidateNameFromOCR(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"a name flanked by percent and play time", "62%\nMiyazaki\n4:31", "miyazaki"},
		{"the longest plausible run wins", "Mei\nStarwatch Colony", "starwatch colony"},
		{"dots belong to names, so D.Va survives intact", "D.Va 62%", "d.va"},
		{"digits and punctuation alone are not a name", "62% 4:31", ""},
		{"a two-character run is below the plausible floor", "Ab\n12%", ""},
		{"surrounding whitespace is trimmed", "  Lucio  ", "lucio"},
		{"nothing at all", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parser.CandidateNameFromOCR(c.in); got != c.want {
				t.Errorf("CandidateNameFromOCR(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

// The 40-character ceiling is what stops a whole OCR'd paragraph from being
// stored as a "hero name" and rendered into the Unknown chip. Every OW hero
// and map name fits well inside it.
func TestCandidateNameFromOCR_CapsRunawayRuns(t *testing.T) {
	got := parser.CandidateNameFromOCR(strings.Repeat("x", 200))
	if len(got) != 40 {
		t.Errorf("candidate length = %d (%q), want the 40-character cap", len(got), got)
	}
}

// FirstKnownHeroIn is the boot re-aggregator's entry point: it re-runs the
// matcher over stored raw OCR against the CURRENT roster, promoting rows
// that a heroes.yaml release has since made recognizable.
func TestFirstKnownHeroIn(t *testing.T) {
	cases := []struct {
		name, raw, want string
	}{
		{"clean read", "LUCIO", "lucio"},
		{"single-letter OCR slip recovered", "JUMKRAT", "junkrat"},
		{"double slip on a long name recovered", "BRIGITIE", "brigitte"},
		{"diacritics are normalized away", "Lúcio", "lucio"},
		{"a colon in the roster name is normalized away", "Soldier: 76", "soldier 76"},
		{"nothing stored", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parser.FirstKnownHeroIn(c.raw); got != c.want {
				t.Errorf("FirstKnownHeroIn(%q) = %q, want %q", c.raw, got, c.want)
			}
		})
	}
}

// A hero the roster has never heard of must stay UNRESOLVED. The fuzzy pass
// once accepted a 3-character sliding window, so "miyazaki" snapped to "mei"
// (or "ana") one edit away and the play was silently filed under a hero the
// user never picked — worse than an Unknown chip, because nothing surfaces
// it. Re-admitting short heroes to the fuzzy pass reproduces the bug.
func TestFirstKnownHeroIn_UnknownHeroDoesNotSnapToALookalike(t *testing.T) {
	for _, raw := range []string{"miyazaki", "Zzz", "not a hero at all"} {
		t.Run(raw, func(t *testing.T) {
			if got := parser.FirstKnownHeroIn(raw); got != "" {
				t.Errorf("FirstKnownHeroIn(%q) = %q, want \"\" — an unknown hero must not be attributed to a lookalike", raw, got)
			}
		})
	}
}
