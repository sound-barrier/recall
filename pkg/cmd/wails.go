//go:build !serveronly

package cmd

import (
	"context"
	"embed"
	"net/http"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"recall/pkg/app"
)

// RunWails launches the full Wails native-window desktop application.
func RunWails(a *app.App, assets embed.FS) {
	// The desktop's OnStartup hands Startup a real Wails lifecycle context, so
	// the background engine probe's "tesseract-status" emit is safe here. This is
	// where the cold-boot-doesn't-block-the-UI win actually matters.
	app.EnableTesseractProbeOnStartup()
	err := wails.Run(&options.App{
		Title:  "Recall",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: screenshotsMiddleware(a.ScreenshotHandler()),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		// Native menu, per-OS (see desktopMenu): macOS gets the standard App /
		// Edit / Window menus so the platform "maximize" (Window ▸ Zoom) and
		// Cmd+C/V/X exist; Windows / Linux keep their native title-bar controls.
		Menu: desktopMenu(runtime.GOOS),
		// Creation size is a safe minimum; OnStartup grows it to a share of
		// the actual display once the runtime can report screen dimensions
		// (the fixed 1024×768 felt cramped on 1440p+ monitors).
		OnStartup: func(ctx context.Context) {
			a.Startup(ctx)
			sizeWindowToScreen(ctx)
		},
		Bind: []any{
			a,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}

// desktopMenu returns the native application menu for the given OS, following
// each platform's window conventions:
//
//   - macOS has no title-bar "maximize". The native maximize is Window ▸ Zoom
//     (the macOS performZoom action, carried by the Window menu), so a Mac app
//     without a menu has no discoverable maximize at all. It also needs an Edit
//     menu or Cmd+C / V / X don't work in text inputs, and an App menu for
//     About / Hide / Quit. We provide all three standard menus.
//   - Windows / Linux already expose minimize / maximize / close in the native
//     title bar (and copy / paste in the webview), where a menu bar is
//     non-idiomatic — so return nil and rely on the native controls.
//
// (Re-pointing the macOS green button from fullscreen to zoom would require
// objc/CGo, which the project avoids; the native Window menu is the supported
// CGo-free path to a real maximize.)
func desktopMenu(goos string) *menu.Menu {
	if goos != "darwin" {
		return nil
	}
	return menu.NewMenuFromItems(menu.AppMenu(), menu.EditMenu(), menu.WindowMenu())
}

// screenshotsMiddleware short-circuits `/_screenshot/...` requests to
// the provided handler before they hit the AssetServer's downstream
// pipeline (Vite proxy in dev mode, embedded assets in production).
//
// This MUST be a Middleware, not the Wails `Handler` option: in
// `wails dev` the AssetServer proxies every request to the Vite dev
// server first, and Vite's SPA fallback returns `index.html` with a
// 200 OK for unknown routes. The `Handler` fallback only fires on a
// 404/405 from the proxy, so a Handler-wired ScreenshotHandler would
// never be reached in dev and image previews would render the
// index.html bytes (failing to decode). Middleware intercepts the
// request before the proxy, so dev and production behave identically.
//
// Extracted for testability — see middleware_test.go.
func screenshotsMiddleware(screenshots http.Handler) assetserver.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/_screenshot/") {
				screenshots.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
