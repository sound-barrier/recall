package cmd

import (
	"encoding/json"
	"net/http"

	"recall/pkg/app"
)

// The player's focus list — `/api/v1/focus…`. One list assembled from the
// two families that feed it: what a coach sent and what the player wrote in
// their own sittings. Writing an item is done where it was authored (a
// sitting's `/focus-items`, or the coach's session); what lives here is
// READING the whole list and moving one item along it.
//
// There is no delete and no deny. A coach's item is live the moment it
// lands, Accept acknowledges it, "Got this" retires it — and nothing here
// removes what was said.

func registerFocusRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/focus", handleListFocus(a))
	apiMux.HandleFunc("PUT /api/v1/focus/{item_id}/status", handleSetFocusItemStatus(a))
}

func handleListFocus(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		items, err := a.FocusList()
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, items, nil)
	}
}

func handleSetFocusItemStatus(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		if writeError(w, r, a.SetFocusItemStatus(r.PathValue("item_id"), body.Status)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
