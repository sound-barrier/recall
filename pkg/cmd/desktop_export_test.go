//go:build !serveronly

package cmd

// TrayMenu / CloseQuitsApp / ParseCompleteBody / DesktopMenu / NewWindowSizer
// expose the desktop-chrome internals (tray menu, close behavior, notification
// body, native menu bar, window geometry) to the external cmd_test package;
// RunWails boots real Wails, so there is no public entry point to exercise them
// through. Build-tagged to match systray.go / wails.go / window_geometry.go,
// which only exist in the non-serveronly (Wails) build.
var (
	TrayMenu          = trayMenu
	CloseQuitsApp     = closeQuitsApp
	ParseCompleteBody = parseCompleteBody
	DesktopMenu       = desktopMenu
	NewWindowSizer    = newWindowSizer
)
