package app

import "errors"

// GetExitOnClose reports the window-close preference: true quits Recall when
// the window closes, false (default) hides it to the tray so the folder watcher
// keeps running. Read by the frontend to seed the toggle and by the Wails close
// hook at close-time. Ignored on macOS, which always keeps the app in the menu
// bar per platform convention.
func (a *App) GetExitOnClose() bool {
	return a.settingsSnapshot().ExitOnClose
}

// SetExitOnClose persists the window-close preference. It has no immediate
// side effect — the close hook reads the value live on the next window close.
func (a *App) SetExitOnClose(exitOnClose bool) error {
	snap := a.mutateSettings(func(s *Settings) { s.ExitOnClose = exitOnClose })
	return a.saveSettings(snap)
}

// WindowSizer is the desktop window-geometry seam. The Wails shell (pkg/cmd)
// implements it and assigns it to App.WindowSize; keeping wails/v3 types out of
// pkg/app is what lets the serveronly build skip the window code entirely. A
// nil App.WindowSize means there is no native window on this install — server
// mode — and every caller keys off that.
type WindowSizer interface {
	// Reset forgets the remembered geometry and returns the live window to the
	// default size for the display it is on. It applies immediately rather than
	// on the next launch, so the button the user pressed visibly does something.
	Reset() error
}

// ErrWindowSizeUnavailable is returned by ResetWindowSize when no window is
// wired. The HTTP layer maps it to 409, matching the self-update seam.
var ErrWindowSizeUnavailable = errors.New("no desktop window on this install")

// ResetWindowSize discards the saved window geometry and re-applies the
// default. Unlike the close preference above, this one has an immediate side
// effect: the window resizes as the call returns.
func (a *App) ResetWindowSize() error {
	if a.WindowSize == nil {
		return ErrWindowSizeUnavailable
	}
	return a.WindowSize.Reset()
}
