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

// Measured, not assumed: this fires on 3 of the 37 rank captures in the corpus
// that carry no new chip at all — an ENDORSEMENT RECEIVED toast overlapping the
// band, and two OCR garbles. That 8% is precisely why the caller LOGS rather
// than raising a parse warning: a warning routes to the failed-files ledger and
// would mark clean captures as unreadable.
func TestUnknownChipTokens_KnownFalsePositives(t *testing.T) {
	known := parser.StorableModifiers()
	for _, band := range []string{
		"ENDORSEMENT RECEIVED!",
		"AACTARIT ECWNIK",
	} {
		if got := parser.UnknownChipTokens(band, known); len(got) == 0 {
			t.Errorf("band %q produced no tokens; this test documents that it DOES "+
				"produce them, which is the reason the signal is a log and not a warning", band)
		}
	}
}
