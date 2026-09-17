//go:build !serveronly

package cmd_test

import (
	"bytes"
	"errors"
	"net"
	"os"
	"testing"
	"time"

	"recall/pkg/gamedata"
)

// These drive the self-updater end to end against a fake GitHub: the provider
// Recall configures, the client it fetches through, and the framework updater
// that stages what it downloads.

// selfUpdateSpeedup compresses every production timeout, so half a second of a
// test stands for thirty seconds of a real link.
const selfUpdateSpeedup = 60

func TestSelfUpdate_InstallsReleaseThatMatchesSHA256SUMS(t *testing.T) {
	release := publishedRelease()
	u := newTestUpdater(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))

	rel, err := u.Check(t.Context())
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if rel == nil || rel.Version != "0.34.0" || rel.Artifact.Filename != latestExe {
		t.Fatalf("Check found %+v, want %s from 0.34.0", rel, latestExe)
	}
	if err := u.DownloadAndInstall(t.Context()); err != nil {
		t.Fatalf("DownloadAndInstall: %v", err)
	}
	staged, err := os.ReadFile(u.DownloadedPath())
	if err != nil {
		t.Fatalf("read staged update: %v", err)
	}
	if !bytes.Equal(staged, release.assets[latestExe]) {
		t.Error("the staged update is not the published exe")
	}
}

func TestSelfUpdate_RefusesDownloadThatDiffersFromSHA256SUMS(t *testing.T) {
	release := publishedRelease()
	release.assets[checksumAsset] = sha256sums(map[string][]byte{latestExe: []byte("the exe that was checksummed")})
	u := newTestUpdater(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))

	if _, err := u.Check(t.Context()); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if err := u.DownloadAndInstall(t.Context()); err == nil {
		t.Fatal("installed an exe whose digest SHA256SUMS does not list")
	}
	if staged := u.DownloadedPath(); staged != "" {
		t.Errorf("staged %s despite the digest mismatch", staged)
	}
}

func TestSelfUpdateCheck_FindsNothingWhenTheLatestIsInstalled(t *testing.T) {
	release := publishedRelease()
	release.tag = installedVersion

	rel, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))
	if err != nil || rel != nil {
		t.Fatalf("Check with %s installed and published = %+v, %v; want nothing to install", installedVersion, rel, err)
	}
}

func TestSelfUpdateCheck_AbandonsAServerThatNeverAnswers(t *testing.T) {
	release := publishedRelease()
	release.stallAPI = true
	cfg := selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), selfUpdateSpeedup)

	started := time.Now()
	_, err := checkLatest(t, cfg)
	var netErr net.Error
	if !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("Check against a server that never answers = %v, want a timeout", err)
	}
	// Ten times the half second a 30-second phase timeout takes here, and far
	// short of any budget sized for a whole download.
	if held := time.Since(started); held > 5*time.Second {
		t.Errorf("a server that never answered held the check for %v", held)
	}
}

// The v0.33.2 updater exe is 23,473,152 bytes, which takes about two minutes
// over a 1.5 Mbps link: slow, but a link people update over.
func TestSelfUpdate_FinishesASlowButSteadyDownload(t *testing.T) {
	release := publishedRelease()
	release.dribble = map[string]time.Duration{latestExe: 2 * time.Minute / selfUpdateSpeedup}
	u := newTestUpdater(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), selfUpdateSpeedup))

	if _, err := u.Check(t.Context()); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if err := u.DownloadAndInstall(t.Context()); err != nil {
		t.Fatalf("a download still progressing after two minutes was abandoned: %v", err)
	}
}

func TestSelfUpdateCheck_RefusesRedirectToPlainHTTP(t *testing.T) {
	release := publishedRelease()
	release.redirectTo = map[string]string{checksumAsset: "http://github.com/plain/" + checksumAsset}

	_, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))
	if !errors.Is(err, gamedata.ErrRedirectRefused) {
		t.Fatalf("Check with SHA256SUMS redirected to plain HTTP = %v, want ErrRedirectRefused", err)
	}
}

func TestSelfUpdateDownload_RefusesRedirectOffGitHub(t *testing.T) {
	release := publishedRelease()
	release.redirectTo = map[string]string{latestExe: "https://updates.example.invalid/" + latestExe}
	u := newTestUpdater(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))

	if _, err := u.Check(t.Context()); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if err := u.DownloadAndInstall(t.Context()); !errors.Is(err, gamedata.ErrRedirectRefused) {
		t.Fatalf("download redirected off GitHub = %v, want ErrRedirectRefused", err)
	}
	if staged := u.DownloadedPath(); staged != "" {
		t.Errorf("staged %s from a host that is not GitHub", staged)
	}
}

// The Wails provider stops counting hops once a client brings its own
// redirect policy, so that policy has to end a loop itself.
func TestSelfUpdateDownload_RefusesEndlessRedirects(t *testing.T) {
	release := publishedRelease()
	release.extraHops = map[string]int{latestExe: 50}
	u := newTestUpdater(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))

	if _, err := u.Check(t.Context()); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if err := u.DownloadAndInstall(t.Context()); !errors.Is(err, gamedata.ErrRedirectRefused) {
		t.Fatalf("download redirected 50 times = %v, want ErrRedirectRefused", err)
	}
}

// github.com hands every asset download to release-assets.githubusercontent.com
// (checked with `curl -sI` against v0.33.2), sometimes after hops of its own.
func TestSelfUpdate_FollowsGitHubRedirectsToReleaseAssets(t *testing.T) {
	release := publishedRelease()
	release.extraHops = map[string]int{latestExe: 3, checksumAsset: 3}
	u := newTestUpdater(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))

	if _, err := u.Check(t.Context()); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if err := u.DownloadAndInstall(t.Context()); err != nil {
		t.Fatalf("download through github.com's redirects to release-assets: %v", err)
	}
}
