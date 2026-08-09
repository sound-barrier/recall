//go:build !serveronly

package cmd

// ScreenshotsMiddleware / APIMiddleware / DesktopAPIHandler expose the
// Wails-mode asset-server shims to the external cmd_test package; they wrap
// caller-supplied handlers, so there is no public injection point.
// Build-tagged to match the shims, which only exist in the non-serveronly
// (Wails) build.
var (
	ScreenshotsMiddleware = screenshotsMiddleware
	APIMiddleware         = apiMiddleware
	DesktopAPIHandler     = desktopAPIHandler
)
