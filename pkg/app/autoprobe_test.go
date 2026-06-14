package app_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"recall/pkg/app"
	"recall/pkg/probe"
)

func setHome(t *testing.T, home string) {
	t.Helper()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
}

func TestAutoProbeOnFirstRun_AppliesWhenSettingIsEmpty(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	tried := probe.ProbeCandidates()
	if len(tried) == 0 {
		t.Skipf("no probe candidates on %s", runtime.GOOS)
	}
	want := tried[0]
	if err := os.MkdirAll(want, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", want, err)
	}

	// Redirect settings writes into the scratch HOME so saveSettings
	// doesn't pollute the real ~/Library or ~/.config tree.
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))

	a := &app.App{}
	app.AutoProbeOnFirstRun(a)
	if app.AppSettings(a).ScreenshotsDir != want {
		t.Fatalf("settings.ScreenshotsDir = %q; want %q", app.AppSettings(a).ScreenshotsDir, want)
	}
}

func TestAutoProbeOnFirstRun_NoOpWhenAlreadyConfigured(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	// Pre-populate; even if the probe would have found something, the
	// existing path must win.
	preset := filepath.Join(home, "existing")
	if err := os.MkdirAll(preset, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", preset, err)
	}
	tried := probe.ProbeCandidates()
	if len(tried) > 0 {
		if err := os.MkdirAll(tried[0], 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", tried[0], err)
		}
	}

	a := &app.App{}
	app.AppSettings(a).ScreenshotsDir = preset
	app.AutoProbeOnFirstRun(a)
	if app.AppSettings(a).ScreenshotsDir != preset {
		t.Fatalf("settings.ScreenshotsDir overwrote preset: got %q want %q", app.AppSettings(a).ScreenshotsDir, preset)
	}
}
