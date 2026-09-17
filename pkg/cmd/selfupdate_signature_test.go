//go:build !serveronly

package cmd_test

import (
	"bytes"
	"crypto/rand"
	"errors"
	"net/http"
	"strings"
	"testing"

	"recall/pkg/cmd"
	"recall/pkg/gamedata"
	"recall/pkg/updatesig"
)

// The updater installs a release only when the release key signed its exe,
// under the exe's own name, and the exe is named for the release it ships in.
// Someone who can publish a release but holds no key can otherwise serve an
// unsigned exe, or an older genuinely signed one under a newer tag.

// olderExe stands for an earlier release's updater exe, genuinely signed when
// that release shipped.
const olderExe = "recall-0.33.5-windows-amd64.exe"

var olderExeBody = []byte("recall 0.33.5 windows updater\n")

func checkRefusesBecause(t *testing.T, release fakeRelease, what string, cause error) {
	t.Helper()
	rel, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))
	assertRefused(t, what, rel, err)
	if !errors.Is(err, cause) {
		t.Errorf("Check of %s = %v, want it to wrap %v", what, err, cause)
	}
}

func TestSelfUpdateCheck_RefusesReleaseWithoutSignature(t *testing.T) {
	release := publishedRelease()
	delete(release.assets, latestExeSignature)

	checkRefusesBecause(t, release, "a release with no signature", updatesig.ErrMissingSignature)
}

func TestSelfUpdateCheck_RefusesMalformedSignature(t *testing.T) {
	signature := publishedRelease().assets[latestExeSignature]
	cases := map[string][]byte{
		"10 bytes":                    signature[:10],
		"a signature and a byte more": append(bytes.Clone(signature), 0),
		"empty":                       {},
	}
	for name, malformed := range cases {
		t.Run(name, func(t *testing.T) {
			release := publishedRelease()
			release.assets[latestExeSignature] = malformed

			checkRefusesBecause(t, release, "a release signed with "+name, updatesig.ErrBadSignature)
		})
	}
}

func TestSelfUpdateCheck_RefusesGarbageSignature(t *testing.T) {
	release := publishedRelease()
	garbage := make([]byte, updatesig.SignatureSize)
	_, _ = rand.Read(garbage)
	release.assets[latestExeSignature] = garbage

	checkRefusesBecause(t, release, "a release signed with 64 random bytes", updatesig.ErrBadSignature)
}

func TestSelfUpdateCheck_RefusesSignatureFromAnotherKey(t *testing.T) {
	release := publishedRelease()
	release.assets[latestExeSignature] = signatureOf(newThrowawayKey(), latestExe, release.assets[latestExe])

	checkRefusesBecause(t, release, "a release signed by another key", updatesig.ErrBadSignature)
}

// The older exe and its signature are genuine, and SHA256SUMS lists the
// exe's real digest, but it is renamed for the newer release: the signature
// names the exe it was made for.
func TestSelfUpdateCheck_RefusesRenamedOlderSignedExe(t *testing.T) {
	release := publishedRelease()
	release.assets[latestExe] = olderExeBody
	release.assets[checksumAsset] = sha256sums(map[string][]byte{latestExe: olderExeBody})
	release.assets[latestExeSignature] = signatureOf(releaseKey, olderExe, olderExeBody)

	checkRefusesBecause(t, release, "an older signed exe renamed for a newer release", updatesig.ErrBadSignature)
}

// Everything about the older exe verifies, name included; only the tag it is
// published under is newer.
func TestSelfUpdateCheck_RefusesOlderSignedExeUnderNewerTag(t *testing.T) {
	release := publishedRelease()
	delete(release.assets, latestExe)
	delete(release.assets, latestExeSignature)
	release.assets[olderExe] = olderExeBody
	release.assets[olderExe+updatesig.SignatureSuffix] = signatureOf(releaseKey, olderExe, olderExeBody)
	release.assets[checksumAsset] = sha256sums(map[string][]byte{olderExe: olderExeBody})

	rel, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))
	assertRefused(t, olderExe+" published as "+latestTag, rel, err)
}

// Only redirects answer to the client's redirect guard, so the first URL of
// the signature fetch, which comes from the release JSON, is checked before
// anything is asked of its host.
func TestSelfUpdateCheck_RefusesSignatureOffGitHubWithoutFetchingIt(t *testing.T) {
	cases := map[string]string{
		"over plain HTTP": "http://github.com" + releaseDownloadPrefix + latestTag + "/" + latestExe,
		"on another host": "https://updates.example.invalid/" + latestExe,
	}
	for name, exeURL := range cases {
		t.Run(name, func(t *testing.T) {
			release := publishedRelease()
			release.downloadURL = map[string]string{latestExe: exeURL}
			fake := serveFakeGitHub(t, release)

			rel, err := checkLatest(t, selfUpdateConfigAgainst(t, fake, 1))
			assertRefused(t, "a release whose exe is listed at "+exeURL, rel, err)
			if fake.wasAsked(latestExeSignature) {
				t.Errorf("fetched the signature from beside %s before refusing it", exeURL)
			}
		})
	}
}

// A signature the server failed to hand over says nothing about the release,
// so the About dialog must offer a retry rather than a refusal.
func TestSelfUpdateCheck_SignatureServerErrorIsNotARefusal(t *testing.T) {
	release := publishedRelease()
	release.status = map[string]int{latestExeSignature: http.StatusServiceUnavailable}

	rel, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))
	if err == nil || rel != nil {
		t.Fatalf("Check with the signature answering 503 = %+v, %v; want an error", rel, err)
	}
	if errors.Is(err, cmd.ErrUpdateRefused) || strings.Contains(err.Error(), refusalToken) {
		t.Errorf("Check with the signature answering 503 = %q, want a failure, not a refusal", err)
	}
}

func TestSelfUpdateCheck_SignatureFetchHonorsTheRedirectGuard(t *testing.T) {
	release := publishedRelease()
	release.redirectTo = map[string]string{latestExeSignature: "http://github.com/plain/" + latestExeSignature}

	_, err := checkLatest(t, selfUpdateConfigAgainst(t, serveFakeGitHub(t, release), 1))
	if !errors.Is(err, gamedata.ErrRedirectRefused) {
		t.Fatalf("Check with the signature redirected to plain HTTP = %v, want ErrRedirectRefused", err)
	}
}
