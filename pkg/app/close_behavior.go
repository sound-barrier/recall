package app

// GetExitOnClose reports the window-close preference: true quits Recall when
// the window closes, false (default) hides it to the tray so the folder watcher
// keeps running. Read by the frontend to seed the toggle and by the Wails close
// hook at close-time. Ignored on macOS, which always keeps the app in the menu
// bar per platform convention.
func (a *App) GetExitOnClose() bool {
	return a.settings.ExitOnClose
}

// SetExitOnClose persists the window-close preference. It has no immediate
// side effect — the close hook reads the value live on the next window close.
func (a *App) SetExitOnClose(exitOnClose bool) error {
	a.settings.ExitOnClose = exitOnClose
	return a.saveSettings(a.settings)
}
