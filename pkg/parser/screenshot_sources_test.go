package parser_test

import (
	"testing"

	"recall/pkg/parser"
)

// TestScreenshotSourcesYAML_LoadsCleanly is the build-time gate
// against a broken screenshot_sources.yaml shipping. init() has
// already run by test binary start, so LoadError() (which joins the
// per-file load errors, including screenshot_sources) fails fast.
func TestScreenshotSourcesYAML_LoadsCleanly(t *testing.T) {
	if err := parser.LoadError(); err != nil {
		t.Fatalf("dataset load failed (screenshot_sources included): %v", err)
	}
	if len(parser.Sources()) == 0 {
		t.Fatal("Sources() is empty — YAML parsed but registered no entries")
	}
}

// TestScreenshotSourcesYAML_CoversCanonicalFilenames asserts that
// the three canonical capture-tool filenames each match exactly one
// source (and that the first-match-wins regex captures the six
// expected groups). Regression catches a YAML edit that breaks the
// existing parser callsites in pkg/app/correlation.go.
func TestScreenshotSourcesYAML_CoversCanonicalFilenames(t *testing.T) {
	cases := []struct {
		filename string
		wantName string
	}{
		{"Overwatch 2 Screenshot 2026.05.10 - 19.57.14.89.png", "nvidia"},
		{"ScreenShot_26-06-07_22-59-52-000.jpg", "prntscn"},
		{"Screenshot 2026-06-07 224855.png", "snip"},
		{"20260609000031_1.jpg", "steam"},
		// Multi-monitor Steam: `_N>1` matches the same source.
		{"20260609000031_2.jpg", "steam"},
	}
	for _, tc := range cases {
		t.Run(tc.wantName, func(t *testing.T) {
			var hit *parser.ScreenshotSource
			sources := parser.Sources()
			for i := range sources {
				s := &sources[i]
				if len(s.Prefix) == 0 || !startsWith(tc.filename, s.Prefix) {
					continue
				}
				m := s.Regex.FindStringSubmatch(tc.filename)
				if m == nil {
					continue
				}
				if len(m) != 7 { // index 0 is the full match + 6 groups
					t.Fatalf("source %q matched %q but produced %d groups, want 6", s.Name, tc.filename, len(m)-1)
				}
				hit = s
				break
			}
			if hit == nil {
				t.Fatalf("no source matched %q", tc.filename)
			}
			if hit.Name != tc.wantName {
				t.Errorf("first-match source = %q, want %q", hit.Name, tc.wantName)
			}
		})
	}
}

// startsWith is a stand-in for strings.HasPrefix kept inline to
// avoid the strings import in the test file (consistency with the
// other parser test files that don't import strings).
func startsWith(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
