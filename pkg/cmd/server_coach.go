package cmd

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"slices"
	"strconv"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/match"
)

// The coaching surface, both halves of the loop:
//
//   - the COACH's session — `/api/v1/coach/session…` opens a player's
//     bundle in memory, serves the loaned corpus the six tabs render, and
//     autosaves the coach's notes about it. Nothing here writes the
//     player's matches into the coach's database (design rule 3).
//   - the PLAYER's returns — `/api/v1/coach/returns…` lists the notes
//     archives that came back (staged by POST /api/v1/imports, which tells
//     the two archive kinds apart by their entry names) and records the
//     accept / skip verdict on each note. An accepted note becomes a block
//     on the match, removed one at a time through
//     `DELETE /api/v1/matches/{match_key}/coach-notes/{id}`.
//
// Every 4xx here comes off the central ladder in server.go — the coaching
// sentinels are mapped once in defaultProblems, so a handler states only
// what is peculiar to its own body.

// registerCoachRoutes attaches every coaching route. The per-match
// coach-notes DELETE lives here rather than with the /matches family
// because it belongs to this feature's lifecycle, not to the sidecar
// registry.
func registerCoachRoutes(apiMux *http.ServeMux, a *app.App) {
	apiMux.HandleFunc("POST /api/v1/coach/session", handleOpenCoachSession(a))
	apiMux.HandleFunc("GET /api/v1/coach/session", handleGetCoachSession(a))
	apiMux.HandleFunc("DELETE /api/v1/coach/session", handleCloseCoachSession(a))
	apiMux.HandleFunc("PUT /api/v1/coach/session/player", handleSetCoachSessionPlayer(a))
	apiMux.HandleFunc("GET /api/v1/coach/session/matches", handleGetCoachSessionMatches(a))
	apiMux.HandleFunc("PUT /api/v1/coach/session/notes/{match_key}", handlePutCoachNote(a))
	apiMux.HandleFunc("DELETE /api/v1/coach/session/notes/{match_key}", handleDeleteCoachNote(a))
	apiMux.HandleFunc("PUT /api/v1/coach/session/notes/{match_key}/moments/{moment_id}", handlePutCoachMoment(a))
	apiMux.HandleFunc("DELETE /api/v1/coach/session/notes/{match_key}/moments/{moment_id}", handleDeleteCoachMoment(a))
	apiMux.HandleFunc("PUT /api/v1/coach/session/summary", handlePutCoachSummary(a))
	apiMux.HandleFunc("POST /api/v1/coach/session/export", handleExportCoachNotes(a))

	apiMux.HandleFunc("GET /api/v1/coach/returns", handleListCoachReturns(a))
	apiMux.HandleFunc("GET /api/v1/coach/returns/{id}", handleGetCoachReturn(a))
	apiMux.HandleFunc("DELETE /api/v1/coach/returns/{id}", handleDeleteCoachReturn(a))
	apiMux.HandleFunc("PUT /api/v1/coach/returns/{id}/decisions", handleDecideCoachReturn(a))

	apiMux.HandleFunc("DELETE /api/v1/matches/{match_key}/coach-notes/{id}", handleDeleteMatchCoachNote(a))

	apiMux.HandleFunc("GET /api/v1/settings/coaching", handleGetCoachingSettings(a))
	apiMux.HandleFunc("PUT /api/v1/settings/coaching", handleSetCoachingSettings(a))
}

// handleOpenCoachSession loans a player's exported bundle into memory and
// returns the session view. 201 because the session is a resource this
// request created; a second open is a 409, unreadable bytes a 400.
func handleOpenCoachSession(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload, err := io.ReadAll(io.LimitReader(r.Body, importMaxBodyBytes))
		if err != nil {
			writeProblem(w, r, probInvalidBody, "read body: "+err.Error())
			return
		}
		view, err := a.OpenCoachSession(payload)
		if writeArchiveError(w, r, err) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(view)
	}
}

// handleGetCoachSession serves the open session, hydrated with everything
// the coach has already written about this player. 404 when none is open —
// which is how the frontend's resume flag learns it is stale.
func handleGetCoachSession(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		view, err := a.GetCoachSession()
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, view, nil)
	}
}

// handleCloseCoachSession discards the loaned records. Idempotent: closing
// a session that is already gone is a 204, not a 404.
func handleCloseCoachSession(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if writeError(w, r, a.CloseCoachSession()) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleSetCoachSessionPlayer confirms (or corrects) who the session is
// about and echoes the re-hydrated view — correcting the handle can switch
// to a different player's notes, so the whole view is the answer.
func handleSetCoachSessionPlayer(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handle, err := decodeRequiredString(r, "handle")
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		view, err := a.SetCoachSessionPlayer(handle)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, view, nil)
	}
}

// handleGetCoachSessionMatches serves the loaned corpus — the same
// MatchRecord shape as GET /api/v1/matches, rendered from the bundle
// in memory.
func handleGetCoachSessionMatches(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		records, err := a.GetCoachSessionMatches()
		if writeError(w, r, err) {
			return
		}
		if records == nil {
			records = []match.Record{}
		}
		writeJSON(w, r, records, nil)
	}
}

// handlePutCoachNote saves the coach's one note about one of the session's
// matches — the note editor's autosave target. Returns the saved note so
// the reel can render its minted identity without a re-read.
func handlePutCoachNote(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var in coach.NoteInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		note, err := a.PutCoachNote(matchKey, in)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, note, nil)
	}
}

// handleDeleteCoachNote removes the coach's note about one match — what the
// autosave sends when a draft goes empty. Idempotent.
func handleDeleteCoachNote(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.DeleteCoachNote(matchKey)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handlePutCoachMoment saves one timestamped moment on a match's note. The
// moment id is in the path rather than the body because the client mints it —
// the autosave queue keys on it from the first keystroke, before any round
// trip has happened.
func handlePutCoachMoment(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var in coach.MomentInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		moment, err := a.PutCoachMoment(matchKey, r.PathValue("moment_id"), in)
		// A spec-valid body that says nothing is a 409, not a 400 — the
		// request parsed, the refusal is semantic. Same code ErrEmptyAnnotation
		// answers with, and what keeps schemathesis's positive-data check
		// honest about a body the spec permits.
		if writeError(w, r, err, errStatus{coach.ErrMomentEmpty, probConflict}) {
			return
		}
		writeJSON(w, r, moment, nil)
	}
}

// handleDeleteCoachMoment removes one moment and leaves the note behind.
// Idempotent.
func handleDeleteCoachMoment(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		if writeError(w, r, a.DeleteCoachMoment(matchKey, r.PathValue("moment_id"))) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handlePutCoachSummary saves the one set-level note for the session's
// player ("what to work on"). An empty text clears it, so the field is
// required but may be blank.
func handlePutCoachSummary(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		text, err := decodeStringBody(r, "text")
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		if writeError(w, r, a.PutCoachSummary(text)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleExportCoachNotes streams the archive the coach hands the player:
// notes.json (the machine copy) plus ledger.html (the human copy). POST
// because it assembles a document rather than reading a resource; a session
// with no name set, no confirmed player, or nothing written is a 409.
func handleExportCoachNotes(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name, payload, err := a.ExportCoachNotes()
		if writeError(w, r, err) {
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
		_, _ = w.Write(payload)
	}
}

// handleListCoachReturns renders the player's inbox — every staged notes
// archive, newest first, with each note's derived status.
func handleListCoachReturns(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sheets, err := a.ListCoachReturns()
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, sheets, nil)
	}
}

func handleGetCoachReturn(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := idFromPath(w, r, "return id")
		if !ok {
			return
		}
		sheet, err := a.GetCoachReturn(id)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, sheet, nil)
	}
}

// handleDeleteCoachReturn drops a staged return and its decisions. The
// blocks an earlier accept wrote onto matches stay — they are the player's
// notes now.
func handleDeleteCoachReturn(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := idFromPath(w, r, "return id")
		if !ok {
			return
		}
		if writeError(w, r, a.DeleteCoachReturn(id)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleDecideCoachReturn applies the player's verdicts and echoes the
// recomputed sheet. The body is a PARTIAL map keyed by note_id — the sheet
// is decided one card at a time and an absent note stays pending.
func handleDecideCoachReturn(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := idFromPath(w, r, "return id")
		if !ok {
			return
		}
		decisions, err := decodeDecisions(r)
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		sheet, err := a.DecideCoachReturn(id, decisions)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, sheet, nil)
	}
}

// handleDeleteMatchCoachNote removes one accepted coach block from one of
// the player's matches — the journal's "Remove this note". A note id that
// is not on that match is a 404 rather than a delete of somebody else's
// row.
func handleDeleteMatchCoachNote(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		id, ok := idFromPath(w, r, "coach note id")
		if !ok {
			return
		}
		if writeError(w, r, a.DeleteMatchCoachNote(matchKey, id)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleGetCoachingSettings(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, r, a.GetCoachingSettings(), nil)
	}
}

// handleSetCoachingSettings persists the name this user signs notes with.
// An empty name is legal — it means "not set yet", and export refuses on
// that separately.
func handleSetCoachingSettings(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name, err := decodeStringBody(r, "coach_name")
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		settings, err := a.SetCoachingSettings(name)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, settings, nil)
	}
}

// idFromPath reads the numeric {id} path value both id-keyed coaching
// resources carry (a staged return, an accepted block). A non-numeric id is
// a 400 naming the field — the response is already written, so the caller
// just returns. The twin of matchKeyFromPath.
func idFromPath(w http.ResponseWriter, r *http.Request, label string) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeProblem(w, r, probInvalidBody, label+" must be an integer",
			withFieldErrors(fieldError{"id", "must be an integer"}))
		return 0, false
	}
	return id, true
}

// decodeDecisions reads the `{"decisions": {"<note_id>": "accepted"}}`
// body into the app layer's slice. `*string` values so a JSON `null`
// verdict is rejected rather than silently decoding to "", and the keys are
// sorted so a batch applies in a stable order.
func decodeDecisions(r *http.Request) ([]coach.Decision, error) {
	var body struct {
		Decisions map[string]*string `json:"decisions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, errors.New("invalid JSON body")
	}
	if body.Decisions == nil {
		return nil, errors.New(`body must be {"decisions":{"<note_id>":"accepted"|"skipped"}}`)
	}
	out := make([]coach.Decision, 0, len(body.Decisions))
	for _, noteID := range slices.Sorted(maps.Keys(body.Decisions)) {
		verdict := body.Decisions[noteID]
		if verdict == nil {
			return nil, fmt.Errorf("decisions[%q] must be a string, not null", noteID)
		}
		out = append(out, coach.Decision{NoteID: noteID, Decision: *verdict})
	}
	return out, nil
}
