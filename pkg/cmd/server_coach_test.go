package cmd_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"

	"recall/pkg/bundle"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// The coaching-session HTTP surface: open / read / close, the loaned
// corpus, note + summary autosave, and the notes export. The session is
// in-memory on the App — nothing here writes the player's matches to the
// coach's store — so these tests drive the routes and read the coach's own
// note rows back off the fake.

const (
	sessionPath   = "/api/v1/coach/session"
	sessionMatch1 = "match-2026-05-10T22-21-11"
	sessionMatch2 = "match-2026-05-10T21-14-02"
)

// newCoachMux wires a mux whose settings.json lands in a temp dir — the
// coach name is a persisted setting, and the default data dir is the
// developer's real one.
func newCoachMux(t *testing.T) (*dbtest.Fake, *http.ServeMux) {
	t.Helper()
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	return fs, mux
}

// coachBundle builds the share-mode bundle a coach opens: a manifest
// naming the player plus one summary row per match key. Built from the real
// bundle/db types rather than hand-written JSON — the row field names are
// the Go ones, and a hand-rolled `match_key` would silently aggregate into
// a single keyless record.
func coachBundle(t *testing.T, handle string, matchKeys ...string) []byte {
	t.Helper()
	data := bundle.DataV2{Schema: "recall-export/v1", RecallVersion: "test"}
	for _, key := range matchKeys {
		data.Summaries = append(data.Summaries, db.SummaryRow{
			Filename: key + ".png", MatchKey: key, Map: "numbani", Hero: "ana", Result: "victory",
		})
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	writeJSONEntry(t, zw, "manifest.json", bundle.ManifestV1{
		Schema: bundle.BundleSchemaV1,
		Player: &bundle.PlayerIdentity{Handle: handle, Message: "ult timing on control"},
	})
	writeJSONEntry(t, zw, "data.json", data)
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

// openSession opens a session for "Sable" over the two fixture matches.
func openSession(t *testing.T, mux *http.ServeMux) sessionView {
	t.Helper()
	rec := postBytes(t, mux, sessionPath, coachBundle(t, "Sable", sessionMatch1, sessionMatch2))
	if rec.Code != http.StatusCreated {
		t.Fatalf("open status = %d, want 201; body=%q", rec.Code, rec.Body.String())
	}
	return decodeSessionView(t, rec.Body.Bytes())
}

type sessionView struct {
	Player struct {
		Handle  string `json:"handle"`
		Message string `json:"message"`
	} `json:"player"`
	SessionDate string `json:"session_date"`
	MatchCount  int    `json:"match_count"`
	CoachName   string `json:"coach_name"`
	FocusItems  []struct {
		ItemID string `json:"item_id"`
		Text   string `json:"text"`
	} `json:"focus_items"`
	Notes []struct {
		NoteID    string   `json:"note_id"`
		MatchKey  string   `json:"match_key"`
		Kind      string   `json:"kind"`
		Text      string   `json:"text"`
		FocusTags []string `json:"focus_tags"`
	} `json:"notes"`
}

func decodeSessionView(t *testing.T, body []byte) sessionView {
	t.Helper()
	var v sessionView
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode session view %q: %v", body, err)
	}
	return v
}

func notePath(matchKey string) string {
	return sessionPath + "/notes/" + url.PathEscape(matchKey)
}

func TestCoachSession_OpenReadThenCloseIsIdempotent(t *testing.T) {
	_, mux := newCoachMux(t)

	view := openSession(t, mux)
	if view.Player.Handle != "Sable" || view.MatchCount != 2 {
		t.Fatalf("opened view = %+v, want handle Sable over 2 matches", view)
	}
	if rec := get(t, mux, sessionPath); rec.Code != http.StatusOK {
		t.Fatalf("read status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if rec := del(t, mux, sessionPath); rec.Code != http.StatusNoContent {
		t.Fatalf("close status = %d, want 204", rec.Code)
	}
	if rec := get(t, mux, sessionPath); rec.Code != http.StatusNotFound {
		t.Fatalf("read after close = %d, want 404", rec.Code)
	}
	// Closing a session that is already gone is how the frontend clears a
	// stale resume — it must not be an error.
	if rec := del(t, mux, sessionPath); rec.Code != http.StatusNoContent {
		t.Fatalf("second close = %d, want 204", rec.Code)
	}
}

func TestCoachSession_SecondOpenIs409(t *testing.T) {
	_, mux := newCoachMux(t)
	openSession(t, mux)
	rec := postBytes(t, mux, sessionPath, coachBundle(t, "Wren", sessionMatch1))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%q", rec.Code, rec.Body.String())
	}
}

func TestCoachSession_UnreadablePayloadIs400(t *testing.T) {
	_, mux := newCoachMux(t)
	rec := postBytes(t, mux, sessionPath, []byte("not a zip at all"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

// The loaned corpus is what the six tabs render while a session is open;
// with none open every session sub-resource is a 404, not a 500.
func TestCoachSession_SubResourcesWithoutASessionAre404(t *testing.T) {
	_, mux := newCoachMux(t)
	cases := []struct {
		name, method, path string
		body               any
	}{
		{"read", http.MethodGet, sessionPath, nil},
		{"matches", http.MethodGet, sessionPath + "/matches", nil},
		{"player", http.MethodPut, sessionPath + "/player", map[string]any{"handle": "Sable"}},
		{"note", http.MethodPut, notePath(sessionMatch1), map[string]any{"kind": "note", "text": "late peel"}},
		{"note delete", http.MethodDelete, notePath(sessionMatch1), nil},
		{"summary", http.MethodPut, sessionPath + "/summary", map[string]any{"text": "ults first"}},
		{"export", http.MethodPost, sessionPath + "/export", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := fire(t, mux, tc.method, tc.path, tc.body)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404; body=%q", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestCoachSessionMatches_ServesTheLoanedCorpus(t *testing.T) {
	_, mux := newCoachMux(t)
	openSession(t, mux)

	rec := get(t, mux, sessionPath+"/matches")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var records []struct {
		MatchKey string `json:"match_key"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &records); err != nil {
		t.Fatalf("decode records %q: %v", rec.Body.String(), err)
	}
	if len(records) != 2 {
		t.Fatalf("loaned %d records, want 2: %+v", len(records), records)
	}
}

func TestCoachSessionPlayer_ConfirmRenamesAndBlankIs400(t *testing.T) {
	_, mux := newCoachMux(t)
	openSession(t, mux)

	rec := put(t, mux, sessionPath+"/player", map[string]any{"handle": "Sable-EU"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := decodeSessionView(t, rec.Body.Bytes()).Player.Handle; got != "Sable-EU" {
		t.Errorf("handle = %q, want Sable-EU", got)
	}
	if rec := put(t, mux, sessionPath+"/player", map[string]any{"handle": "  "}); rec.Code != http.StatusBadRequest {
		t.Errorf("blank handle status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestCoachSessionNote_PutHydratesTheViewAndDeleteClearsIt(t *testing.T) {
	_, mux := newCoachMux(t)
	openSession(t, mux)

	rec := put(t, mux, notePath(sessionMatch1), map[string]any{
		"kind": "note", "text": "Late peel on B", "focus_tags": []string{"positioning"},
		"extra_tags": []string{}, "match_clock": "06:40",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("put note status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var saved struct {
		NoteID   string `json:"note_id"`
		MatchKey string `json:"match_key"`
		Text     string `json:"text"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil {
		t.Fatalf("decode note: %v", err)
	}
	if saved.NoteID == "" || saved.MatchKey != sessionMatch1 {
		t.Fatalf("saved note = %+v, want a minted note_id on %s", saved, sessionMatch1)
	}
	if notes := decodeSessionView(t, get(t, mux, sessionPath).Body.Bytes()).Notes; len(notes) != 1 {
		t.Fatalf("view carries %d notes, want 1", len(notes))
	}
	if rec := del(t, mux, notePath(sessionMatch1)); rec.Code != http.StatusNoContent {
		t.Fatalf("delete note status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	if notes := decodeSessionView(t, get(t, mux, sessionPath).Body.Bytes()).Notes; len(notes) != 0 {
		t.Fatalf("view still carries %d notes after the delete", len(notes))
	}
}

// A note about a match the session never loaned is a 404 — the same guard
// the coach's own database gets, so a stale reel frame cannot mint a row
// about somebody else's match.
func TestCoachSessionNote_MatchOutsideTheSessionIs404(t *testing.T) {
	_, mux := newCoachMux(t)
	openSession(t, mux)
	rec := put(t, mux, notePath("match-2020-01-01T00-00-00"), map[string]any{"kind": "note", "text": "nope"})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%q", rec.Code, rec.Body.String())
	}
}

func TestCoachSessionNote_RejectsInvalidBodies(t *testing.T) {
	cases := []struct {
		name string
		body any
	}{
		{"unknown kind", map[string]any{"kind": "scribble", "text": "hi"}},
		{"clock is not MM:SS", map[string]any{"kind": "note", "text": "hi", "match_clock": "6m40"}},
		{"focus tag outside the vocabulary", map[string]any{"kind": "note", "text": "hi", "focus_tags": []string{"vibes"}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, mux := newCoachMux(t)
			openSession(t, mux)
			rec := put(t, mux, notePath(sessionMatch1), tc.body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
			}
		})
	}
}

// A note whose kind and content disagree — a `note` that says nothing, a
// `reviewed_only` mark carrying words — is a 409, not a 400: the request is
// spec-valid and the refusal is semantic, the same code an empty moment and
// an empty annotation answer with (and what keeps schemathesis's
// positive-data check honest about a body the spec permits).
func TestCoachSessionNote_KindContentMismatchIsAConflict(t *testing.T) {
	for name, body := range map[string]map[string]any{
		"empty note":                 {"kind": "note", "text": "   "},
		"reviewed_only with a clock": {"kind": "reviewed_only", "match_clock": "06:40"},
	} {
		t.Run(name, func(t *testing.T) {
			_, mux := newCoachMux(t)
			openSession(t, mux)
			rec := put(t, mux, notePath(sessionMatch1), body)
			if rec.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409; body=%q", rec.Code, rec.Body.String())
			}
		})
	}
}

// Bodies that don't parse are 400s from the handler, before the app layer
// ever sees them — including the shapes Go's decoder would otherwise
// swallow (`null` into a zero struct, a bare string).
func TestCoachSession_MalformedBodiesAre400(t *testing.T) {
	cases := []struct{ name, method, path, body string }{
		{"note truncated", http.MethodPut, notePath(sessionMatch1), `{"kind":`},
		{"note is not an object", http.MethodPut, notePath(sessionMatch1), `"nope"`},
		{"note is null", http.MethodPut, notePath(sessionMatch1), `null`},
		{"focus items missing", http.MethodPut, sessionPath + "/focus-items", `{}`},
		{"focus items is null", http.MethodPut, sessionPath + "/focus-items", `{"items":null}`},
		{"focus item has no id", http.MethodPut, sessionPath + "/focus-items", `{"items":[{"text":"x"}]}`},
		{"player handle is null", http.MethodPut, sessionPath + "/player", `{"handle":null}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, mux := newCoachMux(t)
			openSession(t, mux)
			rec := fireBody(t, mux, tc.method, tc.path, strings.NewReader(tc.body))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestCoachSessionFocusItems_PutPersistsIntoTheView(t *testing.T) {
	_, mux := newCoachMux(t)
	openSession(t, mux)

	body := map[string]any{"items": []map[string]string{
		{"item_id": "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "text": "Ult economy first."},
	}}
	if rec := put(t, mux, sessionPath+"/focus-items", body); rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	got := decodeSessionView(t, get(t, mux, sessionPath).Body.Bytes()).FocusItems
	if len(got) != 1 || got[0].Text != "Ult economy first." {
		t.Errorf("focus items = %+v, want the list just written", got)
	}
}

// Export refuses rather than shipping something unattributable: no coach
// name is a 409, and nothing written yet is a 409 too.
func TestCoachSessionExport_RefusesWithoutANameOrWork(t *testing.T) {
	_, mux := newCoachMux(t)
	openSession(t, mux)

	if rec := fire(t, mux, http.MethodPost, sessionPath+"/export", nil); rec.Code != http.StatusConflict {
		t.Fatalf("nameless export status = %d, want 409; body=%q", rec.Code, rec.Body.String())
	}
	if rec := put(t, mux, coachingSettingsPath, map[string]any{"coach_name": "Ordo", "player_handle": ""}); rec.Code != http.StatusOK {
		t.Fatalf("set coach name status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if rec := fire(t, mux, http.MethodPost, sessionPath+"/export", nil); rec.Code != http.StatusConflict {
		t.Fatalf("empty-work export status = %d, want 409; body=%q", rec.Code, rec.Body.String())
	}
}

func TestCoachSessionExport_StreamsZipWithDisposition(t *testing.T) {
	_, mux := newCoachMux(t)
	openSession(t, mux)
	_ = put(t, mux, coachingSettingsPath, map[string]any{"coach_name": "Ordo", "player_handle": ""})
	_ = put(t, mux, notePath(sessionMatch1), map[string]any{"kind": "note", "text": "Late peel on B"})

	// The human copy rides in from the frontend, which is where the app's
	// real stylesheets are; the server puts the bytes in the zip.
	rec := fire(t, mux, http.MethodPost, sessionPath+"/export",
		map[string]any{"sheet_html": string(testSheet)})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("content-type = %q, want application/zip", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !bytes.Contains([]byte(cd), []byte(`attachment; filename="recall-coach-notes-sable-`)) {
		t.Errorf("content-disposition = %q, want the sable notes filename", cd)
	}
	if _, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len())); err != nil {
		t.Errorf("body is not a readable zip: %v", err)
	}
}

// The roster round-trips through the wire: coached players with note counts,
// newest work first, summaries included — the 03 section's data.
func TestListCoachPlayers_RosterRoundTrip(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	store := dbtest.New()
	_, mux := newTestApp(t, store)

	sable, err := store.EnsureCoachPlayer("uuid-sable", "Sable")
	if err != nil {
		t.Fatalf("EnsureCoachPlayer: %v", err)
	}
	if _, err := store.UpsertCoachNote(db.CoachNote{
		NoteID: "n-1", PlayerRef: sable.ID, MatchKey: "m-1", Kind: "note", Text: "hold angles",
		CreatedAt: "2026-05-01T10:00:00Z", UpdatedAt: "2026-05-01T10:00:00Z",
	}); err != nil {
		t.Fatalf("UpsertCoachNote: %v", err)
	}
	if err := store.SetCoachFocusItems(sable.ID, []db.FocusItem{{ItemID: "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d", Text: "ult economy first"}}); err != nil {
		t.Fatalf("SetCoachFocusItems: %v", err)
	}

	assertRosterHasSable(t, fire(t, mux, http.MethodGet, "/api/v1/coach/players", nil))
}

// assertRosterHasSable decodes the roster wire shape and pins the one row.
func assertRosterHasSable(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /coach/players = %d, want 200", rec.Code)
	}
	var roster []struct {
		Handle     string   `json:"handle"`
		NoteCount  int      `json:"note_count"`
		LastNoteAt string   `json:"last_note_at"`
		FocusItems []string `json:"focus_items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &roster); err != nil {
		t.Fatalf("decode roster: %v", err)
	}
	if len(roster) != 1 {
		t.Fatalf("roster = %d rows, want 1", len(roster))
	}
	got := roster[0]
	if got.Handle != "Sable" || got.NoteCount != 1 || !slices.Equal(got.FocusItems, []string{"ult economy first"}) || got.LastNoteAt == "" {
		t.Fatalf("roster row = %+v, want Sable with 1 note, the focus list and a stamp", got)
	}
}

// An empty roster is an empty ARRAY, not null — the frontend maps over it.
func TestListCoachPlayers_EmptyIsAnArray(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	_, mux := newTestApp(t, dbtest.New())
	rec := fire(t, mux, http.MethodGet, "/api/v1/coach/players", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /coach/players = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "[]\n" && body != "[]" {
		t.Fatalf("empty roster body = %q, want []", body)
	}
}

// testSheet stands in for the human copy the frontend builds. It lives in
// this untagged file rather than a `//go:build !serveronly` one because
// `task lint-go` compiles the package under four tag combinations, and a
// fixture only half of them can see is a build failure in the other two.
var testSheet = []byte("<!doctype html><html><body>review</body></html>")
