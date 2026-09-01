package rosterwatch

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ErrSourceUnreadable is what every fetcher returns when a page or payload
// parsed but yielded nothing recognizable.
//
// It is a distinct error, and the distinction is the point: an upstream that
// changed shape must never report as "your roster is in sync". That is the
// failure mode a silent scrape has — it goes quiet in exactly the week the
// answer stopped being true — and the caller maps this error to its own exit
// code so a broken source is loud.
var ErrSourceUnreadable = errors.New("rosterwatch: source unreadable")

// The upstream seams. Package-level vars so tests point them at httptest,
// the pattern pkg/gamedata uses for MainAssetURL / MainVersionURL.
var (
	// HeroesURL is Blizzard's own hero index — first-party, and the provenance
	// heroes.yaml records for the last hero added by hand.
	HeroesURL = "https://overwatch.blizzard.com/en-us/heroes/"
	// PatchNotesURL is the live patch-notes list.
	PatchNotesURL = "https://overwatch.blizzard.com/en-us/news/patch-notes/live/"
	// MapsURL is a community API. Blizzard's own /maps/ page renders its list
	// client-side, so there is no first-party HTML to read; their patch notes
	// announce a new map but cannot say what the full list is, which means a
	// missed week is a missed map with nothing to notice it.
	MapsURL = "https://overfast-api.tekrop.fr/maps"
)

func allowedHost(h string) bool {
	switch h {
	case "overwatch.blizzard.com", "overfast-api.tekrop.fr":
		return true
	}
	return false
}

// NewClient mirrors gamedata.NewUpdateClient — 5 s timeout, HTTPS-only
// redirects, host allowlist, capped chain.
//
// A separate client rather than a reuse: gamedata's allowlist covers GitHub and
// Pages, and widening it to admit Blizzard would loosen an SSRF boundary its
// own tests deliberately pin. Two narrow allowlists beat one wide one.
//
// Only redirects are gated. The initial URL comes from the seams above and is
// never caller-supplied, which is what lets the test seams point at 127.0.0.1.
func NewClient() *http.Client {
	return &http.Client{
		Timeout: requestTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("rosterwatch: stopped after 10 redirects")
			}
			if req.URL.Scheme != "https" {
				return fmt.Errorf("rosterwatch: refusing redirect to non-HTTPS %s", req.URL.Redacted())
			}
			if !allowedHost(req.URL.Hostname()) {
				return fmt.Errorf("rosterwatch: refusing redirect to disallowed host %q", req.URL.Hostname())
			}
			return nil
		},
	}
}

// requestTimeout bounds one fetch. Longer than pkg/gamedata's 5 s because
// Blizzard's hero page is a megabyte of markup served from a CDN, and this
// runs weekly in CI rather than in front of a waiting user.
const requestTimeout = 15 * time.Second

// maxBody caps a response read. The hero page is ~1 MB of markup; 8 MiB is
// generous for it and still refuses a hostile stream.
const maxBody = 8 << 20

func getBytes(client *http.Client, url string) ([]byte, error) {
	// The client's own Timeout bounds the whole request; the context is here
	// because a request without one cannot be canceled by a future caller.
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("rosterwatch: build request for %s: %w", url, err)
	}
	// Blizzard serves a challenge page to an empty User-Agent. Naming the tool
	// is also the courteous thing to do to a source we do not own.
	req.Header.Set("User-Agent", "recall-roster-watch (+https://github.com/sound-barrier/recall)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("rosterwatch: get %s: %w", url, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("rosterwatch: get %s: status %d", url, resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return nil, fmt.Errorf("rosterwatch: read %s: %w", url, err)
	}
	return b, nil
}

// unescape turns the handful of HTML entities Blizzard's roster names actually
// carry back into the runes heroes.yaml stores. strings.NewReplacer rather than
// html.UnescapeString so the set is explicit and reviewable — these names are
// about to be proposed as canonical, and a silent mis-decode is precisely the
// class of bug this package exists to prevent.
var unescape = strings.NewReplacer(
	"&amp;", "&", "&#39;", "'", "&rsquo;", "’", "&quot;", `"`,
	"&uacute;", "ú", "&oacute;", "ó", "&ouml;", "ö", "&iacute;", "í",
	"&ccedil;", "ç", "&atilde;", "ã", "&eacute;", "é", "&ndash;", "–",
)
