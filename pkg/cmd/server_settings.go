package cmd

import (
	"encoding/json"
	"errors"
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
	apiMux.HandleFunc("GET /api/v1/settings/screenshots-folder", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"path": a.GetScreenshotsDir()}, nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/screenshots-folder", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
			http.Error(w, "body must be {\"path\":\"...\"}", http.StatusBadRequest)
			return
		}
		if err := a.SetScreenshotsDir(body.Path); err != nil {
			// 409: path was syntactically well-formed but doesn't exist
			// as a directory on disk. The semantic is "the resource at
			// this path isn't available," which is a state conflict.
			if errors.Is(err, app.ErrInvalidScreenshotsDir) {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]string{"path": body.Path}, nil)
	})
	// DELETE clears the persisted screenshots folder. Symmetric with
	// DELETE /api/v1/settings/tesseract — "the user-set override is
	// the thing being deleted." There's no platform default to fall
	// back to here (unlike tesseract); the natural empty state is
	// "no folder configured" and the user re-picks via Detect /
	// Change. The frontend's Reset button is the only caller.
	apiMux.HandleFunc("DELETE /api/v1/settings/screenshots-folder", func(w http.ResponseWriter, r *http.Request) {
		if err := a.ResetScreenshotsDir(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	apiMux.HandleFunc("GET /api/v1/settings/tesseract", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetTesseractStatus(), nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/tesseract", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Path string `json:"path"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Path == "" {
			http.Error(w, "body must be {\"path\":\"...\"}", http.StatusBadRequest)
			return
		}
		st, err := a.SetTesseractPath(body.Path)
		if err != nil {
			// 409: path was syntactically well-formed but doesn't
			// resolve to a tesseract binary. Same shape as
			// PUT /api/v1/settings/screenshots-folder.
			if errors.Is(err, app.ErrInvalidTesseractPath) {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, st, nil)
	})
	// DELETE resets the configured path back to the platform default —
	// the only "absent" state the field can have, modeled as removing
	// the user-set override.
	apiMux.HandleFunc("DELETE /api/v1/settings/tesseract", func(w http.ResponseWriter, r *http.Request) {
		st, err := a.ResetTesseractPath()
		writeJSON(w, st, err)
	})

	apiMux.HandleFunc("GET /api/v1/settings/prometheus", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"enabled": a.GetPrometheusEnabled()}, nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/prometheus", func(w http.ResponseWriter, r *http.Request) {
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
		if err := a.SetPrometheusEnabled(*body.Enabled); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	apiMux.HandleFunc("GET /api/v1/settings/watcher", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"enabled": a.GetWatchEnabled()}, nil)
	})
	apiMux.HandleFunc("PUT /api/v1/settings/watcher", func(w http.ResponseWriter, r *http.Request) {
		// `*bool` — see the prometheus / visibility handlers' comments.
		// Pinned by TestWatchEnabled_RejectsNull.
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Enabled == nil {
			http.Error(w, "body must be {\"enabled\":<bool>}", http.StatusBadRequest)
			return
		}
		if err := a.SetWatchEnabled(*body.Enabled); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
