//go:build !serveronly

package cmd

// ScreenshotsMiddleware exposes the Wails-mode screenshot short-circuit shim to
// the external cmd_test package; it wraps caller-supplied handlers, so there is
// no public injection point. Build-tagged to match screenshotsMiddleware, which
// only exists in the non-serveronly (Wails) build.
var ScreenshotsMiddleware = screenshotsMiddleware
