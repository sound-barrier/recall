package correlate_test

import (
	"testing"
	"time"

	"recall/pkg/correlate"
)

// parseFilenameTimestamp recognises the screenshot filename formats
// each canonical Windows capture tool emits. Per-tool prefix gates
// the regex match so random non-OW files in the watched folder
// don't get absorbed.

func TestParseFilenameTimestamp_Valid(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want time.Time
	}{
		{
			// Nvidia Overlay (existing format): dot-separated date +
			// time with hundredths-of-a-second trailer.
			name: "nvidia overlay happy path",
			in:   "Overwatch 2 Screenshot 2026.05.10 - 19.57.14.89.png",
			want: time.Date(2026, 5, 10, 19, 57, 14, 0, time.UTC),
		},
		{
			// OW default Print Screen: 2-digit year (→ 2026),
			// hyphen-separated date + time, ms trailer, JPG. The
			// hard-coded 20YY mapping covers 2000–2099; OW launched
			// in 2016 so this never undershoots in practice.
			name: "prntscn 2-digit year resolves to 20YY",
			in:   "ScreenShot_26-06-07_22-59-52-000.jpg",
			want: time.Date(2026, 6, 7, 22, 59, 52, 0, time.UTC),
		},
		{
			// Boundary: end-of-century year. Hard-coded prefix means
			// the next decade rollover is the implementer's problem.
			name: "prntscn end-of-century year (99 → 2099)",
			in:   "ScreenShot_99-12-31_23-59-59-000.jpg",
			want: time.Date(2099, 12, 31, 23, 59, 59, 0, time.UTC),
		},
		{
			// Windows Snip tool: ISO date with hyphens, continuous
			// HHMMSS (no separators within the time block).
			name: "win snip tool happy path",
			in:   "Screenshot 2026-06-07 224855.png",
			want: time.Date(2026, 6, 7, 22, 48, 55, 0, time.UTC),
		},
		{
			// Snip + PrntScn share the "Screenshot" stem but differ
			// in case and separator. The trailing space in the
			// "Screenshot " prefix makes the Snip path the only
			// match for this shape.
			name: "snip with single-digit-component times still matches the 6-digit run",
			in:   "Screenshot 2026-01-02 030405.png",
			want: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := correlate.ParseFilenameTimestamp(tc.in)
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
	tests := []struct {
		name string
		in   string
	}{
		{"empty", ""},
		{"random rename", "renamed.png"},
		{"random non-OW screenshot", "IMG_2026-06-07_22-59-52.png"},
		{"nvidia format but no prefix (pre-fix behaviour)", "2026.05.10 - 21.29.28 _summary.png"},
		{"nvidia format embedded mid-filename", "screen_2026.01.02 - 03.04.05 _teams.png"},
		{"timestamp without extension also requires the prefix", "2026.12.31 - 23.59.59"},
		{"snip stem but PrntScn separators (no match)", "Screenshot 26-06-07 224855.png"},
		{"prntscn stem but no underscore after", "ScreenShot 26-06-07_22-59-52-000.jpg"},
		{"prntscn 4-digit year does not match the 2-digit pattern", "ScreenShot_2026-06-07_22-59-52-000.jpg"},
		{"unpadded month", "Overwatch 2 Screenshot 2026.5.10 - 21.29.28.png"},
		{"old ISO separators replaced by hyphens (no match for any format)", "2026-05-10T21:29:28.png"},
		{"old format missing the date-time bridge", "Overwatch 2 Screenshot 2026.05.10_21.29.28.png"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, ok := correlate.ParseFilenameTimestamp(tc.in); ok {
				t.Fatalf("expected ok=false for %q", tc.in)
			}
		})
	}
}

func TestParseFilenameTimestamp_InvalidDate(t *testing.T) {
	tests := []string{
		// Pattern matches but date itself is impossible.
		"Overwatch 2 Screenshot 2026.13.32 - 25.61.61.png",
		"ScreenShot_26-13-32_25-61-61-000.jpg",
		"Screenshot 2026-13-32 256161.png",
	}
	for _, in := range tests {
		t.Run(in, func(t *testing.T) {
			if _, ok := correlate.ParseFilenameTimestamp(in); ok {
				t.Fatalf("expected ok=false for impossible date %q", in)
			}
		})
	}
}
