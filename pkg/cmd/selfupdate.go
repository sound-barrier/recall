//go:build !serveronly

package cmd

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"

	"recall/pkg/app"
	"recall/pkg/applog"
)

// initSelfUpdater configures the framework updater for in-app binary
// self-update and returns the adapter that satisfies app.SelfUpdater —
// or nil (with an Info log naming the reason) when self-update isn't
// possible on this install. Callers assign the result to
// App.SelfUpdate; nil leaves CanSelfUpdate false and every self-update
// method returning ErrSelfUpdateUnavailable → 409.
//
// Gates (any one → nil):
//   - dev build: never self-updates (it isn't a released version).
//   - macOS: the swap needs a Developer-ID-signed + notarized bundle
//     Gatekeeper re-checks; the project has no signing cert, so macOS
//     keeps the "Open release page" flow.
//   - unwritable exe: a Program Files (legacy machine-scope Windows) or
//     /usr/local/bin (.deb) install can't be replaced without elevation
//     the updater helper doesn't perform.
//
// Init itself does no network I/O, so startup stays offline (the
// repo's no-network-on-mount contract).
func initSelfUpdater(wailsApp *application.App, a *app.App) app.SelfUpdater {
	log := applog.Subsystem("selfupdate")

	v := a.GetVersion()
	switch {
	case v == "dev" || strings.HasSuffix(v, "-dev"):
		log.Info("self-update off: dev build", "version", v)
		return nil
	case runtime.GOOS == "darwin":
		log.Info("self-update off: macOS (no signing story; release-page flow)")
		return nil
	case !executableSwappable():
		log.Info("self-update off: install directory is not user-writable")
		return nil
	}

	gh, err := github.New(github.Config{
		Repository:    "sound-barrier/recall",
		ChecksumAsset: "SHA256SUMS",
		AssetMatcher:  recallAssetMatcher,
	})
	if err != nil {
		log.Warn("self-update off: github provider init failed", "err", err)
		return nil
	}

	// CurrentVersion is v-less (the provider strips the leading v from
	// tags on its side); release ldflags carry the tag WITH the v.
	if err := wailsApp.Updater.Init(updater.Config{
		CurrentVersion: strings.TrimPrefix(v, "v"),
		Providers:      []updater.Provider{gh},
		Window:         updater.WindowNone, // headless — the About dialog is the UI
	}); err != nil {
		log.Warn("self-update off: updater init failed", "err", err)
		return nil
	}
	log.Info("self-update ready", "version", v)
	return &wailsSelfUpdater{u: wailsApp.Updater}
}

// wailsSelfUpdater adapts *updater.Updater onto the app.SelfUpdater
// seam, keeping wails/v3 types out of pkg/app.
type wailsSelfUpdater struct{ u *updater.Updater }

var _ app.SelfUpdater = (*wailsSelfUpdater)(nil)

func (w *wailsSelfUpdater) Check(ctx context.Context) (bool, error) {
	rel, err := w.u.Check(ctx)
	return rel != nil, err
}

func (w *wailsSelfUpdater) DownloadAndInstall(ctx context.Context) error {
	return w.u.DownloadAndInstall(ctx)
}

func (w *wailsSelfUpdater) Restart(ctx context.Context) error {
	return w.u.Restart(ctx)
}

// recallAssetMatcher picks the raw per-platform binary the updater
// swaps: recall-<v>-<platform>-<arch> (+ .exe on Windows). Matching by
// that exact suffix excludes the installer (-installer.exe), the deb,
// the dmg, the nested tar.gz, the reference YAMLs, SHA256SUMS/.sha256,
// and the SBOM; the explicit -server- guard drops the headless server
// exe (which shares the windows-amd64.exe suffix).
func recallAssetMatcher(req updater.CheckRequest, assets []github.ReleaseAsset) int {
	suffix := req.Platform + "-" + req.Arch
	if req.Platform == "windows" {
		suffix += ".exe"
	}
	for i, a := range assets {
		name := a.Name
		if strings.HasPrefix(name, "recall-") &&
			!strings.Contains(name, "-server-") &&
			strings.HasSuffix(name, suffix) {
			return i
		}
	}
	return -1
}

// executableSwappable reports whether the running binary's directory
// is writable by the current user — the capability both platforms'
// helpers need (Windows: rename-aside + rename-in; Unix: RemoveAll +
// rename), all within filepath.Dir(os.Executable()).
func executableSwappable() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	return dirWritable(filepath.Dir(exe))
}

// dirWritable probes a directory by creating and removing a temp file.
// A create OR a remove failure (Program Files / /usr/local/bin without
// elevation) reports false.
func dirWritable(dir string) bool {
	f, err := os.CreateTemp(dir, ".recall-update-probe-*")
	if err != nil {
		return false
	}
	name := f.Name()
	_ = f.Close()
	return os.Remove(name) == nil
}
