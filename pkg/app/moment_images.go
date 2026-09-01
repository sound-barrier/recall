package app

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

// The images a moment points at: stored by the app, served back by it.
//
// Every other picture Recall shows is a file already sitting in the folder the
// user pointed at, handed back by pkg/screenshot after two containment checks.
// These are different in kind — the app owns them — and that makes the serving
// side SIMPLER rather than harder: the URL carries a content digest, not a
// path, so there is no directory to escape and nothing to resolve. The only
// question is whether the digest is a digest.

// maxMomentImageBytes caps one attachment.
//
// An Overwatch screenshot at 1440p lands around 2–4 MB; eight is room for a
// large one without being room for a video. The cap is enforced at the HTTP
// boundary too (see maxBodyForPath) — this is the one the store answers to, so
// a Wails call that never crosses that boundary is held to the same limit.
const maxMomentImageBytes = 8 << 20

// hexDigest is what a sha256 content address looks like. Anything else never
// reaches the store: a digest is generated, so a malformed one is a bug or a
// probe, and either way there is nothing to look up.
var hexDigest = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ErrImageTooLarge is returned for bytes past maxMomentImageBytes.
var ErrImageTooLarge = errors.New("image too large")

// ValidMomentImageDigest reports whether a string could name a stored image.
func ValidMomentImageDigest(sha string) bool { return hexDigest.MatchString(sha) }

// PutMomentImage stores an attachment and returns its content address.
func (a *App) PutMomentImage(raw []byte, mime string) (string, error) {
	if len(raw) > maxMomentImageBytes {
		return "", fmt.Errorf("%w: %d bytes", ErrImageTooLarge, len(raw))
	}
	sha, err := a.store.PutMomentImage(raw, mime)
	if err != nil {
		return "", err
	}
	return sha, nil
}

// PruneMomentImages collects attachment bytes nothing points at any more.
//
// Called after anything that can drop a moment. It is a sweep rather than a
// refcount because three of the four referring tables are CASCADE-deleted
// children of a note: the rows stop pointing without anyone telling this
// table, which is exactly the trade that keeps deleting a note one step.
func (a *App) PruneMomentImages() (int, error) { return a.store.PruneOrphanMomentImages() }

// MomentImageHandler serves `/_moment-image/<sha256>`.
//
// GET and HEAD only, like the screenshot handler — and for the same reason:
// anything else is a spec-visible method the fuzzer will try, and answering it
// with a 405 plus an Allow header is the difference between a documented
// surface and a surprise.
func (a *App) MomentImageHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		sha := strings.TrimPrefix(r.URL.Path, momentImagePrefix)
		if !ValidMomentImageDigest(sha) {
			http.NotFound(w, r)
			return
		}
		img, ok, err := a.store.LoadMomentImage(sha)
		if err != nil {
			http.Error(w, "read image", http.StatusInternalServerError)
			return
		}
		if !ok {
			// A moment can outlive its picture. That renders as a missing
			// image, which is what a 404 already means.
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", img.MIME)
		// Content-addressed, so the bytes behind a URL can never change:
		// immutable is not a guess here, it is the naming scheme.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		if _, err := w.Write(img.Bytes); err != nil {
			return
		}
	}
}

// momentImagePrefix is the mount path, shared by the server mux and the Wails
// asset middleware so the two cannot drift.
const momentImagePrefix = "/_moment-image/"

// MomentImagePrefix is the URL space attachments are served from.
func MomentImagePrefix() string { return momentImagePrefix }
