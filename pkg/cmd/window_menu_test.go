//go:build !serveronly

package cmd

import (
	"context"
	"testing"

	"github.com/wailsapp/wails/v2/pkg/menu"
)

func nilCtx() context.Context { return nil }

func TestDesktopMenu_PerOS(t *testing.T) {
	// Windows / Linux get no native menu bar — they use the in-app ⋮ kebab
	// (a top menu bar is non-idiomatic, and they already expose
	// minimize/maximize/close + copy/paste natively).
	for _, goos := range []string{"windows", "linux"} {
		if m := desktopMenu(goos, nilCtx); m != nil {
			t.Errorf("desktopMenu(%q) = non-nil; want nil (the kebab handles it there)", goos)
		}
	}

	// macOS gets the full Chrome/Firefox-style bar: Recall · Edit · View ·
	// Window · Help.
	mac := desktopMenu("darwin", nilCtx)
	if mac == nil {
		t.Fatal("darwin should get a native menu, got nil")
	}
	if len(mac.Items) != 5 {
		t.Fatalf("darwin top-level items = %d, want 5 (Recall, Edit, View, Window, Help)", len(mac.Items))
	}

	// The Recall app menu (first submenu — macOS renders it as the app menu)
	// carries the custom About + Settings items.
	app := mac.Items[0]
	if app.Label != "Recall" || app.SubMenu == nil {
		t.Fatalf("item[0] = %q (submenu=%v); want the Recall app submenu", app.Label, app.SubMenu != nil)
	}
	if !hasLabel(app.SubMenu, "About Recall") || !hasLabel(app.SubMenu, "Settings…") {
		t.Error("Recall menu missing About Recall / Settings…")
	}

	// Edit + Window stay native roles (copy/paste; Minimize + Zoom/maximize).
	if mac.Items[1].Role != menu.EditMenuRole {
		t.Errorf("item[1] role = %d, want EditMenuRole (%d)", mac.Items[1].Role, menu.EditMenuRole)
	}
	if mac.Items[3].Role != menu.WindowMenuRole {
		t.Errorf("item[3] role = %d, want WindowMenuRole (%d)", mac.Items[3].Role, menu.WindowMenuRole)
	}

	// View carries the four tab-jump items (⌘1–4).
	view := mac.Items[2]
	if view.Label != "View" || view.SubMenu == nil || len(view.SubMenu.Items) != 4 {
		t.Errorf("View menu malformed: label=%q items=%d", view.Label, itemCount(view.SubMenu))
	}

	// Help carries the shortcuts + the docs/issue links + About.
	help := mac.Items[4]
	if help.Label != "Help" || !hasLabel(help.SubMenu, "Keyboard Shortcuts") {
		t.Error("Help menu missing or lacks Keyboard Shortcuts")
	}

	// A click before startup (nil ctx) must not panic — every callback guards.
	clickAll(mac)
}

func hasLabel(m *menu.Menu, label string) bool {
	if m == nil {
		return false
	}
	for _, it := range m.Items {
		if it.Label == label {
			return true
		}
	}
	return false
}

func itemCount(m *menu.Menu) int {
	if m == nil {
		return 0
	}
	return len(m.Items)
}

// clickAll invokes every Click callback in the tree to prove the nil-ctx guard
// holds (no panic) before the lifecycle context exists.
func clickAll(m *menu.Menu) {
	if m == nil {
		return
	}
	for _, it := range m.Items {
		if it.Click != nil {
			it.Click(&menu.CallbackData{})
		}
		clickAll(it.SubMenu)
	}
}
