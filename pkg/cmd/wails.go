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
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"recall/pkg/app"
)

// External targets for the Help menu (the browser/kebab equivalents live in
// frontend/src/app-links.ts — keep the two in lockstep).
const (
	docsURL   = "https://sound-barrier.github.io/recall/"
	issuesURL = "https://github.com/sound-barrier/recall/issues"
)

// RunWails launches the full Wails native-window desktop application.
func RunWails(a *app.App, assets embed.FS) {
	// The desktop's OnStartup hands Startup a real Wails lifecycle context, so
	// the background engine probe's "tesseract-status" emit is safe here. This is
	// where the cold-boot-doesn't-block-the-UI win actually matters.
	app.EnableTesseractProbeOnStartup()
	// The native menu's callbacks emit Wails events / open URLs, all of which
	// need the lifecycle context — which doesn't exist until OnStartup. Capture
	// it in a closure the menu reads at click time (always after startup).
	var winCtx context.Context
	err := wails.Run(&options.App{
		Title:  "Recall",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: screenshotsMiddleware(a.ScreenshotHandler()),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		// Native menu, per-OS (see desktopMenu): macOS gets the full Chrome/
		// Firefox-style menu bar (About / Settings / View / Help wired to the
		// in-app dialogs, plus native Edit + Window). Windows / Linux keep their
		// title-bar controls and use the in-app ⋮ kebab instead.
		Menu: desktopMenu(runtime.GOOS, func() context.Context { return winCtx }),
		// Creation size is a safe minimum; OnStartup grows it to a share of
		// the actual display once the runtime can report screen dimensions
		// (the fixed 1024×768 felt cramped on 1440p+ monitors).
		OnStartup: func(ctx context.Context) {
			winCtx = ctx
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

// desktopMenu returns the native application menu for the given OS. Modeled on
// Chrome/Firefox: macOS gets a full menu bar; Windows/Linux get nothing here
// and use the in-app ⋮ kebab instead (a top menu bar is non-idiomatic there,
// and they already expose minimize/maximize/close + copy/paste natively).
//
// The macOS bar is `Recall · Edit · View · Window · Help`:
//   - Recall (the app menu — the first submenu, which macOS renders as such):
//     About / Settings ⌘, → in-app dialogs; native Hide / Quit.
//   - Edit, Window: native roles (copy/paste; Minimize + Zoom/maximize).
//   - View: ⌘1–4 jump to the four tabs.
//   - Help: keyboard shortcuts + Documentation / Report-an-issue links + About.
//
// Custom items fire `menu:*` Wails events (or open URLs); the frontend's
// useNativeMenu opens the matching dialog. ctx supplies the lifecycle context
// at click time (nil before startup, always set by the time a menu fires).
func desktopMenu(goos string, ctx func() context.Context) *menu.Menu {
	if goos != "darwin" {
		return nil
	}

	emit := func(name string, data ...any) menu.Callback {
		return func(*menu.CallbackData) {
			if c := ctx(); c != nil {
				wruntime.EventsEmit(c, name, data...)
			}
		}
	}
	openURL := func(url string) menu.Callback {
		return func(*menu.CallbackData) {
			if c := ctx(); c != nil {
				wruntime.BrowserOpenURL(c, url)
			}
		}
	}
	runtimeCall := func(fn func(context.Context)) menu.Callback {
		return func(*menu.CallbackData) {
			if c := ctx(); c != nil {
				fn(c)
			}
		}
	}

	appMenu := menu.SubMenu("Recall", menu.NewMenuFromItems(
		menu.Text("About Recall", nil, emit("menu:about")),
		menu.Separator(),
		menu.Text("Settings…", keys.CmdOrCtrl(","), emit("menu:settings")),
		menu.Separator(),
		menu.Text("Hide Recall", keys.CmdOrCtrl("h"), runtimeCall(wruntime.Hide)),
		menu.Text("Quit Recall", keys.CmdOrCtrl("q"), runtimeCall(wruntime.Quit)),
	))

	viewMenu := menu.SubMenu("View", menu.NewMenuFromItems(
		menu.Text("Settings", keys.CmdOrCtrl("1"), emit("menu:view", "settings")),
		menu.Text("Parse", keys.CmdOrCtrl("2"), emit("menu:view", "ingest")),
		menu.Text("Matches", keys.CmdOrCtrl("3"), emit("menu:view", "matches")),
		menu.Text("Unknown", keys.CmdOrCtrl("4"), emit("menu:view", "unknown")),
	))

	helpMenu := menu.SubMenu("Help", menu.NewMenuFromItems(
		menu.Text("Keyboard Shortcuts", nil, emit("menu:shortcuts")),
		menu.Text("Recall Documentation", nil, openURL(docsURL)),
		menu.Text("Report an Issue", nil, openURL(issuesURL)),
		menu.Separator(),
		menu.Text("About Recall", nil, emit("menu:about")),
	))

	return menu.NewMenuFromItems(appMenu, menu.EditMenu(), viewMenu, menu.WindowMenu(), helpMenu)
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
