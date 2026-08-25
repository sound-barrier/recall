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
	"strings"

	"recall/pkg/app"
	"recall/pkg/coach"
	"recall/pkg/coachreturn"
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
	apiMux.HandleFunc("POST /api/v1/coach/session/replay", handleOpenCoachReplaySession(a))
	apiMux.HandleFunc("POST /api/v1/coach/session/replay/codes", handleAddCoachSessionReplayCode(a))
	apiMux.HandleFunc("PUT /api/v1/coach/session/matches/{match_key}/context", handleSetCoachSessionMatchContext(a))
	apiMux.HandleFunc("GET /api/v1/coach/session/matches", handleGetCoachSessionMatches(a))
	apiMux.HandleFunc("GET /api/v1/coach/players", handleListCoachPlayers(a))
	apiMux.HandleFunc("GET /api/v1/coach/players/{id}/notes", handleListCoachPlayerNotes(a))
	apiMux.HandleFunc("PUT /api/v1/coach/session/notes/{match_key}", handlePutCoachNote(a))
	apiMux.HandleFunc("DELETE /api/v1/coach/session/notes/{match_key}", handleDeleteCoachNote(a))
	apiMux.HandleFunc("PUT /api/v1/coach/session/notes/{match_key}/moments/{moment_id}", handlePutCoachMoment(a))
	apiMux.HandleFunc("DELETE /api/v1/coach/session/notes/{match_key}/moments/{moment_id}", handleDeleteCoachMoment(a))
	apiMux.HandleFunc("PUT /api/v1/coach/session/focus-items", handlePutCoachFocusItems(a))
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
	type body struct {
		Handle string `json:"handle"`
		// Kind is optional; "" means player. Only a codes session may say
		// team — the app refuses it on a bundle.
		Kind string `json:"kind"`
	}
	return func(w http.ResponseWriter, r *http.Request) {
		var b body
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			writeProblem(w, r, probInvalidBody, `body must be {"handle":"...", "kind"?: "player"|"team"}`)
			return
		}
		b.Handle = strings.TrimSpace(b.Handle)
		if b.Handle == "" {
			writeProblem(w, r, probInvalidBody, `body must be {"handle":"...", "kind"?: "player"|"team"}`)
			return
		}
		view, err := a.SetCoachSessionPlayer(b.Handle, b.Kind)
		if writeError(w, r, err) {
			return
		}
		writeJSON(w, r, view, nil)
	}
}

// handleOpenCoachReplaySession opens a session from replay codes alone — the
// door for a coach who was handed six characters rather than a bundle.
func handleOpenCoachReplaySession(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Codes json.RawMessage `json:"codes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		codes, err := decodeRequiredStringArray("codes", body.Codes)
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		view, err := a.OpenCoachReplaySession(codes)
		if writeError(w, r, err,
			errStatus{match.ErrInvalidReplayCode, probInvalidBody},
			errStatus{coach.ErrNoReplayCodes, probInvalidBody}) {
			return
		}
		writeJSON(w, r, view, nil)
	}
}

// handleAddCoachSessionReplayCode grows an open replay session's reel. A POST
// rather than a PUT: each call adds one code, and re-adding one already there
// is a no-op rather than a replacement.
func handleAddCoachSessionReplayCode(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		code, err := decodeRequiredString(r, "code")
		if err != nil {
			writeProblem(w, r, probInvalidBody, err.Error())
			return
		}
		view, aErr := a.AddCoachSessionReplayCode(code)
		if writeError(w, r, aErr,
			errStatus{match.ErrInvalidReplayCode, probInvalidBody},
			errStatus{coach.ErrNotAReplaySession, probConflict}) {
			return
		}
		writeJSON(w, r, view, nil)
	}
}

// handleSetCoachSessionMatchContext records what the coach observed while
// watching one replay.
func handleSetCoachSessionMatchContext(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		matchKey, ok := matchKeyFromPath(w, r)
		if !ok {
			return
		}
		var ctx coach.ObservedContext
		if err := json.NewDecoder(r.Body).Decode(&ctx); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		view, err := a.SetCoachSessionMatchContext(matchKey, ctx)
		if writeError(w, r, err,
			// A field the coach supplied is not in the roster: spec-valid
			// body, semantic refusal — the same 409 UnknownMap takes.
			errStatus{coach.ErrObservedContextInvalid, probConflict},
			errStatus{coach.ErrMatchNotInThisSession, probNotFound}) {
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

// handlePutCoachFocusItems replaces what the coach is telling this player to
// work on, in the given order. An empty list clears it, so the field is
// required but may be empty.
func handlePutCoachFocusItems(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Items *[]coach.FocusItem `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		// A pointer so an omitted or null `items` is a malformed body rather
		// than a silent "clear the list" — clearing is `[]`, said out loud.
		if body.Items == nil {
			writeProblem(w, r, probInvalidBody, "items is required")
			return
		}
		if writeError(w, r, a.PutCoachFocusItems(*body.Items)) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleExportCoachNotes streams the archive the coach hands the player:
// notes.json (the machine copy) plus ledger.html (the human copy). POST
// because it assembles a document rather than reading a resource; a session
// with no name set, no confirmed player, or nothing written is a 409.
//
// The human copy arrives in the BODY rather than being rendered here. It is
// built in the frontend, where the app's real stylesheets are, so that the
// page a coach can also download on its own and the page inside this archive
// are the same bytes.
func handleExportCoachNotes(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			SheetHTML string `json:"sheet_html"`
		}
		// An EMPTY body is not a malformed one, and the difference matters:
		// with no session open the honest answer is 404, and decoding first
		// would answer 400 for a request whose real problem is that there is
		// nothing to export. Let it through and let the session check speak.
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			writeProblem(w, r, probInvalidBody, "invalid JSON body")
			return
		}
		name, payload, err := a.ExportCoachNotes([]byte(body.SheetHTML))
		if writeError(w, r, err,
			errStatus{coach.ErrSheetMissing, probInvalidBody},
			errStatus{coach.ErrSheetTooLarge, probInvalidBody}) {
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

// handleSetCoachingSettings persists both coaching identities: the name this
// user signs notes with as a coach, and the handle they share under as a
// player. Empty is legal for either — it means "not set yet", and each side
// refuses separately when it needs one.
//
// Both fields are required in the body rather than optional, because an
// omitted string field is indistinguishable from an empty one after
// decoding: "leave the handle alone" and "clear the handle" would be the
// same request.
func handleSetCoachingSettings(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			CoachName    *string `json:"coach_name"`
			PlayerHandle *string `json:"player_handle"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeProblem(w, r, probInvalidBody, `body must be {"coach_name":"...","player_handle":"..."}`)
			return
		}
		if body.CoachName == nil || body.PlayerHandle == nil {
			writeProblem(w, r, probInvalidBody, "coach_name and player_handle are both required")
			return
		}
		settings, err := a.SetCoachingSettings(*body.CoachName, *body.PlayerHandle)
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
func decodeDecisions(r *http.Request) ([]coachreturn.Verdict, error) {
	var body struct {
		Decisions map[string]*string `json:"decisions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, errors.New("invalid JSON body")
	}
	if body.Decisions == nil {
		return nil, errors.New(`body must be {"decisions":{"<note_id>":"accepted"|"skipped"}}`)
	}
	out := make([]coachreturn.Verdict, 0, len(body.Decisions))
	for _, noteID := range slices.Sorted(maps.Keys(body.Decisions)) {
		verdict := body.Decisions[noteID]
		if verdict == nil {
			return nil, fmt.Errorf("decisions[%q] must be a string, not null", noteID)
		}
		// The HTTP boundary: JSON carries a bare string, and this is where it
		// becomes a Decision. coachreturn.Decide still refuses anything outside
		// the vocabulary — a type is not a substitute for validating input.
		out = append(out, coachreturn.Verdict{NoteID: noteID, Decision: coachreturn.Decision(*verdict)})
	}
	return out, nil
}

// coachNoteSummaryWire is one stored note on the wire — the dossier's
// "Read every note". No match context travels: the key is the label
// (a dated capture key, or a replay code).
type coachNoteSummaryWire struct {
	NoteID      string   `json:"note_id"`
	MatchKey    string   `json:"match_key"`
	Kind        string   `json:"kind"`
	Text        string   `json:"text"`
	FocusTags   []string `json:"focus_tags"`
	ExtraTags   []string `json:"extra_tags"`
	MatchClock  string   `json:"match_clock,omitempty"`
	MomentCount int      `json:"moment_count"`
	UpdatedAt   string   `json:"updated_at"`
}

// handleListCoachPlayerNotes reads one coached identity's whole file of
// notes, newest first.
func handleListCoachPlayerNotes(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := idFromPath(w, r, "player id")
		if !ok {
			return
		}
		notes, err := a.ListCoachPlayerNotes(id)
		if writeError(w, r, err) {
			return
		}
		wire := make([]coachNoteSummaryWire, 0, len(notes))
		for _, n := range notes {
			wire = append(wire, coachNoteSummaryWire{
				NoteID: n.NoteID, MatchKey: n.MatchKey, Kind: n.Kind, Text: n.Text,
				FocusTags:  append([]string{}, n.FocusTags...),
				ExtraTags:  append([]string{}, n.ExtraTags...),
				MatchClock: n.MatchClock, UpdatedAt: n.UpdatedAt,
			})
		}
		writeJSON(w, r, wire, nil)
	}
}

// coachPlayerSummaryWire is one roster row on the wire.
type coachPlayerSummaryWire struct {
	ID         int64    `json:"id"`
	Handle     string   `json:"handle"`
	Kind       string   `json:"kind"`
	NoteCount  int      `json:"note_count"`
	LastNoteAt string   `json:"last_note_at,omitempty"`
	FocusItems []string `json:"focus_items,omitempty"`
}

// handleListCoachPlayers reads the roster — every player this user has
// coached, most recently touched first.
func handleListCoachPlayers(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		roster, err := a.ListCoachPlayers()
		if writeError(w, r, err) {
			return
		}
		wire := make([]coachPlayerSummaryWire, 0, len(roster))
		for _, p := range roster {
			wire = append(wire, coachPlayerSummaryWire{
				ID: p.ID, Handle: p.Handle, Kind: p.Kind, NoteCount: p.NoteCount,
				LastNoteAt: p.LastNoteAt, FocusItems: p.FocusItems,
			})
		}
		writeJSON(w, r, wire, nil)
	}
}
