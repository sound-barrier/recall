package cmd_test

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

func dataPath(matchKey string) string {
	return "/api/v1/matches/" + url.PathEscape(matchKey) + "/data"
}

func TestCreateManualMatch_Returns201AndManualRecord(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	body := map[string]any{
		"map":        "ilios",
		"play_mode":  "competitive",
		"queue_type": "role",
		"heroes":     []string{"ana", "kiriko"},
		"result":     "victory",
		"played_at":  "2026-06-15T14:30:00Z",
	}
	rec := fire(t, mux, http.MethodPost, "/api/v1/matches", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%q", rec.Code, rec.Body.String())
	}
	var got struct {
		MatchKey string `json:"match_key"`
		Source   string `json:"source"`
		Data     struct {
			Map  string `json:"map"`
			Hero string `json:"hero"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if got.MatchKey != "match-2026-06-15T14-30-00" {
		t.Errorf("match_key = %q, want match-2026-06-15T14-30-00", got.MatchKey)
	}
	if got.Source != "manual" {
		t.Errorf("source = %q, want manual", got.Source)
	}
	if got.Data.Map != "ilios" || got.Data.Hero != "ana" {
		t.Errorf("data map/hero = %q/%q, want ilios/ana", got.Data.Map, got.Data.Hero)
	}
}

func TestCreateManualMatch_CollisionIs409(t *testing.T) {
	fs := dbtest.New()
	fs.Summaries = []db.SummaryRow{{Filename: "s.png", MatchKey: "match-2026-06-15T14-30-00"}}
	_, mux := newTestApp(t, fs)
	body := map[string]any{
		"map": "ilios", "play_mode": "competitive", "queue_type": "role",
		"heroes": []string{"ana"}, "result": "victory", "played_at": "2026-06-15T14:30:00Z",
	}
	if rec := fire(t, mux, http.MethodPost, "/api/v1/matches", body); rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%q", rec.Code, rec.Body.String())
	}
}

func TestCreateManualMatch_MissingMapIs400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	body := map[string]any{
		"play_mode": "competitive", "queue_type": "role",
		"heroes": []string{"ana"}, "result": "victory",
	}
	if rec := fire(t, mux, http.MethodPost, "/api/v1/matches", body); rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestUpdateMatchData_Persists204(t *testing.T) {
	fs := dbtest.New()
	fs.Summaries = []db.SummaryRow{{Filename: "s.png", MatchKey: "match-A", Map: "rialto"}}
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, dataPath("match-A"), map[string]any{"map": "kings row"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	if _, ok := fs.UserMatchData["match-A"]; !ok {
		t.Errorf("UserMatchData not written for match-A")
	}
}

func TestUpdateMatchData_InvalidResultIs400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	if rec := put(t, mux, dataPath("match-A"), map[string]any{"result": "win"}); rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestUpdateMatchData_NullBodyIs400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// json.RawMessage marshals verbatim, so this sends the literal `null`.
	if rec := put(t, mux, dataPath("match-A"), json.RawMessage("null")); rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestResetMatchData_Returns204AndClears(t *testing.T) {
	fs := dbtest.New()
	dmg := 5
	fs.UserMatchData = map[string]db.UserMatchData{"match-A": {MatchKey: "match-A", Damage: &dmg}}
	_, mux := newTestApp(t, fs)
	if rec := del(t, mux, dataPath("match-A")); rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	if _, ok := fs.UserMatchData["match-A"]; ok {
		t.Errorf("override still present after reset")
	}
}
