//go:build !serveronly

package cmd

import (
	_ "embed"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"recall/pkg/app"
)

// trayIcon is the full-colour Recall app icon (assets/icon.png, scaled to
// 128×128) shown in the Windows / Linux tray. Refresh after changing the source:
//
//	sips -z 128 128 assets/icon.png --out pkg/cmd/tray-icon.png
//
//go:embed tray-icon.png
var trayIcon []byte

// trayIconTemplate is the macOS menu-bar TEMPLATE variant: a black "Re"
// silhouette on transparency that macOS tints for light/dark menu bars (the
// platform-native look). Derived from tray-icon.png — every pixel recoloured
// black with alpha from a luminance ramp (opaque ≤190, transparent ≥225) so the
// orange R + grey e read solid and the white background drops out; the source
// icon's 1px frame border is zeroed (outer 3px).
//
//go:embed tray-icon-template.png
var trayIconTemplate []byte

// setupSystemTray adds a tray icon + menu and wires the window's close button to
// a platform-aware behavior. By default closing hides the window to the tray so
// Recall keeps watching the screenshots folder in the background; the tray menu
// re-shows the window or quits for real.
func setupSystemTray(wailsApp *application.App, win *application.WebviewWindow, a *app.App) {
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		// Platform-aware close. macOS always keeps the app in the menu bar
		// (window-close never quits there per the HIG; ⌘Q quits), so it ignores
		// the preference. On Windows/Linux the user's ExitOnClose setting decides:
		// quit outright, or hide to the tray (Hide + Cancel keeps the window alive
		// so the folder watcher keeps running and "Show Recall" can restore it).
		// Read live so toggling the setting takes effect without a restart.
		if closeQuitsApp(runtime.GOOS, a.GetExitOnClose()) {
			wailsApp.Quit()
			return
		}
		win.Hide()
		e.Cancel()
	})

	tray := wailsApp.SystemTray.New()
	// macOS menu bars expect a monochrome template image (auto-tinted for
	// light/dark); Windows + Linux trays show the full-colour icon.
	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(trayIconTemplate)
	} else {
		tray.SetIcon(trayIcon)
	}
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

// closeQuitsApp decides whether closing the window quits Recall (true) or hides
// it to the tray (false). macOS always hides — the app stays in the menu bar per
// the platform convention (⌘Q is the explicit quit). Elsewhere the user's
// exitOnClose preference decides.
func closeQuitsApp(goos string, exitOnClose bool) bool {
	return goos != "darwin" && exitOnClose
}
