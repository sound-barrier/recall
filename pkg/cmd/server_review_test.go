package cmd_test

import (
	"net/http"
	"net/url"
	"strings"
	"testing"

	"recall/pkg/db/dbtest"
)

func reviewPath(matchKey string) string {
	return "/api/v1/matches/" + url.PathEscape(matchKey) + "/review"
}

func TestMatchReview_PutSelfPersistsAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, reviewPath("match-A"), map[string]string{"reviewed_by": "self"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	if got := fs.Reviews["match-A"].ReviewedBy; got != "self" {
		t.Errorf("store Reviews[match-A].ReviewedBy = %q, want self", got)
	}
}

func TestMatchReview_PutCoachOverwritesSelf(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	_ = put(t, mux, reviewPath("match-A"), map[string]string{"reviewed_by": "self"})
	rec := put(t, mux, reviewPath("match-A"), map[string]string{"reviewed_by": "coach"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("overwrite status = %d, want 204", rec.Code)
	}
	if got := fs.Reviews["match-A"].ReviewedBy; got != "coach" {
		t.Errorf("Reviews[match-A].ReviewedBy = %q, want coach", got)
	}
}

func TestMatchReview_PutInvalidValueIs400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, reviewPath("match-A"), map[string]string{"reviewed_by": "user"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "invalid reviewed_by") {
		t.Errorf("body should mention invalid reviewed_by: %q", rec.Body.String())
	}
}

func TestMatchReview_PutInvalidJSONIs400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, reviewPath("match-A"), "not-a-json-object")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestMatchReview_DeleteClearsAndReturns204(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	// Seed via PUT first.
	_ = put(t, mux, reviewPath("match-A"), map[string]string{"reviewed_by": "coach"})
	rec := del(t, mux, reviewPath("match-A"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204", rec.Code)
	}
	if _, ok := fs.Reviews["match-A"]; ok {
		t.Errorf("Reviews should be cleared, got %+v", fs.Reviews)
	}
}

func TestMatchReview_DeleteOnUnreviewedIs204(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := del(t, mux, reviewPath("never-reviewed"))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE on absent status = %d, want 204", rec.Code)
	}
}
