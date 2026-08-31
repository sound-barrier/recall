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
// surface — the suppress-list backing the Unknown tab's Dismiss, plus
// the failure ledger's read and Retry:
//
//   - PUT    /api/v1/screenshots/{filename}/ignore   → add to set
//   - DELETE /api/v1/screenshots/{filename}/ignore   → remove from set
//   - DELETE /api/v1/screenshots/{filename}/failure  → Retry (delete the failure record)
//   - GET    /api/v1/screenshots/ignored             → list (filename + ignored_at)
//   - DELETE /api/v1/screenshots/ignored             → bulk truncate
//   - GET    /api/v1/screenshots/failed              → the OCR-failure ledger
//
// The image-binary handler at `/_screenshot/{filename}` is a separate
// path (predates the /api/v1 prefix), not part of this resource
// family.
func registerScreenshotRoutes(apiMux *http.ServeMux, a *app.App) {
	// PUT: idempotent ignore. Removes the file's own rows in lockstep,
	// so a match it was the last screenshot of disappears from the
	// result set immediately — and one with siblings survives.
	apiMux.HandleFunc("PUT /api/v1/screenshots/{filename}/ignore", func(w http.ResponseWriter, r *http.Request) {
		filename, err := validateScreenshotFilename(r.PathValue("filename"))
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		if writeError(w, r, a.IgnoreScreenshot(filename),
			errStatus{app.ErrIgnoreFilenameRequired, probInvalidBody}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// DELETE: idempotent un-ignore. 204 even on filenames that
	// weren't ignored — same shape as UnhideMatch.
	apiMux.HandleFunc("DELETE /api/v1/screenshots/{filename}/ignore", func(w http.ResponseWriter, r *http.Request) {
		filename, err := validateScreenshotFilename(r.PathValue("filename"))
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		if writeError(w, r, a.UnignoreScreenshot(filename),
			errStatus{app.ErrIgnoreFilenameRequired, probInvalidBody}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// GET: list ignored filenames + timestamps, most-recently-ignored
	// first. Backs the Settings → Advanced → Manage ignored files
	// panel; also useful for support / curl users.
	apiMux.HandleFunc("GET /api/v1/screenshots/ignored", func(w http.ResponseWriter, r *http.Request) {
		out, err := a.GetIgnoredScreenshots()
		writeJSON(w, r, out, err)
	})

	// DELETE: Retry — the screenshot's failure record is the resource
	// (sibling shape to /ignore; a "failed/{filename}" path would be
	// ambiguous with "{filename}/ignore" under ServeMux precedence),
	// and deleting it resets the attempt count so a parked file
	// re-enters the pending set. 204 even on absent rows, the
	// UnhideMatch shape.
	apiMux.HandleFunc("DELETE /api/v1/screenshots/{filename}/failure", func(w http.ResponseWriter, r *http.Request) {
		filename, err := validateScreenshotFilename(r.PathValue("filename"))
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		if writeError(w, r, a.RetryFailedFile(filename),
			errStatus{app.ErrIgnoreFilenameRequired, probInvalidBody}) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// GET: the OCR-failure ledger backing the Unknown tab's "Failed to
	// read" triage section. Suppression reuses the ignore endpoints
	// above, and a later successful parse clears rows itself.
	apiMux.HandleFunc("GET /api/v1/screenshots/failed", func(w http.ResponseWriter, r *http.Request) {
		out, err := a.GetFailedFiles()
		writeJSON(w, r, out, err)
	})

	// DELETE: bulk truncate the suppress list — Settings panel's
	// "Re-enable all" action. Idempotent; 204 even when the list was
	// already empty. The next Parse run re-discovers every file from
	// disk (the on-disk files were never moved).
	apiMux.HandleFunc("DELETE /api/v1/screenshots/ignored", func(w http.ResponseWriter, r *http.Request) {
		if writeError(w, r, a.ClearIgnoredScreenshots()) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
