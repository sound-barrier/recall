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
	for _, arg := range os.Args[1:] {
		if arg == "-s" || arg == "--server" {
			cmd.RunServer(a, assets)
			return
		}
	}

	cmd.RunWails(a, assets)
}
