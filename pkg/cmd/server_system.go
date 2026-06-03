package cmd

import (
	"errors"
	"net/http"

	"recall/pkg/app"
)

// registerSystemRoutes attaches the /api/v1/system/... handlers.
// Read-only meta endpoints (version, update-check, data-location,
// reference-data) + two probe endpoints (screenshots-folder and
// tesseract, which return current resolved state without writing)
// + the screenshots-folder reveal action.
//
// Extracted from NewMux to pay down the route-monolith debt
// (TECHNICAL_DEBT.md item 1). Same wire surface.
func registerSystemRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/system/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"version": a.GetVersion()}, nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/update", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.CheckForUpdate(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/data-location", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetDataLocation(), nil)
	})
	// Startup-error surface. Always returns 200 with a `message`
	// string — empty when boot was clean. The frontend polls this
	// on mount and renders a blocking modal when non-empty. In
	// server mode this is structurally reachable but practically
	// unreachable: RunServer log.Fatal's before mounting routes if
	// StartupError() is non-nil, so a non-empty response is only
	// possible if someone wires the App differently (e.g. tests).
	apiMux.HandleFunc("GET /api/v1/system/startup-error", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"message": a.GetStartupError()}, nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/reference-data", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetOWData(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/screenshots-folder-probe", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.ProbeScreenshotsDir(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/tesseract-probe", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.ProbeTesseractBinary(), nil)
	})
	// Reveal: open the configured screenshots folder in the host OS
	// file manager. Action-style POST — no resource state change, the
	// effect (a Finder / Explorer / xdg-open window appearing) is
	// out-of-band relative to the HTTP response.
	apiMux.HandleFunc("POST /api/v1/system/screenshots-folder-reveal", func(w http.ResponseWriter, r *http.Request) {
		if err := a.RevealScreenshotsDir(); err != nil {
			// 409: no screenshots directory configured. Same shape as
			// POST /api/v1/parses.
			if errors.Is(err, app.ErrInvalidScreenshotsDir) {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})
}
