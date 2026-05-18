//go:build !serveronly

package cmd

import (
	"embed"

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
			Assets: assets,
			// Custom handler serves /_screenshot/<filename> from the
			// user's configured screenshots dir so the frontend can
			// render <img> previews without round-tripping the bytes
			// through the JS bridge.
			Handler: a.ScreenshotHandler(),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        a.Startup,
		Bind: []interface{}{
			a,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
