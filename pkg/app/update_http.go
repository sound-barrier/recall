package app

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

// updateAllowedHost reports whether h is a host we'll follow a
// redirect to during an update fetch. GitHub release-asset downloads
// 302 from github.com to the objects.githubusercontent.com CDN, so
// the *.githubusercontent.com suffix must be allowed; everything
// else is refused.
func updateAllowedHost(h string) bool {
	switch h {
	case "api.github.com", "github.com", "sound-barrier.github.io":
		return true
	}
	return strings.HasSuffix(h, ".githubusercontent.com")
}

// newUpdateClient is the http.Client used for every update fetch: a
// 5 s timeout plus a redirect guard. The guard refuses to follow a
// redirect to a host outside the GitHub / Pages allowlist or to a
// non-HTTPS scheme, and caps the chain at 10 hops.
//
// Trust model (review finding F4): the app runs on a home-lab LAN
// with no TLS pinning, so a LAN-level MITM that can spoof github.com
// could still serve a payload — but the SHA-256 sidecar check
// (verifySha256) gates whether fetched data is *applied*, and this
// guard stops a spoofed redirect from bouncing the fetch to an
// arbitrary internal host (SSRF). The initial request URL is never
// user-controlled (it comes from the hardcoded var-seams above), so
// only redirects are gated — test seams pointing at 127.0.0.1 keep
// working because CheckRedirect doesn't fire on the first request.
func newUpdateClient() *http.Client {
	return &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("update: stopped after 10 redirects")
			}
			if req.URL.Scheme != "https" {
				return fmt.Errorf("update: refusing redirect to non-HTTPS %s", req.URL.Redacted())
			}
			if !updateAllowedHost(req.URL.Hostname()) {
				return fmt.Errorf("update: refusing redirect to disallowed host %q", req.URL.Hostname())
			}
			return nil
		},
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
// Trust-model note (review finding F4): the sidecar is fetched over
// the SAME channel as the payload (both from GitHub Releases / Pages),
// so a full LAN-MITM that can substitute the payload can also
// substitute its sidecar and defeat this check. With public-internet
// TLS that's not reachable; on a hostile LAN with no TLS it is. We
// accept this for a home-lab tool — the data here is roster YAML, not
// secrets — but the limitation is real. Stronger options (a
// separate-channel signature, SLSA attestation verification) are
// deferred. The redirect guard in newUpdateClient bounds the
// adjacent SSRF risk regardless.
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
