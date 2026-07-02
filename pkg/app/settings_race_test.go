package app_test

import (
	"context"
	"sync"
	"testing"

	"recall/pkg/app"
)

// App settings are read by the watcher/parse goroutines and written by
// concurrent HTTP handlers (server mode) and Wails-bound calls — every
// access must go through the settings lock or the race detector trips
// (a torn string read is memory-unsafe, not just stale).
func TestApp_SettingsAccess_IsRaceFree(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(context.Background())

	var wg sync.WaitGroup
	for i := range 50 {
		wg.Add(3)
		go func(v bool) {
			defer wg.Done()
			_ = a.SetExitOnClose(v)
		}(i%2 == 0)
		go func() {
			defer wg.Done()
			_ = a.GetExitOnClose()
		}()
		go func() {
			defer wg.Done()
			_ = a.GetScreenshotsDir()
		}()
	}
	wg.Wait()
}
