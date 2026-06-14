package cmd

import (
	"encoding/json"
	"net/http"

	"recall/pkg/app"
)

// registerSettingsRoutes attaches every /api/v1/settings/...
// handler. Four user-facing settings: screenshots-folder,
// tesseract path, prometheus-enabled, watcher-enabled. The
// screenshots-folder + tesseract pair carry a 409 conflict status
// for "syntactically well-formed input but the path doesn't
// resolve to a usable resource on disk." The boolean toggles
// require `*bool` body shape so missing / null is distinguishable
// from `false` (pinned by TestPrometheusEnabled_RejectsNull +
// TestWatchEnabled_RejectsNull).
func registerSettingsRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/settings/screenshots-folder", handleGetScreenshotsFolder(a))
	apiMux.HandleFunc("PUT /api/v1/settings/screenshots-folder", handleSetScreenshotsFolder(a))
	apiMux.HandleFunc("DELETE /api/v1/settings/screenshots-folder", handleResetScreenshotsFolder(a))

	apiMux.HandleFunc("GET /api/v1/settings/tesseract", handleGetTesseract(a))
	apiMux.HandleFunc("PUT /api/v1/settings/tesseract", handleSetTesseract(a))
	apiMux.HandleFunc("DELETE /api/v1/settings/tesseract", handleResetTesseract(a))

	apiMux.HandleFunc("GET /api/v1/settings/prometheus", handleGetPrometheus(a))
	apiMux.HandleFunc("PUT /api/v1/settings/prometheus", handleSetPrometheus(a))

	apiMux.HandleFunc("GET /api/v1/settings/watcher", handleGetWatcher(a))
	apiMux.HandleFunc("PUT /api/v1/settings/watcher", handleSetWatcher(a))
}

func handleGetScreenshotsFolder(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]string{"path": a.GetScreenshotsDir()}, nil)
	}
}

func handleSetScreenshotsFolder(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path, err := decodeRequiredString(r, "path")
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		// 409: path was syntactically well-formed but doesn't exist as a
		// directory on disk — "the resource at this path isn't available,"
		// a state conflict.
		if writeError(w, a.SetScreenshotsDir(path),
			errStatus{app.ErrInvalidScreenshotsDir, http.StatusConflict}) {
			return
		}
		writeJSON(w, map[string]string{"path": path}, nil)
	}
}

// handleResetScreenshotsFolder clears the persisted screenshots folder.
// Symmetric with DELETE /api/v1/settings/tesseract — "the user-set
// override is the thing being deleted." There's no platform default to
// fall back to here (unlike tesseract); the natural empty state is "no
// folder configured" and the user re-picks via Detect / Change. The
// frontend's Reset button is the only caller.
func handleResetScreenshotsFolder(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		if writeError(w, a.ResetScreenshotsDir()) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetTesseract(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, a.GetTesseractStatus(), nil)
	}
}

func handleSetTesseract(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path, err := decodeRequiredString(r, "path")
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		st, err := a.SetTesseractPath(path)
		// 409: path was syntactically well-formed but doesn't resolve to a
		// tesseract binary. Same shape as PUT /settings/screenshots-folder.
		if writeError(w, err, errStatus{app.ErrInvalidTesseractPath, http.StatusConflict}) {
			return
		}
		writeJSON(w, st, nil)
	}
}

// handleResetTesseract resets the configured path back to the platform
// default — the only "absent" state the field can have, modeled as
// removing the user-set override.
func handleResetTesseract(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		st, err := a.ResetTesseractPath()
		writeJSON(w, st, err)
	}
}

func handleGetPrometheus(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]bool{"enabled": a.GetPrometheusEnabled()}, nil)
	}
}

func handleSetPrometheus(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// `*bool` so missing / null decodes to nil — see the visibility
		// handler's comment for the rationale (Pinned by
		// TestPrometheusEnabled_RejectsNull).
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Enabled == nil {
			http.Error(w, "body must be {\"enabled\":<bool>}", http.StatusBadRequest)
			return
		}
		if writeError(w, a.SetPrometheusEnabled(*body.Enabled)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetWatcher(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, map[string]bool{"enabled": a.GetWatchEnabled()}, nil)
	}
}

func handleSetWatcher(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// `*bool` — see the prometheus / visibility handlers' comments.
		// Pinned by TestWatchEnabled_RejectsNull.
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Enabled == nil {
			http.Error(w, "body must be {\"enabled\":<bool>}", http.StatusBadRequest)
			return
		}
		if writeError(w, a.SetWatchEnabled(*body.Enabled)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
