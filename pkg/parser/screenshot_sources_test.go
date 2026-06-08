package parser

import "testing"

// TestScreenshotSourcesYAML_LoadsCleanly is the build-time gate
// against a broken screenshot_sources.yaml shipping. Same shape as
// TestEmbeddedYAML_LoadsCleanly — init() has already run by test
// binary start, so non-nil ScreenshotSourcesLoadError fails fast.
func TestScreenshotSourcesYAML_LoadsCleanly(t *testing.T) {
	t.Parallel()
	if ScreenshotSourcesLoadError != nil {
		t.Fatalf("screenshot_sources.yaml failed to load: %v", ScreenshotSourcesLoadError)
	}
	if len(ScreenshotSources) == 0 {
		t.Fatal("ScreenshotSources is empty — YAML parsed but registered no entries")
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
	}
	for _, tc := range cases {
		t.Run(tc.wantName, func(t *testing.T) {
			var hit *ScreenshotSource
			for i := range ScreenshotSources {
				s := &ScreenshotSources[i]
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
