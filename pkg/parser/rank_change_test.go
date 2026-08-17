package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

// The rank-movement pill is signed, and a defeat's is NEGATIVE — the meter
// really did move backwards. The old pattern matched a leading '+' only, so
// every defeat in the corpus stored 0: not "no reading", but a confident claim
// that a lost game moved the rank by nothing.
//
// The sign is required rather than optional, and that is the whole safety of
// reading this from a wide band. The same crops carry "RANK PROGRESS: 67%" and
// "HIGHER RANKED THAN 57% OF PLAYERS", both of which an optional sign would
// happily match — storing a progress or population figure as the match's rank
// movement, in range and plausible.
func TestSignedPct(t *testing.T) {
	for _, tc := range []struct {
		name string
		text string
		want int
		ok   bool
	}{
		{"a defeat reads negative", "<<< -32%", -32, true},
		{"a win reads positive", "+40% >>>", 40, true},
		{"spacing between sign and digits survives", "- 19 %", -19, true},
		// The three strings that must NOT match, all present in the bands this
		// runs over.
		{"the progress caption is not a movement", "RANK PROGRESS: 67%", 0, false},
		{"the percentile caption is not a movement", "HIGHER RANKED THAN 57% OF PLAYERS", 0, false},
		{"a bare percentage is not a movement", "44%", 0, false},
		{"empty", "", 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parser.SignedPct(tc.text)
			if ok != tc.ok {
				t.Fatalf("matched = %v, want %v (text %q)", ok, tc.ok, tc.text)
			}
			if got != tc.want {
				t.Errorf("pct = %d, want %d", got, tc.want)
			}
		})
	}
}
