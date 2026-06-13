package app

import (
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
)

// ScreenshotHandler serves the on-disk screenshot bytes under
//
//	/_screenshot/<dir-id>/<filename>
//
// where <dir-id> is a screenshots_dirs row id and <filename> is the
// basename of the captured PNG. The handler looks up the directory
// via store.LookupScreenshotsDir(<dir-id>) and joins it with the
// basename to produce the absolute path to serve. Wired into the
// Wails AssetServer in pkg/cmd/wails.go so the frontend can render
// <img src="/_screenshot/3/foo.png"> directly — no base64 round-trip
// through the JS↔Go bridge for what's potentially a multi-MB PNG.
//
// Why dir-id in the URL: each MatchRecord ships a SourceDirIDs
// (filename → dir-id) map populated from the FK on each parent row,
// so the URL always points at the directory the screenshot was
// INGESTED from. Files in the watched folder that haven't been
// parsed yet have no row + no FK; for those the frontend sends
// dir-id `0`, and the handler falls back to a.settings.ScreenshotsDir
// (the parse-progress inline preview path).
//
// Path-injection guards run AFTER the lookup so the resolved dir
// goes through the same basename + abs-path containment checks the
// fallback dir does.
//
// Pre-1.0 break: the URL shape changed from `/_screenshot/<filename>`
// to `/_screenshot/<dir-id>/<filename>`. Old URLs return 404.
func (a *App) ScreenshotHandler() http.Handler {
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
		full, ok := a.resolveScreenshotPath(w, r, r.URL.Path[len(prefix):])
		if !ok {
			return
		}
		// #nosec G703 -- `full` survived the four explicit guards in
		// resolveScreenshotPath (no /, no \\, no .., directory inside
		// the source root) plus the safePathChars regex applied to
		// ScreenshotsDir at the boundary, AND the dir-id lookup only
		// returns paths the app itself wrote to screenshots_dirs (also
		// through that regex). See pkg/app/screenshot_handler_test.go
		// for the exhaustive coverage of every rejection branch.
		http.ServeFile(w, r, full)
	})
}

// resolveScreenshotPath parses `<dir-id>/<basename>` out of the URL tail,
// validates the basename against path traversal, resolves the on-disk
// directory, and returns the absolute file path. On any failure it has
// already written the 4xx response and returns ok=false.
func (a *App) resolveScreenshotPath(w http.ResponseWriter, r *http.Request, rest string) (string, bool) {
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
	// Reject anything that isn't a plain basename — guards against path
	// traversal even though the filenames in source_files are always
	// basenames produced by the parser. Runs BEFORE the dir lookup so an
	// attacker can't trigger a DB query with a poisoned name.
	//
	// Also caps filename length at 255 bytes (the POSIX NAME_MAX floor;
	// ext4/NTFS/HFS+ all enforce ≤255 octets) so an overlong path doesn't
	// escape the 4xx routing into a downstream os.Open "file name too
	// long" 5xx. Pinned by FuzzScreenshotHandler_URL in
	// screenshot_handler_fuzz_test.go.
	if name == "" ||
		len(name) > 255 ||
		strings.ContainsAny(name, "/\\") ||
		strings.Contains(name, "..") {
		http.NotFound(w, r)
		return "", false
	}

	dir := a.resolveScreenshotDir(dirID)
	if dir == "" {
		http.NotFound(w, r)
		return "", false
	}
	full := filepath.Join(dir, name)
	// Safety belt: confirm the resolved path is actually inside the
	// source directory — whichever branch supplied it. CodeQL flagged
	// this file before; both code paths clear the same containment gate.
	dirAbs, err1 := filepath.Abs(dir)
	fullAbs, err2 := filepath.Abs(full)
	if err1 != nil || err2 != nil || !strings.HasPrefix(fullAbs+string(filepath.Separator), dirAbs+string(filepath.Separator)) {
		http.NotFound(w, r)
		return "", false
	}
	return full, true
}

// resolveScreenshotDir picks the on-disk directory for a screenshot:
// dir-id > 0 means look it up; dir-id == 0 means use the currently-
// configured screenshots folder (the only path for unparsed files in the
// watched dir). LookupScreenshotsDir returns ("", nil) for unknown ids, so
// the handler falls through to the configured dir — a stale FK from a
// deleted screenshots_dirs row doesn't hard-fail the preview.
func (a *App) resolveScreenshotDir(dirID int64) string {
	if dirID > 0 && a.store != nil {
		if resolved, _ := a.store.LookupScreenshotsDir(dirID); resolved != "" {
			return resolved
		}
	}
	return a.settings.ScreenshotsDir
}
