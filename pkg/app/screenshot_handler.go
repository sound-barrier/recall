package app

import (
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
)

// ScreenshotHandler serves files from the user's configured screenshots
// directory under the `/_screenshot/<filename>` URL prefix. Wired into
// the Wails AssetServer in pkg/cmd/wails.go so the frontend can render
// <img src="/_screenshot/foo.png"> directly — no base64 round-trip via
// the JS↔Go bridge for what's potentially a multi-MB PNG.
//
// The directory comes from a.settings at REQUEST time, so changing the
// configured path via PickScreenshotsDir() takes effect immediately for
// subsequent image fetches without restarting the server.
func (a *App) ScreenshotHandler() http.Handler {
	const prefix = "/_screenshot/"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, prefix) {
			http.NotFound(w, r)
			return
		}
		name, err := url.PathUnescape(r.URL.Path[len(prefix):])
		if err != nil {
			http.Error(w, "bad name", http.StatusBadRequest)
			return
		}
		// Reject anything that isn't a plain basename — guards against
		// path traversal even though the filenames in source_files are
		// always basenames produced by the parser.
		if name == "" ||
			strings.ContainsAny(name, "/\\") ||
			strings.Contains(name, "..") {
			http.NotFound(w, r)
			return
		}
		dir := a.settings.ScreenshotsDir
		if dir == "" {
			http.NotFound(w, r)
			return
		}
		full := filepath.Join(dir, name)
		// Safety belt: confirm the resolved path is actually inside
		// the configured directory.
		dirAbs, err1 := filepath.Abs(dir)
		fullAbs, err2 := filepath.Abs(full)
		if err1 != nil || err2 != nil || !strings.HasPrefix(fullAbs+string(filepath.Separator), dirAbs+string(filepath.Separator)) {
			http.NotFound(w, r)
			return
		}
		// #nosec G703 -- `full` survived four explicit guards above
		// (no /, no \\, no .., directory inside the configured root)
		// plus the safePathChars regex applied to the ScreenshotsDir
		// at boundary. See pkg/app/screenshot_handler_test.go for the
		// exhaustive coverage of every rejection branch.
		http.ServeFile(w, r, full)
	})
}
