//go:build !serveronly

package cmd

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"

	"recall/pkg/app"
	"recall/pkg/applog"
	"recall/pkg/gamedata"
)

// initSelfUpdater configures the framework updater for in-app binary
// self-update and returns the adapter that satisfies app.SelfUpdater —
// or nil (with an Info log naming the reason) when self-update isn't
// possible on this install. Callers assign the result to
// App.SelfUpdate; nil leaves CanSelfUpdate false and every self-update
// method returning ErrSelfUpdateUnavailable → 409.
//
// Recall ships a Windows desktop app only, so self-update is Windows-only.
// Gates (any one → nil):
//   - dev build: never self-updates (it isn't a released version).
//   - non-Windows: macOS is a dev-only target and there are no Linux/macOS
//     releases to update to, so those builds keep the "Open release page"
//     flow.
//   - unwritable exe: a legacy machine-scope Program Files install can't be
//     replaced without elevation the updater helper doesn't perform.
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
	case runtime.GOOS != "windows":
		log.Info("self-update off: non-Windows build (Windows-only self-update)", "os", runtime.GOOS)
		return nil
	case !executableSwappable():
		log.Info("self-update off: install directory is not user-writable")
		return nil
	}

	cfg, err := newSelfUpdateConfig(v, newSelfUpdateHTTPClient(selfUpdateClientTimeouts))
	if err != nil {
		log.Warn("self-update off: github provider init failed", "err", err)
		return nil
	}
	if err := wailsApp.Updater.Init(cfg); err != nil {
		log.Warn("self-update off: updater init failed", "err", err)
		return nil
	}
	log.Info("self-update ready", "version", v)
	return &wailsSelfUpdater{u: wailsApp.Updater}
}

// newSelfUpdateConfig builds the updater configuration for Recall's GitHub
// releases, fetching everything through client.
func newSelfUpdateConfig(version string, client *http.Client) (updater.Config, error) {
	gh, err := github.New(github.Config{
		Repository:    "sound-barrier/recall",
		ChecksumAsset: "SHA256SUMS",
		AssetMatcher:  recallAssetMatcher,
		HTTPClient:    client,
	})
	if err != nil {
		return updater.Config{}, err
	}
	// CurrentVersion is v-less (the provider strips the leading v from
	// tags on its side); release ldflags carry the tag WITH the v.
	return updater.Config{
		CurrentVersion: strings.TrimPrefix(version, "v"),
		Providers:      []updater.Provider{&trustedReleaseProvider{inner: gh}},
		Window:         updater.WindowNone, // headless — the About dialog is the UI
	}, nil
}

// errUpdateRefused is the one sentinel every refusal of a release wraps, and
// its text is a wire contract. Wails flattens provider errors into the text of
// the wails:updater:error event (updater.go:222 and :524-533 at
// v3.0.0-beta.22), so errors.Is does not reach the About dialog; the dialog
// tells a refusal from a failure by the token "update refused" in that
// message, matched anywhere because Wails prefixes the provider's text. The
// token is the sentinel's whole text, not something a formatter adds around
// it, so any wrap of the sentinel carries it; change the text only in lockstep
// with UPDATE_REFUSAL_TOKEN in frontend/src/self-update-events.ts.
var errUpdateRefused = errors.New("update refused")

func refuseRelease(rel *updater.Release, reason string) error {
	return fmt.Errorf("%w: release %s %s", errUpdateRefused, rel.Version, reason)
}

// trustedReleaseProvider refuses a release the updater would otherwise install
// unverified. The Wails GitHub provider fails open: with no SHA256SUMS asset,
// or one that does not list the exe, it returns the release with no
// Verification at all (providers/github/github.go:173-178, :323-325 and :374
// at v3.0.0-beta.22), and the updater installs a release without one unchecked
// (download.go:117-120). Name and Download delegate, so events still name
// "github" and the download is the provider's own.
type trustedReleaseProvider struct {
	inner updater.Provider
}

var _ updater.Provider = (*trustedReleaseProvider)(nil)

func (p *trustedReleaseProvider) Name() string { return p.inner.Name() }

func (p *trustedReleaseProvider) Check(ctx context.Context, req updater.CheckRequest) (*updater.Release, error) {
	rel, err := p.inner.Check(ctx, req)
	if err != nil || rel == nil {
		return rel, err
	}
	if err := requireChecksummedDigest(rel); err != nil {
		return nil, err
	}
	return rel, nil
}

func (p *trustedReleaseProvider) Download(ctx context.Context, rel *updater.Release, dst io.Writer, onProgress func(written, total int64)) error {
	return p.inner.Download(ctx, rel, dst, onProgress)
}

// requireChecksummedDigest refuses rel unless SHA256SUMS gave its exe a
// SHA-256 digest, the one digest the updater then holds the download to.
func requireChecksummedDigest(rel *updater.Release) error {
	verification := rel.Verification
	switch {
	case verification == nil:
		return refuseRelease(rel, "is not covered by its SHA256SUMS")
	case verification.DigestAlgo != "sha256" || len(verification.Digest) != sha256.Size:
		return refuseRelease(rel, "has a SHA256SUMS entry that is not a SHA-256 digest")
	}
	return nil
}

// The self-update client times each phase of a fetch on its own and the whole
// transfer generously. The client the GitHub provider builds when handed none
// (providers/github/github.go:98-101 at wails/v3 v3.0.0-beta.22) has one
// 30-second total that also covers reading the body, and that cannot carry
// the 23,473,152-byte v0.33.2 exe over a link slower than about 6.3 Mbps.
// StartSelfUpdate runs under context.Background() (pkg/app/selfupdate.go), so
// the transfer budget is the only bound on a trickling download, and the
// phase timeouts keep a dead server from holding a check for all of it.
const (
	selfUpdateDialTimeout           = 30 * time.Second
	selfUpdateTLSHandshakeTimeout   = 30 * time.Second
	selfUpdateResponseHeaderTimeout = 30 * time.Second
	selfUpdateTransferBudget        = 30 * time.Minute
)

// selfUpdateTimeouts is the self-update client's time policy, held as data so
// tests can run the production policy on a compressed clock.
type selfUpdateTimeouts struct {
	dial, tlsHandshake, responseHeader, transfer time.Duration
}

var selfUpdateClientTimeouts = selfUpdateTimeouts{
	dial:           selfUpdateDialTimeout,
	tlsHandshake:   selfUpdateTLSHandshakeTimeout,
	responseHeader: selfUpdateResponseHeaderTimeout,
	transfer:       selfUpdateTransferBudget,
}

func newSelfUpdateHTTPClient(timeouts selfUpdateTimeouts) *http.Client {
	// A clone keeps net/http's proxy-from-environment, HTTP/2 and connection
	// pooling; only the timeouts differ.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = (&net.Dialer{Timeout: timeouts.dial}).DialContext
	transport.TLSHandshakeTimeout = timeouts.tlsHandshake
	transport.ResponseHeaderTimeout = timeouts.responseHeader
	return &http.Client{
		Timeout:   timeouts.transfer,
		Transport: transport,
		// The exe and SHA256SUMS arrive through redirects, and a hop off
		// HTTPS or off GitHub would let someone else choose both. The Wails
		// provider defers to this policy and then skips its own hop cap
		// (providers/github/github.go:253-258 at v3.0.0-beta.22), so the
		// policy has to end a loop itself, which the shared guard does.
		CheckRedirect: gamedata.CheckUpdateRedirect,
	}
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

// recallAssetMatcher picks the raw Windows updater exe the framework
// swaps: recall-<v>-windows-amd64.exe. Requiring the exact
// `windows-<arch>.exe` suffix excludes the installer
// (recall-<v>-windows-amd64-installer.exe, which ends in
// `-installer.exe`), the reference YAMLs, SHA256SUMS/.sha256, and the
// SBOM by construction. Self-update only runs on Windows (see the gate
// in initSelfUpdater), so req.Platform is always "windows" here.
func recallAssetMatcher(req updater.CheckRequest, assets []github.ReleaseAsset) int {
	suffix := req.Platform + "-" + req.Arch + ".exe"
	for i, a := range assets {
		name := a.Name
		if strings.HasPrefix(name, "recall-") && strings.HasSuffix(name, suffix) {
			return i
		}
	}
	return -1
}

// executableSwappable reports whether the running binary's directory is
// writable by the current user — what the Windows updater helper needs
// (rename-aside + rename-in), all within filepath.Dir(os.Executable()).
func executableSwappable() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	return dirWritable(filepath.Dir(exe))
}

// dirWritable probes a directory by creating and removing a temp file.
// A create OR a remove failure (a legacy machine-scope Program Files
// install without elevation) reports false.
func dirWritable(dir string) bool {
	f, err := os.CreateTemp(dir, ".recall-update-probe-*")
	if err != nil {
		return false
	}
	name := f.Name()
	_ = f.Close()
	return os.Remove(name) == nil
}
