//go:build !serveronly

package cmd

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/icons"
)

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
	if runtime.GOOS == "darwin" {
		// A template icon is a monochrome mask macOS tints for light/dark menubars.
		tray.SetTemplateIcon(icons.SystrayMacTemplate)
	} else {
		tray.SetIcon(icons.SystrayLight).SetDarkModeIcon(icons.SystrayDark)
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
