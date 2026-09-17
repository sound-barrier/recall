//go:build !serveronly

package cmd

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
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
	"recall/pkg/updatesig"
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

	// Without the pinned key no release can be verified, so self-update stays
	// off rather than installing anything unchecked.
	releaseKey, err := updatesig.PublicKey()
	if err != nil {
		log.Warn("self-update off: release signing key unreadable", "err", err)
		return nil
	}
	cfg, err := newSelfUpdateConfig(v, newSelfUpdateHTTPClient(selfUpdateClientTimeouts), releaseKey)
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
// releases, fetching everything through client and installing only releases
// signed by releaseKey.
func newSelfUpdateConfig(version string, client *http.Client, releaseKey ed25519.PublicKey) (updater.Config, error) {
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
		Providers:      []updater.Provider{&trustedReleaseProvider{inner: gh, client: client, releaseKey: releaseKey}},
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

func refuseReleaseBecause(rel *updater.Release, cause error) error {
	return fmt.Errorf("%w: release %s: %w", errUpdateRefused, rel.Version, cause)
}

// trustedReleaseProvider refuses a release the updater would otherwise install
// unverified. The Wails GitHub provider fails open: with no SHA256SUMS asset,
// or one that does not list the exe, it returns the release with no
// Verification at all (providers/github/github.go:173-178, :323-325 and :374
// at v3.0.0-beta.22), and the updater installs a release without one unchecked
// (download.go:117-120). Check also requires the exe to be named for its
// release and signed, name and digest, by releaseKey. Name and Download
// delegate, so events still name "github" and the download is the provider's
// own.
//
// Wails can check an Ed25519 signature itself, through Verification.Signature
// and Config.PublicKey, and both are deliberately left unset. Its verifier
// checks a signature over the bare digest (verify.go:120 at v3.0.0-beta.22),
// which binds neither the file name nor the version: it would reject Recall's
// signatures, which cover the name, and a bare-digest signature would still
// pass an older signed exe republished under a newer tag. The updater still
// hashes the download as it streams and compares that, in constant time, with
// the digest Check has authenticated (download.go:105-109 and verify.go:78-82).
type trustedReleaseProvider struct {
	inner      updater.Provider
	client     *http.Client
	releaseKey ed25519.PublicKey
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
	if err := requireExeNamedForRelease(rel); err != nil {
		return nil, err
	}
	if err := p.requireReleaseSignature(ctx, rel); err != nil {
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

// requireExeNamedForRelease refuses rel unless its exe carries the name
// scripts/release/package-wails-windows.sh gives the exe of that very release.
// A signature covers the exe's name but not the tag it is published under, so
// this is what keeps an older signed exe, name and all, from installing as a
// newer release.
func requireExeNamedForRelease(rel *updater.Release) error {
	want := "recall-" + rel.Version + "-" + rel.Artifact.Platform + "-" + rel.Artifact.Arch + ".exe"
	if rel.Artifact.Filename != want {
		return refuseRelease(rel, "offers "+rel.Artifact.Filename+", which is not named for that release")
	}
	return nil
}

// requireReleaseSignature refuses rel unless releaseKey signed its exe's name
// and the digest SHA256SUMS gave it. A signature that could not be fetched is
// an error rather than a refusal: it says nothing about the release, and a
// retry may succeed.
func (p *trustedReleaseProvider) requireReleaseSignature(ctx context.Context, rel *updater.Release) error {
	sigURL, err := releaseSignatureURL(rel)
	if err != nil {
		return err
	}
	sig, err := p.fetchReleaseSignature(ctx, sigURL)
	switch {
	case errors.Is(err, updatesig.ErrMissingSignature):
		return refuseReleaseBecause(rel, err)
	case err != nil:
		return err
	}
	// requireChecksummedDigest has already held the digest to sha256.Size.
	digest := [sha256.Size]byte(rel.Verification.Digest)
	if err := updatesig.Verify(p.releaseKey, rel.Artifact.Filename, digest, sig); err != nil {
		return refuseReleaseBecause(rel, err)
	}
	return nil
}

// releaseSignatureURL is where rel's exe signature is published: beside the
// exe, at the URL the release JSON gave it. The redirect guard sees only the
// hops after a first request, so that first URL is held to github.com over
// HTTPS here, before anything is asked of its host.
func releaseSignatureURL(rel *updater.Release) (string, error) {
	exeURL, ok := rel.Metadata["github.asset.url"].(string)
	if !ok {
		return "", refuseRelease(rel, "gives no download URL for its exe")
	}
	sigURL, err := url.Parse(exeURL + updatesig.SignatureSuffix)
	if err != nil || sigURL.Scheme != "https" || sigURL.Host != "github.com" {
		return "", refuseRelease(rel, "does not publish its signature on github.com over HTTPS")
	}
	return sigURL.String(), nil
}

// fetchReleaseSignature downloads a signature file through the self-update
// client, so its redirects answer to the same guard as the exe's. A 404 is
// updatesig.ErrMissingSignature.
func (p *trustedReleaseProvider) fetchReleaseSignature(ctx context.Context, sigURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sigURL, nil)
	if err != nil {
		return nil, fmt.Errorf("fetch update signature: %w", err)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch update signature: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return nil, updatesig.ErrMissingSignature
	default:
		return nil, fmt.Errorf("fetch update signature: HTTP %d", resp.StatusCode)
	}
	// One byte past a signature is enough to tell that a body is too long.
	sig, err := io.ReadAll(io.LimitReader(resp.Body, updatesig.SignatureSize+1))
	if err != nil {
		return nil, fmt.Errorf("read update signature: %w", err)
	}
	return sig, nil
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
