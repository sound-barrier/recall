//go:build !serveronly

package cmd_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/github"

	"recall/pkg/cmd"
)

// The full asset inventory a release publishes — order deliberately puts the
// installer and the server exe AHEAD of the raw binaries so the matcher's
// suffix + -server- exclusion is proven independent of position.
func fullReleaseAssets() []github.ReleaseAsset {
	names := []string{
		"recall-0.23.0-windows-amd64-installer.exe",
		"recall-server-0.23.0-windows-amd64.exe",
		"recall-0.23.0-windows-amd64.exe", // the raw Windows updater target
		"recall-0.23.0-darwin-arm64.dmg",
		"recall-server-0.23.0-darwin-arm64.tar.gz",
		"recall-0.23.0-linux-amd64.tar.gz",
		"recall-0.23.0-linux-amd64.deb",
		"recall-server-0.23.0-linux-amd64.tar.gz",
		"recall-server-0.23.0-linux-amd64.deb",
		"recall-0.23.0-linux-amd64", // the raw Linux updater target
		"recall-0.23.0-heroes.yaml",
		"recall-0.23.0-maps.yaml",
		"recall-0.23.0-screenshot_sources.yaml",
		"recall-0.23.0-Reset-Database.bat",
		"recall-0.23.0-sbom.spdx.json",
		"SHA256SUMS",
		"recall-0.23.0-windows-amd64.exe.sha256",
		"recall-0.23.0-linux-amd64.sha256",
	}
	assets := make([]github.ReleaseAsset, len(names))
	for i, n := range names {
		assets[i] = github.ReleaseAsset{Name: n}
	}
	return assets
}

func TestRecallAssetMatcher(t *testing.T) {
	assets := fullReleaseAssets()
	pick := func(i int) string {
		if i < 0 {
			return "<none>"
		}
		return assets[i].Name
	}

	cases := []struct {
		platform, arch string
		want           string
	}{
		{"windows", "amd64", "recall-0.23.0-windows-amd64.exe"}, // not installer, not server
		{"linux", "amd64", "recall-0.23.0-linux-amd64"},         // not tar.gz/deb/server
		{"darwin", "arm64", "<none>"},                           // no raw mac asset published
		{"linux", "arm64", "<none>"},                            // unpublished arch
		{"windows", "arm64", "<none>"},
	}
	for _, c := range cases {
		got := pick(cmd.RecallAssetMatcher(updater.CheckRequest{Platform: c.platform, Arch: c.arch}, assets))
		if got != c.want {
			t.Errorf("match(%s/%s) = %q, want %q", c.platform, c.arch, got, c.want)
		}
	}
}

func TestRecallAssetMatcher_EmptyAssets(t *testing.T) {
	if i := cmd.RecallAssetMatcher(updater.CheckRequest{Platform: "linux", Arch: "amd64"}, nil); i != -1 {
		t.Errorf("empty asset list = %d, want -1", i)
	}
}

func TestDirWritable(t *testing.T) {
	if !cmd.DirWritable(t.TempDir()) {
		t.Error("a fresh temp dir should be writable")
	}
	missing := filepath.Join(t.TempDir(), "does-not-exist")
	if cmd.DirWritable(missing) {
		t.Errorf("a nonexistent dir %q should not report writable", missing)
	}
	// A read-only dir isn't writable. Skipped on Windows (its ACL model
	// makes 0o555 non-authoritative) — matches the repo's platform-gated
	// test discipline; unix CI covers it.
	if os.PathSeparator == '/' {
		ro := filepath.Join(t.TempDir(), "ro")
		if err := os.Mkdir(ro, 0o555); err != nil {
			t.Fatalf("mkdir ro: %v", err)
		}
		if cmd.DirWritable(ro) {
			t.Errorf("a 0o555 dir should not report writable")
		}
	}
}
