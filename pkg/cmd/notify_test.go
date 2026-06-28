//go:build !serveronly

package cmd

import "testing"

func TestParseCompleteBody(t *testing.T) {
	// notifyParseComplete only fires for matchCount > 0, so the body is never
	// rendered for 0; the contract that matters is the singular/plural split.
	cases := map[int]string{
		1:  "Parsed 1 new match",
		2:  "Parsed 2 new matches",
		17: "Parsed 17 new matches",
	}
	for n, want := range cases {
		if got := parseCompleteBody(n); got != want {
			t.Errorf("parseCompleteBody(%d) = %q; want %q", n, got, want)
		}
	}
}
