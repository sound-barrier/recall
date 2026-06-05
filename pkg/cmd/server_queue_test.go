package cmd

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"recall/pkg/db/dbtest"
)

func queuePath(matchKey string) string {
	return "/api/v1/matches/" + url.PathEscape(matchKey) + "/queue"
}

func TestMatchQueue_PutRolePersistsAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, queuePath("match-A"), map[string]string{"queue_type": "role"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	if got := fs.Queues["match-A"].QueueType; got != "role" {
		t.Errorf("store Queues[match-A].QueueType = %q, want role", got)
	}
}

func TestMatchQueue_PutOpenOverwritesRole(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	_ = put(t, mux, queuePath("match-A"), map[string]string{"queue_type": "role"})
	rec := put(t, mux, queuePath("match-A"), map[string]string{"queue_type": "open"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("overwrite status = %d, want 204", rec.Code)
	}
	if got := fs.Queues["match-A"].QueueType; got != "open" {
		t.Errorf("Queues[match-A].QueueType = %q, want open", got)
	}
}

func TestMatchQueue_PutInvalidValueIs400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, queuePath("match-A"), map[string]string{"queue_type": "ranked"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid queue_type") {
		t.Errorf("body should mention invalid queue_type: %q", rec.Body.String())
	}
}

func TestMatchQueue_PutInvalidJSONIs400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, queuePath("match-A"), "not-a-json-object")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestMatchQueue_DeleteClearsAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	_ = put(t, mux, queuePath("match-A"), map[string]string{"queue_type": "open"})
	rec := del(t, mux, queuePath("match-A"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204", rec.Code)
	}
	if _, ok := fs.Queues["match-A"]; ok {
		t.Errorf("Queues should be cleared, got %+v", fs.Queues)
	}
}

func TestMatchQueue_DeleteOnUnsetIs204(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := del(t, mux, queuePath("never-set"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE on absent status = %d, want 204", rec.Code)
	}
}
