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
func registerSystemRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/system/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, map[string]string{"version": a.GetVersion()}, nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/update", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, a.CheckForUpdate(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/data-location", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, a.GetDataLocation(), nil)
	})
	// Startup-error surface. Always returns 200 with a `message`
	// string — empty when boot was clean. The frontend polls this
	// on mount and renders a blocking modal when non-empty. In
	// server mode this is structurally reachable but practically
	// unreachable: RunServer log.Fatal's before mounting routes if
	// StartupError() is non-nil, so a non-empty response is only
	// possible if someone wires the App differently (e.g. tests).
	apiMux.HandleFunc("GET /api/v1/system/startup-error", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, map[string]string{"message": a.GetStartupError()}, nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/reference-data", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, a.GetOWData(), nil)
	})
	// Per-source picker — Windows-only auto-detection of the four
	// canonical capture methods (Nvidia Overlay, OW PrntScn default,
	// Win Snip tool, Steam install). Returns an empty array on macOS
	// / Linux so the frontend can hide the grid. Each entry carries
	// (name, label, path, exists) so the first-run picker grid can
	// render every option with a found/not-found status dot without
	// a second round-trip.
	apiMux.HandleFunc("GET /api/v1/system/screenshots-folder-candidates", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, a.ProbeScreenshotsCandidates(), nil)
	})
	// Per-source diagnostic stats — the picker grid fetches this AFTER
	// the cards mount so the directory walk doesn't block the visible
	// UI. Each entry's file_count / last_modified / recognised_count
	// reads at a glance: "47 files · 2h ago" vs "0 files" vs "12 files
	// · 0 recognised" (the last one tells the user the folder isn't
	// the right source). Bounded to 1000 entries per source so a
	// synced cloud folder doesn't spin forever.
	apiMux.HandleFunc("GET /api/v1/system/screenshots-folder-candidates/stats", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, a.ProbeScreenshotsCandidateStats(), nil)
	})
	apiMux.HandleFunc("GET /api/v1/system/tesseract-probe", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, a.ProbeTesseractBinary(), nil)
	})
	// Reveal: open the configured screenshots folder in the host OS
	// file manager. Action-style POST — no resource state change, the
	// effect (a Finder / Explorer / xdg-open window appearing) is
	// out-of-band relative to the HTTP response.
	apiMux.HandleFunc("POST /api/v1/system/screenshots-folder-reveal", func(w http.ResponseWriter, r *http.Request) {
		// 409: no screenshots directory configured. Same shape as
		// POST /api/v1/parses.
		if writeError(w, r, a.RevealScreenshotsDir(),
			errStatus{app.ErrInvalidScreenshotsDir, probConflict}) {
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})
	// Apply data update: download + SHA-256 verify + atomically swap
	// the parser's game data (heroes / maps / screenshot sources)
	// from the Pages-published main channel. POST because it
	// triggers a side-effect that doesn't map to a single resource.
	// No body — the channel and target are implicit.
	apiMux.HandleFunc("POST /api/v1/system/data-update", func(w http.ResponseWriter, r *http.Request) {
		got, err := a.ApplyGameDataUpdate()
		var checksumErr *app.ChecksumError
		if errors.As(err, &checksumErr) {
			writeProblem(w, r, probDataVerify, checksumErr.Error(),
				withFailedAssets(checksumErr.Asset))
			return
		}
		if writeError(w, r, err,
			errStatus{app.ErrDataUpdateChecksum, probDataVerify},
			errStatus{app.ErrDataUpdateMainFetchFailed, probBadGateway}) {
			return
		}
		writeJSON(w, r, got, nil)
	})
}
