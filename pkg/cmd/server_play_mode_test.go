package cmd_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"recall/pkg/db/dbtest"
)

func playModePath(matchKey string) string {
	return "/api/v1/matches/" + url.PathEscape(matchKey) + "/play-mode"
}

func TestMatchPlayMode_PutCompetitivePersistsAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, playModePath("match-A"), map[string]string{"play_mode": "competitive"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	if got := fs.PlayModes["match-A"].PlayMode; got != "competitive" {
		t.Errorf("store PlayModes[match-A].PlayMode = %q, want competitive", got)
	}
}

func TestMatchPlayMode_PutQuickplayOverwritesCompetitive(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	_ = put(t, mux, playModePath("match-A"), map[string]string{"play_mode": "competitive"})
	rec := put(t, mux, playModePath("match-A"), map[string]string{"play_mode": "quickplay"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("overwrite status = %d, want 204", rec.Code)
	}
	if got := fs.PlayModes["match-A"].PlayMode; got != "quickplay" {
		t.Errorf("PlayModes[match-A].PlayMode = %q, want quickplay", got)
	}
}

func TestMatchPlayMode_PutInvalidValueIs400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, playModePath("match-A"), map[string]string{"play_mode": "unranked"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid play_mode") {
		t.Errorf("body should mention invalid play_mode: %q", rec.Body.String())
	}
}

func TestMatchPlayMode_PutInvalidJSONIs400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, playModePath("match-A"), "not-a-json-object")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestMatchPlayMode_DeleteClearsAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	_ = put(t, mux, playModePath("match-A"), map[string]string{"play_mode": "competitive"})
	rec := del(t, mux, playModePath("match-A"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204", rec.Code)
	}
	if _, ok := fs.PlayModes["match-A"]; ok {
		t.Errorf("PlayModes should be cleared, got %+v", fs.PlayModes)
	}
}

func TestMatchPlayMode_DeleteOnUnsetIs204(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := del(t, mux, playModePath("never-set"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE on absent status = %d, want 204", rec.Code)
	}
}
