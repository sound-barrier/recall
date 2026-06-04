package cmd

import (
	"errors"
	"net/http"
	"net/url"
	"regexp"

	"recall/pkg/app"
)

// filenamePattern mirrors the OpenAPI `pattern` constraint on the
// /api/v1/screenshots/{filename} path parameter. Conservative
// printable-ASCII set — real OW capture filenames are a subset.
// Pinned by schemathesis's negative_data_rejection check: every
// request the spec considers schema-violating must come back as
// 4xx, not 204.
var filenamePattern = regexp.MustCompile(`^[A-Za-z0-9 _.\-()\[\]]{1,200}$`)

func validateScreenshotFilename(raw string) (string, error) {
	decoded, err := url.PathUnescape(raw)
	if err != nil {
		return "", errors.New("filename URL-decode failed")
	}
	if decoded == "" {
		return "", errors.New("filename is required")
	}
	if !filenamePattern.MatchString(decoded) {
		return "", errors.New("filename contains characters outside [A-Za-z0-9 _.-()\\[\\]]")
	}
	return decoded, nil
}

// registerScreenshotRoutes attaches the /api/v1/screenshots/... HTTP
// surface. Currently scoped to the suppress-list backing the
// "Delete forever" affordance:
//
//   - POST   /api/v1/screenshots/{filename}/ignore   → add to set
//   - DELETE /api/v1/screenshots/{filename}/ignore   → remove from set
//   - GET    /api/v1/screenshots/ignored             → list
//
// The image-binary handler at `/_screenshot/{filename}` is a separate
// path (predates the /api/v1 prefix), not part of this resource
// family.
func registerScreenshotRoutes(apiMux *http.ServeMux, a *app.App) {
	// POST: idempotent ignore. Wipes the matching unmatched- /
	// ambiguous- match rows in lockstep so the row disappears from
	// the result set immediately, not just on the next parse.
	apiMux.HandleFunc("POST /api/v1/screenshots/{filename}/ignore", func(w http.ResponseWriter, r *http.Request) {
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

	// GET: list ignored filenames, sorted. Currently no UI surface
	// in the frontend (debug + future "show ignored" panel); useful
	// for support / curl users.
	apiMux.HandleFunc("GET /api/v1/screenshots/ignored", func(w http.ResponseWriter, r *http.Request) {
		out, err := a.GetIgnoredScreenshots()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, out, nil)
	})
}
