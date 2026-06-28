//go:build !serveronly

package cmd

import "testing"

func TestDesktopMenu_PerOS(t *testing.T) {
	// Windows / Linux get no native menu bar — they use the in-app ⋮ kebab.
	for _, goos := range []string{"windows", "linux"} {
		if m := desktopMenu(goos); m != nil {
			t.Errorf("desktopMenu(%q) = non-nil; want nil (the kebab handles it there)", goos)
		}
	}

	// macOS gets the full Chrome/Firefox-style bar: Recall · Edit · View ·
	// Window · Help, with the custom items wired (FindByLabel recurses into
	// submenus). Edit/Window are native roles, not asserted by label here.
	mac := desktopMenu("darwin")
	if mac == nil {
		t.Fatal("darwin should get a native menu, got nil")
	}
	for _, label := range []string{
		"Recall", "About Recall", "Settings…", "Quit Recall",
		"View", "Matches", "Unknown",
		"Help", "Keyboard Shortcuts", "Report an Issue",
	} {
		if mac.FindByLabel(label) == nil {
			t.Errorf("darwin menu missing item %q", label)
		}
	}
}
