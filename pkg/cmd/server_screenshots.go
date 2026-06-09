package cmd

import (
	"errors"
	"net/http"
	"strings"

	"recall/pkg/app"
)

// validateScreenshotFilename enforces the OpenAPI constraints on the
// `{filename}` path parameter — minLength/maxLength + the path-
// separator + NUL exclusion. Today the filename never leaves the SQL
// layer (ignored_screenshots row + match_key derivation), so traversal
// characters aren't directly exploitable. But rejecting them at the
// boundary means a future "delete the file from disk" code path
// inherits the constraint by default rather than having to remember
// to re-validate.
//
// Go 1.22's ServeMux URL-decodes wildcard path values before
// `r.PathValue` returns them, so callers receive an already-decoded
// string. We don't decode again — a second PathUnescape would fail
// on any legitimate filename that contains a literal `%` (e.g. one
// the URL-encoder produced as `%25` and the mux already restored).
func validateScreenshotFilename(name string) (string, error) {
	if name == "" {
		return "", errors.New("filename is required")
	}
	if len(name) > 200 {
		return "", errors.New("filename exceeds 200 characters")
	}
	if strings.ContainsAny(name, "/\\\x00") {
		return "", errors.New("filename contains path separators or NUL")
	}
	return name, nil
}

// registerScreenshotRoutes attaches the /api/v1/screenshots/... HTTP
// surface. Currently scoped to the suppress-list backing the
// "Delete forever" affordance:
//
//   - PUT    /api/v1/screenshots/{filename}/ignore   → add to set
//   - DELETE /api/v1/screenshots/{filename}/ignore   → remove from set
//   - GET    /api/v1/screenshots/ignored             → list (filename + ignored_at)
//   - DELETE /api/v1/screenshots/ignored             → bulk truncate
//
// The image-binary handler at `/_screenshot/{filename}` is a separate
// path (predates the /api/v1 prefix), not part of this resource
// family.
func registerScreenshotRoutes(apiMux *http.ServeMux, a *app.App) {
	// PUT: idempotent ignore. Wipes the matching unmatched- /
	// ambiguous- match rows in lockstep so the row disappears from
	// the result set immediately, not just on the next parse.
	apiMux.HandleFunc("PUT /api/v1/screenshots/{filename}/ignore", func(w http.ResponseWriter, r *http.Request) {
		filename, err := validateScreenshotFilename(r.PathValue("filename"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := a.IgnoreScreenshot(filename); err != nil {
			if errors.Is(err, app.ErrIgnoreFilenameRequired) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// DELETE: idempotent un-ignore. 204 even on filenames that
	// weren't ignored — same shape as UnhideMatch.
	apiMux.HandleFunc("DELETE /api/v1/screenshots/{filename}/ignore", func(w http.ResponseWriter, r *http.Request) {
		filename, err := validateScreenshotFilename(r.PathValue("filename"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := a.UnignoreScreenshot(filename); err != nil {
			if errors.Is(err, app.ErrIgnoreFilenameRequired) {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// GET: list ignored filenames + timestamps, most-recently-ignored
	// first. Backs the Settings → Advanced → Manage ignored files
	// panel; also useful for support / curl users.
	apiMux.HandleFunc("GET /api/v1/screenshots/ignored", func(w http.ResponseWriter, r *http.Request) {
		out, err := a.GetIgnoredScreenshots()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, out, nil)
	})

	// DELETE: bulk truncate the suppress list — Settings panel's
	// "Re-enable all" action. Idempotent; 204 even when the list was
	// already empty. The next Parse run re-discovers every file from
	// disk (the on-disk files were never moved).
	apiMux.HandleFunc("DELETE /api/v1/screenshots/ignored", func(w http.ResponseWriter, r *http.Request) {
		if err := a.ClearIgnoredScreenshots(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
