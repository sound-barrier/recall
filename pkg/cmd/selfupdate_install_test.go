//go:build !serveronly

package cmd_test

import (
	"bytes"
	"errors"
	"net"
	"os"
	"testing"
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

	_, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), selfUpdateSpeedup))
	var netErr net.Error
	if !errors.As(err, &netErr) || !netErr.Timeout() {
		t.Fatalf("Check against a server that never answers = %v, want a timeout", err)
	}
}
