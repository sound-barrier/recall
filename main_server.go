//go:build serveronly

package main

import (
	"recall/pkg/app"
	"recall/pkg/cmd"
)

func main() {
	cmd.RunServer(app.New(), assets)
}
