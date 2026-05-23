package app

import (
	"testing"
	"time"
)

// parseFilenameTimestamp extracts the YYYY.MM.DD - HH.MM.SS portion the OW
// client embeds in its screenshot filenames.

func TestParseFilenameTimestamp_Valid(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want time.Time
	}{
		{
			name: "canonical OW filename",
			in:   "2026.05.10 - 21.29.28 _summary.png",
			want: time.Date(2026, 5, 10, 21, 29, 28, 0, time.UTC),
		},
		{
			name: "timestamp embedded mid-filename",
			in:   "screen_2026.01.02 - 03.04.05 _scoreboard.png",
			want: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		},
		{
			name: "filename without extension still matches",
			in:   "2026.12.31 - 23.59.59",
			want: time.Date(2026, 12, 31, 23, 59, 59, 0, time.UTC),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseFilenameTimestamp(tc.in)
			if !ok {
				t.Fatalf("ok=false; want true for %q", tc.in)
			}
			if !got.Equal(tc.want) {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestParseFilenameTimestamp_Reject(t *testing.T) {
	tests := []string{
		"renamed.png",
		"2026-05-10T21:29:28.png",  // wrong separators
		"2026.05.10_21.29.28.png",  // missing " - "
		"26.05.10 - 21.29.28.png",  // 2-digit year
		"2026.5.10 - 21.29.28.png", // unpadded month
		"",
	}
	for _, in := range tests {
		t.Run(in, func(t *testing.T) {
			if _, ok := parseFilenameTimestamp(in); ok {
				t.Fatalf("expected ok=false for %q", in)
			}
		})
	}
}

func TestParseFilenameTimestamp_InvalidDate(t *testing.T) {
	// Pattern matches but date itself is impossible.
	if _, ok := parseFilenameTimestamp("2026.13.32 - 25.61.61"); ok {
		t.Fatalf("expected ok=false for impossible date")
	}
}
