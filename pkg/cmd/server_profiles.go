package cmd

import (
	"encoding/json"
	"errors"
	"net/http"

	"recall/pkg/app"
	"recall/pkg/applog"
)

// registerProfileRoutes attaches every /api/v1/profiles/... handler
// to apiMux. Multiple-profile support: main + alt accounts get
// separate SQLite DBs + settings under <base>/profiles/<name>/.
// GET lists what's known + which is active; POST creates and
// activates a new profile in one shot (typical UX flow); PUT
// /active switches; PUT /{name} renames; DELETE drops a non-
// active profile and wipes its dir.
func registerProfileRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/profiles", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, a.GetProfiles(), nil)
	})
	apiMux.HandleFunc("POST /api/v1/profiles", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.CreateProfile(body.Name); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidProfileName):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			case errors.Is(err, app.ErrProfileExists):
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Content-Type MUST be set before WriteHeader — once the
		// status line is on the wire, header mutations are no-ops
		// and the body would be served as text/plain (the default
		// inferred from the response bytes). writeJSON sets the
		// header on its own but only works when the status is the
		// implicit 200; for 201 / 202 / etc. we have to thread it
		// here manually.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		if encErr := json.NewEncoder(w).Encode(a.GetProfiles()); encErr != nil {
			applog.Subsystem("server").Error("json encode", "err", encErr)
		}
	})
	apiMux.HandleFunc("PUT /api/v1/profiles/active", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.SwitchProfile(body.Name); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidProfileName):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			case errors.Is(err, app.ErrProfileNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, a.GetProfiles(), nil)
	})
	// Explicit 405 stubs for `/profiles/active`. Without these,
	// `GET / POST / DELETE /api/v1/profiles/active` route to
	// `{name}` and try to operate on a profile literally named
	// "active". Same collision pattern as `/matches/transfers`.
	apiMux.HandleFunc("GET /api/v1/profiles/active", methodNotAllowed("PUT"))
	apiMux.HandleFunc("POST /api/v1/profiles/active", methodNotAllowed("PUT"))
	apiMux.HandleFunc("DELETE /api/v1/profiles/active", methodNotAllowed("PUT"))
	apiMux.HandleFunc("PUT /api/v1/profiles/{name}", func(w http.ResponseWriter, r *http.Request) {
		old := r.PathValue("name")
		if old == "" {
			http.Error(w, "name required in URL", http.StatusBadRequest)
			return
		}
		var body struct {
			NewName string `json:"new_name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if err := a.RenameProfile(old, body.NewName); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidProfileName):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			case errors.Is(err, app.ErrProfileNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			case errors.Is(err, app.ErrProfileExists):
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, a.GetProfiles(), nil)
	})
	apiMux.HandleFunc("DELETE /api/v1/profiles/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if name == "" {
			http.Error(w, "name required in URL", http.StatusBadRequest)
			return
		}
		if err := a.DeleteProfile(name); err != nil {
			switch {
			case errors.Is(err, app.ErrInvalidProfileName):
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			case errors.Is(err, app.ErrProfileNotFound):
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			case errors.Is(err, app.ErrProfileActive):
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
