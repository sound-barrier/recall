package cmd

import (
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
	// Kicks off a parse run in a BACKGROUND goroutine and returns 202
	// Accepted immediately — the request is NOT held open for the
	// multi-minute OCR loop. Progress + completion reach the client over
	// /api/v1/events (parse-progress / parse-complete); GET
	// /api/v1/parses/active is the resync anchor for a reconnecting or
	// reloading client. This is what makes a run survive a client
	// network drop: there's no long-lived request to lose.
	apiMux.HandleFunc("POST /api/v1/parses", func(w http.ResponseWriter, r *http.Request) {
		// `?scope=all` switches to ReParseAll — re-runs OCR on every
		// PNG in the watched folder regardless of whether it's
		// already in the per-type tables. The user-curated suppress
		// list is still honoured. Any other value (or absence)
		// invokes the default "parse only new files" semantic.
		// Unknown query keys yield 400 to stay schemathesis-clean.
		force := false
		for k, vs := range r.URL.Query() {
			if k != "scope" {
				writeProblem(w, r, probInvalidBody, "unknown query parameter: "+k)
				return
			}
			switch vs[0] {
			case "all":
				force = true
			case "new", "":
				// default semantic; force stays false
			default:
				writeProblem(w, r, probInvalidBody, "scope must be 'all' or 'new'")
				return
			}
		}
		// Validates preconditions + single-flight synchronously (so the
		// caller still gets a 409/500 before the 202), then spawns the
		// run and returns.
		// 409: the request was well-formed but the server's runtime state
		// conflicts — no/unreadable screenshots dir, or a parse is already
		// in flight. Not 400 (the bytes parsed fine).
		if writeError(w, r, a.StartParse(force),
			errStatus{app.ErrInvalidScreenshotsDir, probConflict},
			errStatus{app.ErrParseInFlight, probConflict}) {
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	// Status snapshot for the active parse — the resync anchor. SSE
	// doesn't replay, so a client that reconnects (or reloads) mid-parse
	// reads this to restore "is a parse running, and how far along".
	apiMux.HandleFunc("GET /api/v1/parses/active", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, a.ActiveParse(), nil)
	})

	// Cancel an in-flight parse. Modelled as a DELETE on the
	// "active parse" sub-resource so the URL stays a noun. 202
	// Accepted because the actual stop lands at the next
	// between-files boundary in the OCR loop, not synchronously
	// with this response. 409 when no parse is running — same shape
	// as POST /api/v1/parses for "the request was fine, the state
	// isn't".
	apiMux.HandleFunc("DELETE /api/v1/parses/active", func(w http.ResponseWriter, r *http.Request) {
		if writeError(w, r, a.CancelParse(),
			errStatus{app.ErrNoParseInFlight, probConflict}) {
			return
		}
		w.WriteHeader(http.StatusAccepted)
	})

	apiMux.HandleFunc("GET /api/v1/screenshots/pending-count", func(w http.ResponseWriter, r *http.Request) {
		count, err := a.GetNewScreenshotCount()
		writeJSON(w, r, map[string]int{"count": count}, err)
	})
}
