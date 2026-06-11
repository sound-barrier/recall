package parser

import "testing"

func TestClassifyQueueByCount(t *testing.T) {
	cases := []struct {
		blue, red int
		want      string
	}{
		{6, 6, "open"},
		{5, 5, "role"},
		// A leaver only ever shrinks a team, so the larger team reveals
		// the queue's roster size. A team of 6 is impossible in role
		// queue, so any 6 means open.
		{6, 5, "open"},
		{5, 6, "open"},
		{5, 4, "role"},
		{4, 5, "role"},
		// Too degraded / impossible — refuse to guess.
		{4, 4, ""},
		{0, 0, ""},
		{7, 6, ""},
		{6, 7, ""},
	}
	for _, c := range cases {
		if got := classifyQueueByCount(c.blue, c.red); got != c.want {
			t.Errorf("classifyQueueByCount(%d, %d) = %q, want %q", c.blue, c.red, got, c.want)
		}
	}
}

func TestCountDigitLines(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int
	}{
		{"five clean rows", "15,461\n15,925\n15,557\n2,602\n1,329", 5},
		{"blank noise line between rows", "11,226\n9,407\n3,165\n6,091\n1,950\n\n265", 6},
		{"punctuation-only line skipped", "5\n,\n6", 2},
		{"empty", "", 0},
		{"only blanks", "\n\n", 0},
		{"whitespace around digits", "  24 \n 27 ", 2},
	}
	for _, c := range cases {
		if got := countDigitLines(c.in); got != c.want {
			t.Errorf("%s: countDigitLines(%q) = %d, want %d", c.name, c.in, got, c.want)
		}
	}
}
