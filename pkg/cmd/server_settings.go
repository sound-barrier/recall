package cmd

import (
	"encoding/json"
	"net/http"

	"recall/pkg/app"
)

// registerSettingsRoutes attaches every /api/v1/settings/...
// handler. Four user-facing settings: screenshots-folder,
// tesseract path, watcher-enabled, close-behavior. The screenshots-folder +
// tesseract pair carry a 409 conflict status for "syntactically
// well-formed input but the path doesn't resolve to a usable
// resource on disk." The watcher + close-behavior toggles require a `*bool`
// body shape so missing / null is distinguishable from `false` (pinned by
// TestWatchEnabled_RejectsNull).
func registerSettingsRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/settings/screenshots-folder", handleGetScreenshotsFolder(a))
	apiMux.HandleFunc("PUT /api/v1/settings/screenshots-folder", handleSetScreenshotsFolder(a))
	apiMux.HandleFunc("DELETE /api/v1/settings/screenshots-folder", handleResetScreenshotsFolder(a))

	apiMux.HandleFunc("GET /api/v1/settings/tesseract", handleGetTesseract(a))
	apiMux.HandleFunc("PUT /api/v1/settings/tesseract", handleSetTesseract(a))
	apiMux.HandleFunc("DELETE /api/v1/settings/tesseract", handleResetTesseract(a))

	apiMux.HandleFunc("GET /api/v1/settings/watcher", handleGetWatcher(a))
	apiMux.HandleFunc("PUT /api/v1/settings/watcher", handleSetWatcher(a))

	apiMux.HandleFunc("GET /api/v1/settings/close-behavior", handleGetCloseBehavior(a))
	apiMux.HandleFunc("PUT /api/v1/settings/close-behavior", handleSetCloseBehavior(a))
}

func handleGetScreenshotsFolder(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, map[string]string{"path": a.GetScreenshotsDir()}, nil)
	}
}

func handleSetScreenshotsFolder(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path, err := decodeRequiredString(r, "path")
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		// 409: path was syntactically well-formed but doesn't exist as a
		// directory on disk — "the resource at this path isn't available,"
		// a state conflict.
		if writeError(w, r, a.SetScreenshotsDir(path),
			errStatus{app.ErrInvalidScreenshotsDir, probConflict}) {
			return
		}
		writeJSON(w, r, map[string]string{"path": path}, nil)
	}
}

// handleResetScreenshotsFolder clears the persisted screenshots folder.
// Symmetric with DELETE /api/v1/settings/tesseract — "the user-set
// override is the thing being deleted." There's no platform default to
// fall back to here (unlike tesseract); the natural empty state is "no
// folder configured" and the user re-picks via Detect / Change. The
// frontend's Reset button is the only caller.
func handleResetScreenshotsFolder(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if writeError(w, r, a.ResetScreenshotsDir()) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetTesseract(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, a.GetTesseractStatus(), nil)
	}
}

func handleSetTesseract(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path, err := decodeRequiredString(r, "path")
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		st, err := a.SetTesseractPath(path)
		// 409: path was syntactically well-formed but doesn't resolve to a
		// tesseract binary. Same shape as PUT /settings/screenshots-folder.
		if writeError(w, r, err, errStatus{app.ErrInvalidTesseractPath, probConflict}) {
			return
		}
		writeJSON(w, r, st, nil)
	}
}

// handleResetTesseract resets the configured path back to the platform
// default — the only "absent" state the field can have, modeled as
// removing the user-set override.
func handleResetTesseract(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		st, err := a.ResetTesseractPath()
		writeJSON(w, r, st, err)
	}
}

func handleGetWatcher(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, map[string]bool{"enabled": a.GetWatchEnabled()}, nil)
	}
}

func handleSetWatcher(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// `*bool` — see the visibility handler's comment for the rationale.
		// Pinned by TestWatchEnabled_RejectsNull.
		var body struct {
			Enabled *bool `json:"enabled"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Enabled == nil {
			writeProblem(w, r, probInvalidBody, "body must be {\"enabled\":<bool>}")
			return
		}
		if writeError(w, r, a.SetWatchEnabled(*body.Enabled)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetCloseBehavior(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, map[string]bool{"exit_on_close": a.GetExitOnClose()}, nil)
	}
}

func handleSetCloseBehavior(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// `*bool` so a missing / null field is rejected rather than silently
		// treated as false (same rationale as the watcher toggle).
		var body struct {
			ExitOnClose *bool `json:"exit_on_close"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ExitOnClose == nil {
			writeProblem(w, r, probInvalidBody, "body must be {\"exit_on_close\":<bool>}")
			return
		}
		if writeError(w, r, a.SetExitOnClose(*body.ExitOnClose)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
