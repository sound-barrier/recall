//go:build !serveronly

package app

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceStartup wires the Wails v3 service lifecycle to the shared cold-boot
// init. v3 calls this once at launch (the App is registered via
// application.NewService in pkg/cmd); server mode calls Startup directly.
func (a *App) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	a.Startup(ctx)
	return nil
}
