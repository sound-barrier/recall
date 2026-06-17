//go:build !serveronly

package cmd

import "testing"

// windowSizeForScreen is unexported with no public entry point (RunWails boots
// Wails), so this is a white-box test of the pure sizing math.
func TestWindowSizeForScreen(t *testing.T) {
	cases := []struct {
		name             string
		screenW, screenH int
		wantW, wantH     int
	}{
		{"1440p scales up from the cramped default", 2560, 1440, 1920, 1080},
		{"1080p", 1920, 1080, 1440, 810},
		{"unknown screen falls back to the historical default", 0, 0, 1024, 768},
		{"tiny screen is never exceeded (and floor is capped to it)", 800, 600, 800, 600},
		{"4K scales proportionally", 3840, 2160, 2880, 1620},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w, h := windowSizeForScreen(c.screenW, c.screenH)
			if w != c.wantW || h != c.wantH {
				t.Errorf("windowSizeForScreen(%d, %d) = %dx%d, want %dx%d", c.screenW, c.screenH, w, h, c.wantW, c.wantH)
			}
		})
	}
}
