//go:build !serveronly

package cmd

import (
	"embed"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"recall/pkg/app"
)

// RunWails launches the full Wails native-window desktop application.
func RunWails(a *app.App, assets embed.FS) {
	err := wails.Run(&options.App{
		Title:  "Recall",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: screenshotsMiddleware(a.ScreenshotHandler()),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        a.Startup,
		Bind: []any{
			a,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
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
