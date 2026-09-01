package cmd

import (
	"encoding/json"
	"errors"
	"net/http"

	"recall/pkg/app"
	"recall/pkg/db"
)

// The saved roster — `/api/v1/roster…`. The BattleTag is the identity and
// therefore the path segment; the body carries only what can change.
//
// Deliberately NOT under /matches: a roster entry is about a person, not about
// a match, and nothing here is keyed on one.

func registerRosterRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("GET /api/v1/roster", handleListRoster(a))
	apiMux.HandleFunc("PUT /api/v1/roster/{tag}", handleSaveRosterMember(a))
	apiMux.HandleFunc("DELETE /api/v1/roster/{tag}", handleDeleteRosterMember(a))
}

func handleListRoster(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		members, err := a.Roster()
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, members, nil)
	}
}

func handleSaveRosterMember(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			DisplayName string `json:"display_name"`
			Note        string `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		// The tag comes from the path, never the body: two spellings of one
		// identity in one request is a question with no right answer.
		member := db.RosterMember{
			Tag:         r.PathValue("tag"),
			DisplayName: body.DisplayName,
			Note:        body.Note,
		}
		err := a.SaveRosterMember(member)
		if errors.Is(err, app.ErrRosterTagEmpty) {
			writeProblem(w, r, probInvalidBody, "a teammate needs a tag")
			return
		}
		if writeError(w, r, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleDeleteRosterMember(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if writeError(w, r, a.RemoveRosterMember(r.PathValue("tag"))) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
