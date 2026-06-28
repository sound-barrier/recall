//go:build !serveronly

package cmd

import (
	_ "embed"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// trayIcon is the Recall app icon (assets/icon.png, scaled to 128×128) shown in
// the system tray / macOS menu bar. macOS auto-sizes it to the menubar height
// ([image setSize:thickness]); other platforms scale it to their tray. To
// refresh after changing the source icon:
//
//	sips -z 128 128 assets/icon.png --out pkg/cmd/tray-icon.png
//
//go:embed tray-icon.png
var trayIcon []byte

// setupSystemTray adds a tray icon + menu and turns the window's close button
// into a hide, so Recall keeps watching the screenshots folder in the
// background after the window is dismissed. The folder watcher runs independent
// of window visibility, so hiding (not quitting) is all that's needed; the tray
// menu re-shows the window or quits for real.
func setupSystemTray(wailsApp *application.App, win *application.WebviewWindow) {
	win.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) {
		win.Hide()
	})

	tray := wailsApp.SystemTray.New()
	// The Recall app icon, not a template — show the actual coloured mark in the
	// menu bar rather than a monochrome silhouette.
	tray.SetIcon(trayIcon)
	tray.SetMenu(trayMenu(win))
}

// trayMenu builds the tray menu: re-show the window, jump to the in-app update
// check, or quit. "Check for Updates" reuses the menu:about event the native
// menu bar + kebab already drive (the About dialog hosts the update check),
// after un-hiding the window.
func trayMenu(win *application.WebviewWindow) *application.Menu {
	menu := application.NewMenu()
	menu.Add("Show Recall").OnClick(func(*application.Context) {
		win.Show()
		win.Focus()
	})
	menu.Add("Check for Updates…").OnClick(func(*application.Context) {
		win.Show()
		win.Focus()
		if a := application.Get(); a != nil {
			a.Event.Emit("menu:about")
		}
	})
	menu.AddSeparator()
	menu.Add("Quit Recall").OnClick(func(*application.Context) {
		if a := application.Get(); a != nil {
			a.Quit()
		}
	})
	return menu
}
