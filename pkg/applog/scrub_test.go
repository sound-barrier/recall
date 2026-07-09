package applog_test

import (
	"testing"

	"recall/pkg/applog"
)

func TestScrub(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"plain value is unchanged", "main", "main"},
		{"empty string", "", ""},
		{"keeps spaces, dashes, underscores", "my-account_2 alt", "my-account_2 alt"},
		{"strips a newline that would forge a line", "main\nERROR forged entry", "mainERROR forged entry"},
		{"strips a carriage return", "main\rERROR forged", "mainERROR forged"},
		{"strips a CRLF pair", "a\r\nb", "ab"},
		{"strips several line breaks", "a\nb\nc\n", "abc"},
		{"preserves tab characters", "a\tb", "a\tb"},
		{"preserves NUL bytes", "a\x00b", "a\x00b"},
		{"preserves vertical tab", "a\x0bb", "a\x0bb"},
		{"removes CR/LF while preserving other controls", "a\t\r\nb\x00\nc", "a\tb\x00c"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := applog.Scrub(tt.in); got != tt.want {
				t.Errorf("Scrub(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
