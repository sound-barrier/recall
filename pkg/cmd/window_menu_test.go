//go:build !serveronly

package cmd

import (
	"testing"

	"github.com/wailsapp/wails/v2/pkg/menu"
)

func TestDesktopMenu_PerOS(t *testing.T) {
	// macOS has no title-bar "maximize"; the native maximize is Window ▸ Zoom,
	// which lives in the Window menu (role 3). We also add App (About/Quit) and
	// Edit (so Cmd+C/V/X work in inputs) — both standard on macOS and otherwise
	// missing when no menu is set.
	mac := desktopMenu("darwin")
	if mac == nil {
		t.Fatal("darwin should get a native menu, got nil")
	}
	want := []menu.Role{menu.AppMenuRole, menu.EditMenuRole, menu.WindowMenuRole}
	if len(mac.Items) != len(want) {
		t.Fatalf("darwin menu top-level items = %d, want %d (App, Edit, Window)", len(mac.Items), len(want))
	}
	for i, role := range want {
		if mac.Items[i].Role != role {
			t.Errorf("darwin menu item %d role = %d, want %d", i, mac.Items[i].Role, role)
		}
	}

	// Windows / Linux already expose minimize/maximize/close in the native title
	// bar (and copy/paste in the webview), so a menu bar is non-idiomatic there.
	for _, goos := range []string{"windows", "linux"} {
		if m := desktopMenu(goos); m != nil {
			t.Errorf("desktopMenu(%q) = non-nil; want nil (rely on native title-bar controls)", goos)
		}
	}
}
