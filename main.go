//go:build !serveronly

package main

import (
	"os"

	"recall/pkg/app"
	"recall/pkg/cmd"
)

func main() {
	a := app.New()

	// Convenience: the Wails binary also supports --server / -s so users
	// can run the HTTP dashboard without building a separate binary.
	// --profile=<name> scopes this launch to a specific profile,
	// creating it if it doesn't exist (useful for "open my alt
	// account once" without touching the persisted active profile —
	// the override is still recorded as the new active inside Startup
	// so subsequent launches without --profile remember the choice).
	serverMode := false
	for _, arg := range os.Args[1:] {
		switch {
		case arg == "-s" || arg == "--server":
			serverMode = true
		case len(arg) > len("--profile=") && arg[:len("--profile=")] == "--profile=":
			a.SetProfileOverride(arg[len("--profile="):])
		}
	}

	if serverMode {
		cmd.RunServer(a, assets)
		return
	}
	cmd.RunWails(a, assets)
}
