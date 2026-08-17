// Package screenshot serves the on-disk screenshot bytes behind the
// match history's image previews, and picks which of a match's source
// files to show as its thumbnail.
//
// Both entry points take a DirResolver rather than a store or an app
// handle: turning a screenshots_dirs row id into a directory needs the
// shell's store and its live settings, and nothing else in here does.
// What is left is URL parsing, the path-injection guards, one
// http.ServeFile, and a directory listing — all of it reachable from a
// fuzz target with nothing to construct.
package screenshot

import (
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
)

// DirResolver maps a screenshots_dirs row id to an on-disk directory.
// "" means "no directory" — Handler 404s, AttachThumbnails skips.
//
// Dir-id 0 is the "use the currently-configured screenshots folder"
// sentinel: a file sitting in the watched folder that no parse has read
// yet has no row and no FK, so the frontend sends 0 for it. Resolving
// that, and resolving an id whose row is gone, is the caller's business.
type DirResolver func(dirID int64) string

// Handler serves the on-disk screenshot bytes under
//
//	/_screenshot/<dir-id>/<filename>
//
// where <dir-id> is a screenshots_dirs row id and <filename> is the
// basename of the captured PNG. The handler hands the id to resolve and
// joins the answer with the basename to produce the absolute path to
// serve. Wired into the Wails AssetServer in pkg/cmd/wails.go so the
// frontend can render <img src="/_screenshot/3/foo.png"> directly — no
// base64 round-trip through the JS↔Go bridge for what's potentially a
// multi-MB PNG.
//
// Why dir-id in the URL: each match.Record ships a SourceDirIDs
// (filename → dir-id) map populated from the FK on each parent row, so
// the URL always points at the directory the screenshot was INGESTED
// from.
//
// Path-injection guards run AFTER the resolve so a resolved directory
// goes through the same basename + abs-path containment checks the
// fallback directory does. They and the http.ServeFile they protect are
// deliberately in one file: a sanitizer separated from its sink is one
// refactor away from being reordered out of the way.
//
// Pre-1.0 break: the URL shape changed from `/_screenshot/<filename>`
// to `/_screenshot/<dir-id>/<filename>`. Old URLs return 404.
func Handler(resolve DirResolver) http.Handler {
	const prefix = "/_screenshot/"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, prefix) {
			http.NotFound(w, r)
			return
		}
		// RFC 9110 requires 405 + Allow for unsupported methods on a
		// known path. The handler only ever serves image bytes, so
		// any verb other than GET / HEAD returns 405. Pinned by the
		// schemathesis `unsupported_method` check.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		full, ok := resolvePath(w, r, r.URL.Path[len(prefix):], resolve)
		if !ok {
			return
		}
		// #nosec G703 -- `full` survived the four explicit guards in
		// resolvePath, immediately below in this file (no /, no \\,
		// no .., directory inside the resolved root) plus the
		// safePathChars regex the shell applies to ScreenshotsDir at
		// the boundary, AND a DirResolver only returns paths the app
		// itself wrote to screenshots_dirs (also through that regex).
		// See handler_test.go for the exhaustive coverage of every
		// rejection branch, and fuzz_test.go for the invariant that no
		// 200 ever carries bytes from outside the resolved directory.
		http.ServeFile(w, r, full)
	})
}

// resolvePath parses `<dir-id>/<basename>` out of the URL tail, validates
// the basename against path traversal, resolves the on-disk directory,
// and returns the absolute file path. On any failure it has already
// written the 4xx response and returns ok=false.
func resolvePath(w http.ResponseWriter, r *http.Request, rest string, resolve DirResolver) (string, bool) {
	// Split on the FIRST `/` only — anything after is the (possibly
	// URL-encoded) basename. Anything before is the dir-id segment.
	slash := strings.IndexByte(rest, '/')
	if slash <= 0 {
		http.NotFound(w, r)
		return "", false
	}
	dirSeg := rest[:slash]
	nameSeg := rest[slash+1:]

	// dirSeg must parse as a non-negative int64. Zero is the "use the
	// configured dir" sentinel; positive values index screenshots_dirs.
	dirID, perr := strconv.ParseInt(dirSeg, 10, 64)
	if perr != nil || dirID < 0 {
		http.NotFound(w, r)
		return "", false
	}

	name, err := url.PathUnescape(nameSeg)
	if err != nil {
		http.Error(w, "bad name", http.StatusBadRequest)
		return "", false
	}
	if !ValidBasename(name) {
		http.NotFound(w, r)
		return "", false
	}

	dir := resolve(dirID)
	if dir == "" {
		http.NotFound(w, r)
		return "", false
	}
	full := filepath.Join(dir, name)
	// Safety belt: confirm the resolved path is actually inside the
	// source directory — whichever branch supplied it. CodeQL flagged
	// this file before; both code paths clear the same containment gate.
	if !WithinDir(dir, full) {
		http.NotFound(w, r)
		return "", false
	}
	return full, true
}

// ValidBasename reports whether name is a plain basename — the guard
// against path traversal, even though the filenames in source_files are
// always basenames produced by the parser. It runs BEFORE the directory
// is resolved so an attacker can't trigger a DB query with a poisoned
// name.
//
// Also caps filename length at 255 bytes (the POSIX NAME_MAX floor;
// ext4/NTFS/HFS+ all enforce ≤255 octets) so an overlong path doesn't
// escape the 4xx routing into a downstream os.Open "file name too
// long" 5xx. Pinned by FuzzValidBasename_AcceptedNameStaysInsideDir in
// fuzz_test.go.
func ValidBasename(name string) bool {
	return name != "" &&
		len(name) <= 255 &&
		!strings.ContainsAny(name, "/\\") &&
		!strings.Contains(name, "..")
}

// WithinDir reports whether full resolves inside dir once both are made
// absolute — the shared containment gate for every resolved directory.
func WithinDir(dir, full string) bool {
	dirAbs, err1 := filepath.Abs(dir)
	fullAbs, err2 := filepath.Abs(full)
	return err1 == nil && err2 == nil &&
		strings.HasPrefix(fullAbs+string(filepath.Separator), dirAbs+string(filepath.Separator))
}
