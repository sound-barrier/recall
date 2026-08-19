package cmd_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"recall/pkg/coach"
	"recall/pkg/db/dbtest"
)

// The seams a self-review sitting reaches beyond its own routes: a profile
// move that would split one, a notes-archive import whose note fails the
// kind rules (which must STAY a 400 now that the live note route answers
// 409 for the same body), and the set-replace success path.

// A transfer that would leave a sitting straddling two profiles is refused
// with a 409 off the route's own ladder — the class of mapping the ladder
// file warns about (ErrMoveStrandsCandidate once fell to 500 here).
func TestPostMatchTransfers_SplittingASittingIs409(t *testing.T) {
	mux := newTestAppWithProfiles(t)
	_ = fire(t, mux, http.MethodPost, "/api/v1/profiles", map[string]string{"name": "alt"})
	_ = put(t, mux, "/api/v1/profiles/active", map[string]string{"name": "main"})
	// Two real (hand-entered) matches on main, and a sitting over both.
	keys := make([]string, 0, 2)
	for _, at := range []string{"2026-03-01T12:00:00Z", "2026-03-02T12:00:00Z"} {
		rec := fire(t, mux, http.MethodPost, "/api/v1/matches", map[string]any{"map": "rialto", "result": "victory", "played_at": at})
		if rec.Code != http.StatusCreated {
			t.Fatalf("seed manual match: %d %s", rec.Code, rec.Body.String())
		}
		var made struct {
			MatchKey string `json:"match_key"`
		}
		mustDecode(t, rec.Body.Bytes(), &made)
		keys = append(keys, made.MatchKey)
	}
	created := fire(t, mux, http.MethodPost, "/api/v1/self-reviews", map[string]any{"match_keys": keys})
	if created.Code != http.StatusCreated {
		t.Fatalf("create sitting: %d %s", created.Code, created.Body.String())
	}

	rec := fire(t, mux, http.MethodPost, "/api/v1/matches/transfers", map[string]any{
		"match_keys": []string{keys[0]}, "target_profile": "alt",
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("content-type = %q, want problem+json", ct)
	}
}

// A notes ARCHIVE whose note says nothing is a malformed upload — 400 — even
// though the same body on the live note route is a semantic 409: the archive
// sentinel wraps the kind-rule one, and the ladder puts the archive first.
// Hand-zipped, because the archive writer refuses to produce the file.
func TestImportNotesArchive_KindContentMismatchStays400(t *testing.T) {
	fs := dbtest.New()
	seedMatchKeys(fs, sessionMatch1)
	_, mux := newTestApp(t, fs)
	now := time.Now().UTC()
	file := coach.NotesFile{
		Schema: coach.NotesSchemaV1, ExportedAt: now.Format(time.RFC3339), RecallVersion: "test",
		CoachName: "Ordo", Player: coach.Player{Handle: "Sable"}, SessionDate: now.Format(time.DateOnly),
		Notes: []coach.Note{{
			NoteID: coach.NewID(), MatchKey: sessionMatch1, Kind: coach.KindNote,
			FocusTags: []string{}, ExtraTags: []string{}, UpdatedAt: now.Format(time.RFC3339),
		}},
	}
	notesJSON, err := json.Marshal(file)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.Create("notes.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write(notesJSON); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	rec := postBytes(t, mux, "/api/v1/imports", buf.Bytes())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// PUT /{id}/matches replaces the set and echoes the sitting over it.
func TestSelfReviewRoutes_SetMatchesReplacesTheSet(t *testing.T) {
	_, mux := selfReviewMux(t)
	created := decodeSession(t, fire(t, mux, http.MethodPost, "/api/v1/self-reviews", map[string]any{"match_keys": []string{"match-a"}}).Body.Bytes())
	rec := put(t, mux, "/api/v1/self-reviews/"+created.ReviewID+"/matches", map[string]any{"match_keys": []string{"match-b", "match-a"}})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
	}
	got := decodeSession(t, rec.Body.Bytes())
	if len(got.MatchKeys) != 2 || got.MatchKeys[0] != "match-b" || got.MatchKeys[1] != "match-a" {
		t.Errorf("set = %v, want [match-b match-a]", got.MatchKeys)
	}
}

func mustDecode(t *testing.T, body []byte, into any) {
	t.Helper()
	if err := json.Unmarshal(body, into); err != nil {
		t.Fatalf("decode: %v\n%s", err, body)
	}
}
