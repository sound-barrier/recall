//go:build !serveronly

package cmd

import "testing"

func TestTrayMenu(t *testing.T) {
	// Pass a nil window: trayMenu only wires it into click callbacks, which a
	// label-structure check never invokes (FindByLabel recurses the items).
	m := trayMenu(nil)
	for _, label := range []string{"Show Recall", "Check for Updates…", "Quit Recall"} {
		if m.FindByLabel(label) == nil {
			t.Errorf("tray menu missing item %q", label)
		}
	}
}

func TestCloseQuitsApp(t *testing.T) {
	cases := []struct {
		goos        string
		exitOnClose bool
		wantQuit    bool
	}{
		// macOS always hides to the menu bar, regardless of the preference.
		{"darwin", true, false},
		{"darwin", false, false},
		// Windows/Linux honor the preference.
		{"windows", true, true},
		{"windows", false, false},
		{"linux", true, true},
		{"linux", false, false},
	}
	for _, c := range cases {
		if got := closeQuitsApp(c.goos, c.exitOnClose); got != c.wantQuit {
			t.Errorf("closeQuitsApp(%q, %v) = %v, want %v", c.goos, c.exitOnClose, got, c.wantQuit)
		}
	}
}
