package cmd_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// problemBody mirrors the RFC 9457 object the server emits, including the §3.2
// extension members (errors / failed_assets).
type problemBody struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail"`
	Instance string `json:"instance"`
	Errors   []struct {
		Field  string `json:"field"`
		Detail string `json:"detail"`
	} `json:"errors"`
	FailedAssets []string `json:"failed_assets"`
}

// assertProblem checks a response is a conformant application/problem+json with
// the expected status, type slug, and (optionally) a detail substring.
func assertProblem(t *testing.T, rec *httptest.ResponseRecorder, status int, slug, detailSubstr string) problemBody {
	t.Helper()
	if rec.Code != status {
		t.Errorf("status = %d, want %d (body %s)", rec.Code, status, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
	var p problemBody
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	if want := "https://github.com/sound-barrier/recall/problems/" + slug; p.Type != want {
		t.Errorf("type = %q, want %q", p.Type, want)
	}
	if p.Status != status {
		t.Errorf("body status = %d, want %d", p.Status, status)
	}
	if p.Title == "" {
		t.Error("title is empty, want a human-readable title")
	}
	if detailSubstr != "" && !strings.Contains(p.Detail, detailSubstr) {
		t.Errorf("detail = %q, want to contain %q", p.Detail, detailSubstr)
	}
	return p
}

// A not-found GET returns the not-found problem with the request path as
// `instance`.
func TestProblem_NotFoundShape(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, matchByKeyPath("does-not-exist"))
	p := assertProblem(t, rec, http.StatusNotFound, "not-found", "")
	if p.Instance != matchByKeyPath("does-not-exist") {
		t.Errorf("instance = %q, want the request path", p.Instance)
	}
}

// A body-shape 400 carries the §3.2 `errors` extension naming the offending
// field — the visibility setter with `hidden` absent.
func TestProblem_InvalidBodyCarriesFieldError(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, visibilityPath("m1"), map[string]any{})
	p := assertProblem(t, rec, http.StatusBadRequest, "invalid-body", "hidden")
	if len(p.Errors) != 1 || p.Errors[0].Field != "hidden" {
		t.Errorf("errors = %+v, want one field error for hidden", p.Errors)
	}
}

// A null MEMBER inside a disruption-side array is rejected with a field-scoped
// `errors` entry rather than being silently dropped to "".
func TestProblem_AnnotationNullLeaverSideFieldError(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, annotationPath("m1"), map[string]any{"leavers": []any{"team", nil}})
	p := assertProblem(t, rec, http.StatusBadRequest, "invalid-body", "leavers")
	if len(p.Errors) != 1 || p.Errors[0].Field != "leavers" {
		t.Errorf("errors = %+v, want one field error for leavers", p.Errors)
	}
}

func TestProblem_AnnotationNullThrowerSideFieldError(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, annotationPath("m1"), map[string]any{"throwers": []any{nil}})
	p := assertProblem(t, rec, http.StatusBadRequest, "invalid-body", "throwers")
	if len(p.Errors) != 1 || p.Errors[0].Field != "throwers" {
		t.Errorf("errors = %+v, want one field error for throwers", p.Errors)
	}
}
