package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	// If -s or --server is passed, run as a headless HTTP server on
	// 127.0.0.1:7000 instead of opening the native Wails window.
	for _, arg := range os.Args[1:] {
		if arg == "-s" || arg == "--server" {
			runServer(app)
			return
		}
	}

	// Create application with options
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
			Handler: app.ScreenshotHandler(),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
