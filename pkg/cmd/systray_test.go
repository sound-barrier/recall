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
