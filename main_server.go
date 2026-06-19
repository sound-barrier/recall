// SPDX-License-Identifier: Apache-2.0

//go:build serveronly

package main

import (
	"os"

	"recall/pkg/app"
	"recall/pkg/applog"
	"recall/pkg/cmd"
)

func main() {
	applog.Init()
	a := app.New()

	// --profile=<name> scopes this launch to a specific profile,
	// auto-creating it if it doesn't exist. The override is recorded
	// as the active profile during Startup so subsequent launches
	// without --profile resume on the same profile.
	for _, arg := range os.Args[1:] {
		if len(arg) > len("--profile=") && arg[:len("--profile=")] == "--profile=" {
			a.SetProfileOverride(arg[len("--profile="):])
		}
	}

	// Server mode emits "tesseract-status" over SSE only (no Wails EventsEmit),
	// so the cold-boot-safe background engine probe is safe to run here too.
	app.EnableTesseractProbeOnStartup()
	cmd.RunServer(a, assets)
}
