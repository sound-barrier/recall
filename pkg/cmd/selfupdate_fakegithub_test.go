//go:build !serveronly

package cmd_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"maps"
	"net"
	"net/http"
	"net/http/httptest"
	"path"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"

	"recall/pkg/cmd"
)

// The fake release sits one version ahead of the installed build, and its
// assets carry the names package-wails-windows.sh gives a real release.
const (
	installedVersion = "v0.33.2"
	latestTag        = "v0.34.0"
	latestExe        = "recall-0.34.0-windows-amd64.exe"
	latestInstaller  = "recall-0.34.0-windows-amd64-installer.exe"
	checksumAsset    = "SHA256SUMS"
)

const (
	releaseDownloadPrefix = "/sound-barrier/recall/releases/download/"
	releaseAssetsURL      = "https://release-assets.githubusercontent.com/github-production-release-asset/"
)

// fakeRelease is the latest release a fakeGitHub publishes, and how the fake
// misbehaves while serving it.
type fakeRelease struct {
	tag    string
	assets map[string][]byte
	// redirectTo sends an asset's github.com download to this URL instead of
	// to release-assets.githubusercontent.com.
	redirectTo map[string]string
	// extraHops makes github.com redirect an asset's download back to itself
	// this many times before handing it to release-assets.
	extraHops map[string]int
	// dribble spreads an asset's body evenly over this long.
	dribble map[string]time.Duration
	// stallAPI leaves every releases API request unanswered.
	stallAPI bool
}

// publishedRelease is what a release publishes today for the updater to read:
// the updater exe, the installer, and a SHA256SUMS covering both.
func publishedRelease() fakeRelease {
	exe := bytes.Repeat([]byte("recall 0.34.0 windows updater\n"), 4096)
	installer := []byte("recall 0.34.0 windows installer\n")
	return fakeRelease{
		tag: latestTag,
		assets: map[string][]byte{
			latestExe:       exe,
			latestInstaller: installer,
			checksumAsset:   sha256sums(map[string][]byte{latestExe: exe, latestInstaller: installer}),
		},
	}
}

// sha256sums renders files the way `sha256sum` lists them, sorted by name.
func sha256sums(files map[string][]byte) []byte {
	var listing bytes.Buffer
	for _, name := range slices.Sorted(maps.Keys(files)) {
		_, _ = fmt.Fprintf(&listing, "%x  %s\n", sha256.Sum256(files[name]), name)
	}
	return listing.Bytes()
}

// fakeGitHub answers for api.github.com, github.com and every other host an
// update fetch can reach, so a test drives the real URLs and redirect chain
// of a release. A routed client keeps its own redirect policy and timeouts;
// only where its connections land changes.
type fakeGitHub struct {
	release fakeRelease
	https   *httptest.Server
	plain   *httptest.Server
	closing chan struct{}
}

func serveFakeGitHub(t *testing.T, release fakeRelease) *fakeGitHub {
	t.Helper()
	fake := &fakeGitHub{release: release, closing: make(chan struct{})}
	fake.https = httptest.NewUnstartedServer(fake)
	fake.plain = httptest.NewUnstartedServer(fake)
	for _, server := range []*httptest.Server{fake.https, fake.plain} {
		// Clients abandoning connections is the point of several tests.
		server.Config.ErrorLog = log.New(io.Discard, "", 0)
		t.Cleanup(server.Close)
	}
	fake.https.StartTLS()
	fake.plain.Start()
	// Registered last so it runs first: Close waits for a stalled handler.
	t.Cleanup(func() { close(fake.closing) })
	return fake
}

// route sends client's connections to the fake: port 443 to its TLS server,
// any other port to its plain one.
func (f *fakeGitHub) route(t *testing.T, client *http.Client) {
	t.Helper()
	transport, ok := http.DefaultTransport.(*http.Transport)
	if client.Transport != nil {
		transport, ok = client.Transport.(*http.Transport)
	}
	if !ok {
		t.Fatalf("the fake routes an *http.Transport, and the client has %T", client.Transport)
	}
	transport = transport.Clone()
	roots := x509.NewCertPool()
	roots.AddCert(f.https.Certificate())
	// httptest's certificate names example.com, not the hosts it stands in for.
	transport.TLSClientConfig = &tls.Config{RootCAs: roots, ServerName: "example.com", MinVersion: tls.VersionTLS12}
	transport.Proxy = nil
	transport.DialContext = f.dial
	client.Transport = transport
}

func (f *fakeGitHub) dial(ctx context.Context, network, addr string) (net.Conn, error) {
	server := f.plain
	if _, port, err := net.SplitHostPort(addr); err == nil && port == "443" {
		server = f.https
	}
	var dialer net.Dialer
	return dialer.DialContext(ctx, network, server.Listener.Addr().String())
}

func (f *fakeGitHub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Host == "api.github.com":
		f.serveLatestRelease(w, r)
	case r.Host == "github.com" && strings.HasPrefix(r.URL.Path, releaseDownloadPrefix):
		f.redirectDownload(w, r)
	default:
		f.serveAsset(w, r)
	}
}

type releaseJSON struct {
	TagName     string      `json:"tag_name"`
	Name        string      `json:"name"`
	Draft       bool        `json:"draft"`
	Prerelease  bool        `json:"prerelease"`
	HTMLURL     string      `json:"html_url"`
	PublishedAt time.Time   `json:"published_at"`
	Assets      []assetJSON `json:"assets"`
}

type assetJSON struct {
	ID                 int64  `json:"id"`
	Name               string `json:"name"`
	ContentType        string `json:"content_type"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

func (f *fakeGitHub) serveLatestRelease(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/repos/sound-barrier/recall/releases/latest" {
		http.NotFound(w, r)
		return
	}
	if f.release.stallAPI {
		select {
		case <-r.Context().Done():
		case <-f.closing:
		}
		return
	}
	body := releaseJSON{
		TagName:     f.release.tag,
		Name:        f.release.tag,
		HTMLURL:     "https://github.com/sound-barrier/recall/releases/tag/" + f.release.tag,
		PublishedAt: time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC),
	}
	for i, name := range slices.Sorted(maps.Keys(f.release.assets)) {
		body.Assets = append(body.Assets, assetJSON{
			ID:                 int64(i + 1),
			Name:               name,
			ContentType:        "application/octet-stream",
			Size:               int64(len(f.release.assets[name])),
			BrowserDownloadURL: "https://github.com" + releaseDownloadPrefix + f.release.tag + "/" + name,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func (f *fakeGitHub) redirectDownload(w http.ResponseWriter, r *http.Request) {
	name := path.Base(r.URL.Path)
	hop, _ := strconv.Atoi(r.URL.Query().Get("hop"))
	target := releaseAssetsURL + name
	switch {
	case f.release.redirectTo[name] != "":
		target = f.release.redirectTo[name]
	case hop < f.release.extraHops[name]:
		target = fmt.Sprintf("https://github.com%s?hop=%d", r.URL.Path, hop+1)
	}
	http.Redirect(w, r, target, http.StatusFound)
}

func (f *fakeGitHub) serveAsset(w http.ResponseWriter, r *http.Request) {
	name := path.Base(r.URL.Path)
	body, ok := f.release.assets[name]
	if !ok {
		http.NotFound(w, r)
		return
	}
	if over := f.release.dribble[name]; over > 0 {
		dribbleBody(w, r, body, over)
		return
	}
	_, _ = w.Write(body)
}

// dribbleBody sends body in even pieces spread over the given duration,
// flushing each, the way a slow but steady link delivers it.
func dribbleBody(w http.ResponseWriter, r *http.Request, body []byte, over time.Duration) {
	const pieces = 20
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	flusher := http.NewResponseController(w)
	for i := range pieces {
		_, _ = w.Write(body[len(body)*i/pieces : len(body)*(i+1)/pieces])
		_ = flusher.Flush()
		select {
		case <-time.After(over / pieces):
		case <-r.Context().Done():
			return
		}
	}
}

// fakeUpdaterHost is the application side of the updater, reduced to what a
// headless Check and DownloadAndInstall touch. It keeps the error events the
// About dialog would receive.
type fakeUpdaterHost struct {
	mu     sync.Mutex
	errors []updater.ErrorInfo
}

var _ updater.Host = (*fakeUpdaterHost)(nil)

func (h *fakeUpdaterHost) Emit(name string, data ...any) bool {
	if name != updater.EventError || len(data) != 1 {
		return true
	}
	if info, ok := data[0].(updater.ErrorInfo); ok {
		h.mu.Lock()
		h.errors = append(h.errors, info)
		h.mu.Unlock()
	}
	return true
}

func (h *fakeUpdaterHost) errorEvents() []updater.ErrorInfo {
	h.mu.Lock()
	defer h.mu.Unlock()
	return slices.Clone(h.errors)
}

func (*fakeUpdaterHost) OnEvent(string, func(any)) func()                      { return func() {} }
func (*fakeUpdaterHost) OpenWindow(updater.WindowOptions) updater.WindowHandle { return nil }
func (*fakeUpdaterHost) Quit()                                                 {}

// selfUpdateConfigAgainst builds the production updater configuration, with
// the production client sped up by speedup and routed to fake.
func selfUpdateConfigAgainst(t *testing.T, fake *fakeGitHub, speedup int) updater.Config {
	t.Helper()
	client := cmd.NewSelfUpdateHTTPClient(speedup)
	fake.route(t, client)
	cfg, err := cmd.NewSelfUpdateConfig(installedVersion, client)
	if err != nil {
		t.Fatalf("NewSelfUpdateConfig: %v", err)
	}
	return cfg
}

// newTestUpdater initializes an updater as a Windows install would, staging
// downloads under the test's temp dir.
func newTestUpdater(t *testing.T, cfg updater.Config) *updater.Updater {
	t.Helper()
	return newTestUpdaterWithHost(t, cfg, &fakeUpdaterHost{})
}

func newTestUpdaterWithHost(t *testing.T, cfg updater.Config, host *fakeUpdaterHost) *updater.Updater {
	t.Helper()
	cfg.Platform, cfg.Arch = "windows", "amd64"
	staging := t.TempDir()
	for _, variable := range []string{"TMPDIR", "TMP", "TEMP"} {
		t.Setenv(variable, staging)
	}
	u := updater.New(host)
	if err := u.Init(cfg); err != nil {
		t.Fatalf("updater Init: %v", err)
	}
	return u
}

// checkLatest asks the configured provider directly, because Updater.Check
// flattens provider errors to text (updater.go:222 and :524-533 at wails/v3
// v3.0.0-beta.22) and errors.Is needs the chain.
func checkLatest(t *testing.T, cfg updater.Config) (*updater.Release, error) {
	t.Helper()
	return cfg.Providers[0].Check(t.Context(), updater.CheckRequest{
		CurrentVersion: cfg.CurrentVersion,
		Platform:       "windows",
		Arch:           "amd64",
	})
}
