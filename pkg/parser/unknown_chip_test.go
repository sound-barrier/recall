package parser_test

import (
	"slices"
	"testing"

	"recall/pkg/parser"
)

// The modifier vocabulary is a closed list, so a chip it does not carry is
// dropped without trace — which is exactly how "variance" rode every
// post-placement screen of an entire season unnoticed. unknownChipTokens is
// the tripwire.
//
// Its hard part is not finding new words, it is NOT crying wolf. The band it
// reads catches transient UI and OCR noise as well as chips, and every band
// below is verbatim output from a real capture.
func TestUnknownChipTokens(t *testing.T) {
	known := parser.StorableModifiers()

	// The vocabulary as it stood BEFORE season 4, so the discovery case can be
	// shown against a real capture: this is the signal that would have named
	// "variance" on the day it shipped instead of a season later.
	preSeason4 := slices.DeleteFunc(parser.StorableModifiers(), func(m string) bool { return m == "variance" })

	for _, tc := range []struct {
		name  string
		vocab []string
		band  string
		want  []string
	}{
		{
			name:  "names a chip the vocabulary does not carry",
			vocab: preSeason4,
			band:  "x DEFEAT\n\n€ VARIANCE\n\n€ REVERSAL\n\na |",
			want:  []string{"VARIANCE"},
		},
		{
			name: "silent once the vocabulary carries it",
			band: "> VARIANCE > UPHILL BATTLE v VICTORY",
			want: nil,
		},
		{
			// Icon chrome is most of what this band contains.
			name: "ignores short icon noise",
			band: "~or Ge  > VARIANCE v VICTORY  as | ns | oe",
			want: nil,
		},
		{
			// The band clips at its right edge, so chips arrive truncated.
			// A truncation is a chip we already know, not a discovery.
			name: "a truncated known chip is not a discovery",
			band: "< CONSOLAT || VICTORY",
			want: nil,
		},
		{
			// Matched out-of-band by the DEMOTION stem, so it is known even
			// though it is absent from the substring vocabulary.
			name: "the demotion stem is accounted for",
			band: "< DEMOTION || a || Pe",
			want: nil,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			vocab := tc.vocab
			if vocab == nil {
				vocab = known
			}
			got := parser.UnknownChipTokens(tc.band, vocab)
			if len(got) != len(tc.want) {
				t.Fatalf("tokens = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("tokens[%d] = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// The ENDORSEMENT RECEIVED toast is NOT an unrecognized chip. It overlaps the
// modifier row and the OCR reads it truncated, but it is understood perfectly
// well — it simply was never a modifier — so reporting it as text the parser
// could not explain would be a false statement, and one shown to the user.
// modifiers.yaml's not_modifiers list drops it at the source.
func TestUnknownChipTokens_DropsKnownNonModifierUI(t *testing.T) {
	known := parser.StorableModifiers()
	for _, band := range []string{
		"ENDORSEMENT RECEIVED!",
		// Truncated exactly as the corpus capture reads it.
		"ORSEMENT RECEIVED",
	} {
		if got := parser.UnknownChipTokens(band, known); len(got) != 0 {
			t.Errorf("band %q produced %v; the endorsement toast is known UI, not an "+
				"unexplained chip, and must never reach the user as one", band, got)
		}
	}
}

// What remains after that filter is genuine: OCR garble nobody can account for.
// It still LOGS rather than raising a parse warning — a warning routes to the
// failed-files ledger and would mark an otherwise clean capture unreadable.
func TestUnknownChipTokens_StillReportsGenuineGarble(t *testing.T) {
	if got := parser.UnknownChipTokens("AACTARIT ECWNIK", parser.StorableModifiers()); len(got) == 0 {
		t.Error("garbled band produced no tokens; text the vocabulary genuinely " +
			"cannot explain is the whole signal")
	}
}
