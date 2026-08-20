package cmd_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"recall/pkg/db/dbtest"
	"recall/pkg/review"
)

// The self-review surface over HTTP: the round trip a Reviews-tab session
// makes, and the status each refusal carries off the central ladder.

func selfReviewMux(t *testing.T) (*dbtest.Fake, *http.ServeMux) {
	t.Helper()
	fs := dbtest.New()
	seedMatchKeys(fs, "match-a", "match-b")
	_, mux := newTestApp(t, fs)
	return fs, mux
}

func decodeSession(t *testing.T, body []byte) review.Session {
	t.Helper()
	var s review.Session
	if err := json.Unmarshal(body, &s); err != nil {
		t.Fatalf("decode session: %v\n%s", err, body)
	}
	return s
}

func mustStatus(t *testing.T, rec *httptest.ResponseRecorder, want int, what string) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("%s = %d %s", what, rec.Code, rec.Body.String())
	}
}

func TestSelfReviewRoutes_RoundTrip(t *testing.T) {
	fs, mux := selfReviewMux(t)
	base, reviewID := writeSittingOverHTTP(t, mux)
	assertSittingAfterWrites(t, mux, base)
	assertMatchBlockInProgress(t, mux, reviewID)

	mustStatus(t, fire(t, mux, http.MethodPost, base+"/completion", nil), http.StatusOK, "finish")
	assertFinishedOnListAndFlags(t, mux, fs)

	if rec := del(t, mux, base+"/notes/match-b/moments/m-1"); rec.Code != http.StatusNoContent {
		t.Errorf("delete moment = %d", rec.Code)
	}
	if rec := del(t, mux, base+"/notes/match-a"); rec.Code != http.StatusNoContent {
		t.Errorf("delete note = %d", rec.Code)
	}
	if rec := del(t, mux, base); rec.Code != http.StatusNoContent {
		t.Errorf("delete sitting = %d", rec.Code)
	}
	if rec := del(t, mux, base); rec.Code != http.StatusNoContent {
		t.Errorf("second delete = %d, want an idempotent 204", rec.Code)
	}
	if rec := get(t, mux, base); rec.Code != http.StatusNotFound {
		t.Errorf("get after delete = %d, want 404", rec.Code)
	}
}

// writeSittingOverHTTP creates a sitting over match-b + match-a and writes a
// note on match-a, a moment alone on match-b, and the summary — returning
// the sitting's route and id.
func writeSittingOverHTTP(t *testing.T, mux *http.ServeMux) (base, reviewID string) {
	t.Helper()
	created := fire(t, mux, http.MethodPost, "/api/v1/self-reviews", map[string]any{
		"title": "Sunday set", "match_keys": []string{"match-b", "match-a"},
	})
	mustStatus(t, created, http.StatusCreated, "create")
	sitting := decodeSession(t, created.Body.Bytes())
	if sitting.ReviewID == "" || len(sitting.MatchKeys) != 2 || sitting.MatchKeys[0] != "match-b" || sitting.Notes == nil {
		t.Fatalf("created = %+v", sitting)
	}
	base = "/api/v1/self-reviews/" + sitting.ReviewID
	mustStatus(t, put(t, mux, base+"/notes/match-a", map[string]any{"kind": "note", "text": "held the choke", "focus_tags": []string{"positioning"}}), http.StatusOK, "put note")
	mustStatus(t, put(t, mux, base+"/notes/match-b/moments/m-1", map[string]any{"match_clock": "4:45", "text": "peeled late"}), http.StatusOK, "put moment")
	mustStatus(t, put(t, mux, base, map[string]any{"title": "Sunday set", "summary": "Stop chasing flanks."}), http.StatusOK, "update")
	return base, sitting.ReviewID
}

func assertSittingAfterWrites(t *testing.T, mux *http.ServeMux, base string) {
	t.Helper()
	got := get(t, mux, base)
	mustStatus(t, got, http.StatusOK, "get")
	sitting := decodeSession(t, got.Body.Bytes())
	if len(sitting.Notes) != 2 {
		t.Errorf("after writes = %+v", sitting)
	}
	if sitting.Notes["match-b"].Kind != "reviewed_only" || len(sitting.Notes["match-b"].Moments) != 1 || sitting.Notes["match-b"].Moments[0].MatchClock != "04:45" {
		t.Errorf("moment-only note = %+v, want reviewed_only carrying the zero-padded moment", sitting.Notes["match-b"])
	}
}

// assertMatchBlockInProgress reads match-a the way the dossier does: the
// block is on the match already, in progress, and no reviewed flag yet.
func assertMatchBlockInProgress(t *testing.T, mux *http.ServeMux, reviewID string) {
	t.Helper()
	match := get(t, mux, "/api/v1/matches/match-a")
	mustStatus(t, match, http.StatusOK, "get match")
	var rec struct {
		SelfReviewNotes []struct {
			ReviewID string `json:"review_id"`
			Finished string `json:"review_finished_at"`
			Text     string `json:"text"`
		} `json:"self_review_notes"`
		ReviewedBy string `json:"reviewed_by"`
	}
	if err := json.Unmarshal(match.Body.Bytes(), &rec); err != nil {
		t.Fatal(err)
	}
	if len(rec.SelfReviewNotes) != 1 || rec.SelfReviewNotes[0].ReviewID != reviewID || rec.SelfReviewNotes[0].Finished != "" || rec.ReviewedBy != "" {
		t.Errorf("match before finish = %+v", rec)
	}
}

func assertFinishedOnListAndFlags(t *testing.T, mux *http.ServeMux, fs *dbtest.Fake) {
	t.Helper()
	list := get(t, mux, "/api/v1/self-reviews")
	var all []review.Session
	if err := json.Unmarshal(list.Body.Bytes(), &all); err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].FinishedAt == "" {
		t.Errorf("list after finish = %+v", all)
	}
	if flags, _ := fs.LoadReviews(); flags["match-a"].ReviewedBy != "self" || flags["match-b"].ReviewedBy != "self" {
		t.Errorf("reviewed flags after finish = %+v", flags)
	}
}

func TestSelfReviewRoutes_StatusLadder(t *testing.T) {
	_, mux := selfReviewMux(t)
	created := decodeSession(t, fire(t, mux, http.MethodPost, "/api/v1/self-reviews", map[string]any{"match_keys": []string{"match-a"}}).Body.Bytes())
	base := "/api/v1/self-reviews/" + created.ReviewID
	long := make([]byte, review.MaxTitleRunes+1)
	for i := range long {
		long[i] = 'x'
	}
	cases := []struct {
		name, method, path string
		body               any
		want               int
	}{
		{"empty set is 409", http.MethodPost, "/api/v1/self-reviews", map[string]any{"match_keys": []string{""}}, http.StatusConflict},
		{"long title is 400", http.MethodPost, "/api/v1/self-reviews", map[string]any{"title": string(long), "match_keys": []string{"match-a"}}, http.StatusBadRequest},
		{"malformed body is 400", http.MethodPost, "/api/v1/self-reviews", "not json", http.StatusBadRequest},
		{"ghost sitting is 404", http.MethodGet, "/api/v1/self-reviews/ghost", nil, http.StatusNotFound},
		{"update ghost is 404", http.MethodPut, "/api/v1/self-reviews/ghost", map[string]any{"title": "t", "summary": "s"}, http.StatusNotFound},
		{"finish ghost is 404", http.MethodPost, "/api/v1/self-reviews/ghost/completion", nil, http.StatusNotFound},
		{"note outside the sitting is 404", http.MethodPut, base + "/notes/match-b", map[string]any{"kind": "note", "text": "x"}, http.StatusNotFound},
		{"note on a ghost is 404", http.MethodPut, "/api/v1/self-reviews/ghost/notes/match-a", map[string]any{"kind": "note", "text": "x"}, http.StatusNotFound},
		{"empty note is 409", http.MethodPut, base + "/notes/match-a", map[string]any{"kind": "note"}, http.StatusConflict},
		{"bad tag is 400", http.MethodPut, base + "/notes/match-a", map[string]any{"kind": "note", "focus_tags": []string{"vibes"}}, http.StatusBadRequest},
		{"moment outside the sitting is 404", http.MethodPut, base + "/notes/match-b/moments/m", map[string]any{"match_clock": "1:00", "text": "x"}, http.StatusNotFound},
		{"bad clock is 400", http.MethodPut, base + "/notes/match-a/moments/m", map[string]any{"match_clock": "1:99", "text": "x"}, http.StatusBadRequest},
		{"empty moment text is 409", http.MethodPut, base + "/notes/match-a/moments/m", map[string]any{"match_clock": "1:00", "text": " "}, http.StatusConflict},
		{"set-matches to nothing is 409", http.MethodPut, base + "/matches", map[string]any{"match_keys": []string{}}, http.StatusConflict},
		{"set-matches unknown key is 404", http.MethodPut, base + "/matches", map[string]any{"match_keys": []string{"match-ghost"}}, http.StatusNotFound},
		{"delete ghost note is 204", http.MethodDelete, "/api/v1/self-reviews/ghost/notes/match-a", nil, http.StatusNoContent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var rec = fire(t, mux, tc.method, tc.path, tc.body)
			if s, ok := tc.body.(string); ok {
				switch tc.method {
				case http.MethodPost:
					rec = postRaw(t, mux, tc.path, s)
				default:
					rec = putRaw(t, mux, tc.path, s)
				}
			}
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.want, rec.Body.String())
			}
			if tc.want >= 400 {
				if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
					t.Errorf("content-type = %q, want problem+json", ct)
				}
			}
		})
	}
}

// While a coaching session is open the sitting is frozen with the rest of
// the player's data — 409 off the same rung every write shares.
func TestSelfReviewRoutes_GatedByTheCoachSession(t *testing.T) {
	fs, mux := selfReviewMux(t)
	created := decodeSession(t, fire(t, mux, http.MethodPost, "/api/v1/self-reviews", map[string]any{"match_keys": []string{"match-a"}}).Body.Bytes())
	openSession(t, mux)
	for _, c := range []struct{ method, path string }{
		{http.MethodPost, "/api/v1/self-reviews"},
		{http.MethodPut, "/api/v1/self-reviews/" + created.ReviewID + "/notes/match-a"},
		{http.MethodPost, "/api/v1/self-reviews/" + created.ReviewID + "/completion"},
		{http.MethodDelete, "/api/v1/self-reviews/" + created.ReviewID},
	} {
		body := map[string]any{"match_keys": []string{"match-a"}, "kind": "note", "text": "x"}
		if rec := fire(t, mux, c.method, c.path, body); rec.Code != http.StatusConflict {
			t.Errorf("%s %s during a session = %d, want 409", c.method, c.path, rec.Code)
		}
	}
	// Reads stay open — the shelf is still the player's to look at.
	if rec := get(t, mux, "/api/v1/self-reviews"); rec.Code != http.StatusOK {
		t.Errorf("list during a session = %d, want 200", rec.Code)
	}
	if reviews, _ := fs.LoadSelfReviews(); len(reviews) != 1 {
		t.Errorf("a gated write got through: %d sittings", len(reviews))
	}
}
