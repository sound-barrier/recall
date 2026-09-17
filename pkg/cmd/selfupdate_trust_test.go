//go:build !serveronly

package cmd_test

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"

	"recall/pkg/cmd"
)

// The Wails GitHub provider returns a release it could not find a digest for
// as if nothing were wrong, and the updater installs such a release unchecked.
// These pin that Recall refuses one instead.

// refusalToken is how the About dialog tells a refused update from a failed
// one: Wails flattens the error into the wails:updater:error message, so the
// dialog has only the text to go on.
const refusalToken = "update refused"

func TestSelfUpdateCheck_RefusesReleaseWithoutSHA256SUMS(t *testing.T) {
	release := publishedRelease()
	delete(release.assets, checksumAsset)

	rel, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))
	assertRefused(t, "a release with no SHA256SUMS", rel, err)
}

func TestSelfUpdateCheck_RefusesExeMissingFromSHA256SUMS(t *testing.T) {
	release := publishedRelease()
	release.assets[checksumAsset] = sha256sums(map[string][]byte{latestInstaller: release.assets[latestInstaller]})

	rel, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))
	assertRefused(t, "a release whose SHA256SUMS omits the exe", rel, err)
}

func TestSelfUpdateCheck_RefusesDigestThatIsNotSHA256Sized(t *testing.T) {
	release := publishedRelease()
	digest := sha256.Sum256(release.assets[latestExe])
	release.assets[checksumAsset] = fmt.Appendf(nil, "%x  %s\n", digest[:16], latestExe)

	rel, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))
	assertRefused(t, "a release listing a 16-byte digest", rel, err)
}

// A refusal that wraps the sentinel with its own context in front, rather than
// going through the refusal helper, must still carry the dialog's token.
func TestErrUpdateRefused_CarriesTheDialogTokenHoweverWrapped(t *testing.T) {
	wrapped := fmt.Errorf("signature: %w", cmd.ErrUpdateRefused)
	if !strings.Contains(wrapped.Error(), refusalToken) {
		t.Errorf("%q does not carry the dialog token %q", wrapped, refusalToken)
	}
}

func assertRefused(t *testing.T, release string, rel *updater.Release, err error) {
	t.Helper()
	if !errors.Is(err, cmd.ErrUpdateRefused) || rel != nil {
		t.Fatalf("Check of %s = %+v, %v; want ErrUpdateRefused", release, rel, err)
	}
	if !strings.Contains(err.Error(), refusalToken) {
		t.Errorf("Check of %s = %q, want a message containing the dialog token %q", release, err, refusalToken)
	}
}

func TestSelfUpdate_RefusedCheckLeavesNothingToInstall(t *testing.T) {
	release := publishedRelease()
	delete(release.assets, checksumAsset)
	u := newTestUpdater(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))

	if _, err := u.Check(t.Context()); err == nil {
		t.Fatal("Check accepted a release with no SHA256SUMS")
	}
	if err := u.DownloadAndInstall(t.Context()); !errors.Is(err, updater.ErrNoPendingRelease) {
		t.Fatalf("DownloadAndInstall after a refused Check = %v, want ErrNoPendingRelease", err)
	}
	if staged := u.DownloadedPath(); staged != "" {
		t.Errorf("staged %s from a refused release", staged)
	}
}

// The About dialog tells a refused update from a failed one by this token in
// the wails:updater:error message. Wails prefixes the provider's text, so the
// token is contained in the message rather than leading it.
func TestSelfUpdate_RefusalReachesTheDialogWithItsToken(t *testing.T) {
	release := publishedRelease()
	delete(release.assets, checksumAsset)
	host := &fakeUpdaterHost{}
	u := newTestUpdaterWithHost(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1), host)

	_, _ = u.Check(t.Context())

	events := host.errorEvents()
	if len(events) != 1 {
		t.Fatalf("error events = %+v, want exactly one", events)
	}
	if events[0].Stage != updater.StageCheck || !strings.Contains(events[0].Message, refusalToken) {
		t.Errorf("error event = %+v, want a check-stage message containing %q", events[0], refusalToken)
	}
}
