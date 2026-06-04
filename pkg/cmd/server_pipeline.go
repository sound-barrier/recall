package cmd

import (
	"errors"
	"net/http"

	"recall/pkg/app"
)

// registerPipelineRoutes attaches the parse-trigger + screenshot-
// inventory endpoints. The parse pipeline is the active half of
// ingest (POST /parses kicks off a synchronous run); the pending-
// count is the passive half (how many .png files in the watched
// folder are not yet in the per-screenshot-type tables). Kept
// together because they share the same underlying state machine
// (a.ParseScreenshots writes to the tables that
// a.GetNewScreenshotCount reads from).
func registerPipelineRoutes(apiMux *http.ServeMux, a *app.App) {
	// Kicks off a synchronous parse run. Returns 202 Accepted because
	// the meaningful side-effect is the SQLite writes + SSE broadcast,
	// not the HTTP response body. Clients should subscribe to
	// /api/v1/events for progress and re-fetch /api/v1/matches when done.
	apiMux.HandleFunc("POST /api/v1/parses", func(w http.ResponseWriter, r *http.Request) {
		if err := a.ParseScreenshots(); err != nil {
			// 409: the parse action can't proceed because the resource
			// state (no screenshots directory configured / readable) is
			// incompatible. Not 400 — the request itself was well-formed,
			// it's the server's runtime state that conflicts.
			if errors.Is(err, app.ErrInvalidScreenshotsDir) {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	// Cancel an in-flight parse. Modelled as a DELETE on the
	// "active parse" sub-resource so the URL stays a noun. 202
	// Accepted because the actual stop lands at the next
	// between-files boundary in the OCR loop, not synchronously
	// with this response. 409 when no parse is running — same shape
	// as POST /api/v1/parses for "the request was fine, the state
	// isn't".
	apiMux.HandleFunc("DELETE /api/v1/parses/active", func(w http.ResponseWriter, r *http.Request) {
		if err := a.CancelParse(); err != nil {
			if errors.Is(err, app.ErrNoParseInFlight) {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	apiMux.HandleFunc("GET /api/v1/screenshots/pending-count", func(w http.ResponseWriter, r *http.Request) {
		count, err := a.GetNewScreenshotCount()
		writeJSON(w, map[string]int{"count": count}, err)
	})
}
