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

// The full Windows-only asset inventory a release publishes — order
// deliberately puts the installer AHEAD of the raw exe so the matcher's
// exact-suffix match is proven independent of position (the installer
// ends in `-installer.exe`, not `windows-amd64.exe`).
func fullReleaseAssets() []github.ReleaseAsset {
	names := []string{
		"recall-0.23.0-windows-amd64-installer.exe", // human download — NOT the updater target
		"recall-0.23.0-windows-amd64.exe",           // the raw Windows updater target
		"recall-0.23.0-heroes.yaml",
		"recall-0.23.0-maps.yaml",
		"recall-0.23.0-screenshot_sources.yaml",
		"recall-0.23.0-Reset-Database.bat",
		"recall-0.23.0-sbom.spdx.json",
		"SHA256SUMS",
		"recall-0.23.0-windows-amd64.exe.sha256",
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
		{"windows", "amd64", "recall-0.23.0-windows-amd64.exe"}, // the raw exe, NOT the installer
		{"windows", "arm64", "<none>"},                          // only amd64 is published
		{"linux", "amd64", "<none>"},                            // no Linux release (Windows-only)
		{"darwin", "arm64", "<none>"},                           // no macOS release (dev-only target)
	}
	for _, c := range cases {
		got := pick(cmd.RecallAssetMatcher(updater.CheckRequest{Platform: c.platform, Arch: c.arch}, assets))
		if got != c.want {
			t.Errorf("match(%s/%s) = %q, want %q", c.platform, c.arch, got, c.want)
		}
	}
}

func TestRecallAssetMatcher_EmptyAssets(t *testing.T) {
	if i := cmd.RecallAssetMatcher(updater.CheckRequest{Platform: "windows", Arch: "amd64"}, nil); i != -1 {
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
