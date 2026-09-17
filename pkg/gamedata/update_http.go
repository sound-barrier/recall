package gamedata

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ErrRedirectRefused marks a redirect an update fetch declined to follow.
var ErrRedirectRefused = errors.New("update: redirect refused")

// maxUpdateRedirects caps a redirect chain at the length net/http's default
// policy allows. A client that installs its own policy loses that cap.
const maxUpdateRedirects = 10

// updateAllowedHost reports whether h is a host we'll follow a
// redirect to during an update fetch. GitHub release-asset downloads
// 302 from github.com to a *.githubusercontent.com CDN host
// (release-assets today, objects before it), so that suffix must be
// allowed; everything else is refused.
func updateAllowedHost(h string) bool {
	switch h {
	case "api.github.com", "github.com", "sound-barrier.github.io":
		return true
	}
	return strings.HasSuffix(h, ".githubusercontent.com")
}

// CheckUpdateRedirect is the http.Client redirect policy for every fetch
// of update data, reference data and Recall's own self-update alike. It
// refuses, wrapping ErrRedirectRefused, a redirect to a non-HTTPS URL or
// to a host outside the GitHub / Pages allowlist, and ends a chain after
// maxUpdateRedirects requests.
//
// The fetches ride public TLS to GitHub with no certificate pinning. The
// policy keeps a redirect from downgrading one to plain HTTP, where anyone
// on the path could substitute what it returns, or from bouncing it to a
// host that is not GitHub's, such as a service on the user's own network.
//
// Only redirects are gated, so the first URL of a fetch is trusted as given.
// Reference data and release checks build it from hardcoded templates (or a
// test seam pointing at 127.0.0.1, which keeps working because CheckRedirect
// never sees the first request). Self-update's first URLs are not hardcoded:
// the Wails GitHub provider takes each asset's browser_download_url from the
// api.github.com release JSON, so they are only as trustworthy as that TLS
// response.
func CheckUpdateRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= maxUpdateRedirects {
		return fmt.Errorf("%w: stopped after %d redirects", ErrRedirectRefused, maxUpdateRedirects)
	}
	if req.URL.Scheme != "https" {
		return fmt.Errorf("%w: not HTTPS: %s", ErrRedirectRefused, req.URL.Redacted())
	}
	if !updateAllowedHost(req.URL.Hostname()) {
		return fmt.Errorf("%w: host %q is not allowed", ErrRedirectRefused, req.URL.Hostname())
	}
	return nil
}

// NewUpdateClient is the http.Client used for every reference-data and
// release-metadata fetch: a 5 s timeout plus CheckUpdateRedirect.
func NewUpdateClient() *http.Client {
	return &http.Client{
		Timeout:       5 * time.Second,
		CheckRedirect: CheckUpdateRedirect,
	}
}

// getBytes runs a GET and returns the response body, capped at 1 MB
// to bound memory if a malicious or misconfigured host returns a
// stream-without-end. The released YAML files are ~10 KB each, so
// 1 MB is two orders of magnitude of headroom.
func getBytes(client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 1<<20))
}

// verifySha256 compares the SHA-256 of `payload` against the hash
// claimed in `sidecar`. The sidecar follows the sha256sum format:
// `<64-char hex hash>  <filename>` — we read the first whitespace-
// separated token and treat it as the expected hash.
//
// The sidecar comes from the same place as the payload, so the check
// catches a corrupted or truncated download, not a substituted one:
// whoever can replace the payload can replace its sidecar too. That is
// accepted here because the payload is reference data (roster YAML),
// not code.
func verifySha256(payload, sidecar []byte) bool {
	fields := strings.Fields(string(sidecar))
	if len(fields) == 0 {
		return false
	}
	want := strings.ToLower(fields[0])
	if len(want) != 64 {
		return false
	}
	got := sha256.Sum256(payload)
	return hex.EncodeToString(got[:]) == want
}
