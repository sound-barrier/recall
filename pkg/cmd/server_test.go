package cmd

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"recall/pkg/app"
	"recall/pkg/db"
)

// fakeStore is a minimal in-memory db.Store used by these handler tests
// to drive *App without SQLite. The cmd-layer tests don't seed any
// fixtures — they only exercise serialization and the Clear handler —
// so this implementation is intentionally bare.
type fakeStore struct {
	clearCalls  int
	hideCalls   []string
	unhideCalls []string
}

func (f *fakeStore) UpsertSummary(db.SummaryRow) error       { return nil }
func (f *fakeStore) UpsertScoreboard(db.ScoreboardRow) error { return nil }
func (f *fakeStore) UpsertPersonal(db.PersonalRow) error     { return nil }
func (f *fakeStore) UpsertRank(db.RankRow) error             { return nil }
func (f *fakeStore) UpsertUnknown(db.UnknownRow) error       { return nil }
func (f *fakeStore) EnsureScreenshotsDir(string) (int64, error) {
	return 0, nil
}

func (f *fakeStore) LoadAllFilenames() (map[string]bool, error) {
	return map[string]bool{}, nil
}
func (f *fakeStore) LoadAll() (db.Screenshots, error) { return db.Screenshots{}, nil }
func (f *fakeStore) Clear() error {
	f.clearCalls++
	return nil
}
func (f *fakeStore) Close() error                      { return nil }
func (f *fakeStore) SetAnnotation(db.Annotation) error { return nil }
func (f *fakeStore) DeleteAnnotation(string) error     { return nil }
func (f *fakeStore) LoadAnnotations() (map[string]db.Annotation, error) {
	return map[string]db.Annotation{}, nil
}

func (f *fakeStore) HideMatch(k string) error {
	f.hideCalls = append(f.hideCalls, k)
	return nil
}

func (f *fakeStore) UnhideMatch(k string) error {
	f.unhideCalls = append(f.unhideCalls, k)
	return nil
}

func (f *fakeStore) LoadHiddenKeys() (map[string]bool, error) { return map[string]bool{}, nil }

// newTestApp wires *App against a fakeStore + empty SPA. Skips Startup
// because the production wiring touches the filesystem.
func newTestApp(t *testing.T, fs *fakeStore) (*app.App, *http.ServeMux) {
	t.Helper() // small leaf helper; keeps the per-test boilerplate readable
	if fs == nil {
		fs = &fakeStore{}
	}
	a := app.NewWithStore(fs)
	a.SSEHub = app.NewSSEHub()
	mux := NewMux(a, fstest.MapFS{})
	return a, mux
}

func get(t *testing.T, mux *http.ServeMux, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func post(t *testing.T, mux *http.ServeMux, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// ──────────────────────────────────────────────────────────────────────────
// Read endpoints.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_GetMatchResults_EmptyIsEmptyArray(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/match-results")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	body := strings.TrimSpace(rec.Body.String())
	if body != "[]" {
		t.Errorf("OpenAPI demands [], got %q", body)
	}
}

func TestServerMux_GetVersion(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/version")
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got["version"] == "" {
		t.Errorf("expected non-empty version, got %+v", got)
	}
}

func TestServerMux_MethodNotAllowed(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// GET on POST-only endpoint
	rec := get(t, mux, "/api/parse")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Write endpoints with typed-error → 4xx mapping.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_PostScreenshotsDir_400OnInvalid(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := post(t, mux, "/api/screenshots-dir", map[string]string{"path": "/nonexistent/no-such-dir-12345"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
	// Body should mention the ErrInvalidScreenshotsDir sentinel message.
	if !strings.Contains(strings.ToLower(rec.Body.String()), "screenshots") {
		t.Errorf("400 body should reference 'screenshots', got %q", rec.Body.String())
	}
}

func TestServerMux_PostScreenshotsDir_400OnMissingPath(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := post(t, mux, "/api/screenshots-dir", map[string]string{}) // no `path`
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing path, got %d", rec.Code)
	}
}

func TestServerMux_PostTesseractPath_400OnInvalid(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := post(t, mux, "/api/tesseract-path", map[string]string{"path": "../traversal/../etc/passwd"})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────────
// ClearDatabase delegates to the store.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_ClearDatabase_DelegatesToStore(t *testing.T) {
	fs := &fakeStore{}
	_, mux := newTestApp(t, fs)
	rec := post(t, mux, "/api/clear-database", nil)
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	if fs.clearCalls != 1 {
		t.Errorf("expected 1 Clear call, got %d", fs.clearCalls)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Toggle endpoints.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_WatchEnabled_RoundTrip(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// GET initial — defaults to false.
	rec := get(t, mux, "/api/watch-enabled")
	if rec.Code != 200 {
		t.Fatalf("GET status %d", rec.Code)
	}
	var got map[string]bool
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if got["enabled"] {
		t.Errorf("watch should default to off, got %+v", got)
	}
}

func TestServerMux_PrometheusEnabled_RoundTrip(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/prometheus-enabled")
	if rec.Code != 200 {
		t.Fatalf("GET status %d", rec.Code)
	}
	rec = post(t, mux, "/api/prometheus-enabled", map[string]bool{"enabled": false})
	if rec.Code != 200 {
		t.Errorf("POST status %d body=%s", rec.Code, rec.Body.String())
	}
	rec = post(t, mux, "/api/prometheus-enabled", "not-json-at-all")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("POST with bad body should 400, got %d", rec.Code)
	}
}

func TestServerMux_WatchEnabled_POSTBadJSON(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := post(t, mux, "/api/watch-enabled", "not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for bad JSON body, got %d", rec.Code)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Tesseract endpoints.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_TesseractStatus(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/tesseract-status")
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	// Body must be a JSON object — not nil — even when Tesseract isn't
	// configured.
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
}

func TestServerMux_TesseractReset(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := post(t, mux, "/api/tesseract-reset", nil)
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Screenshots dir.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_ScreenshotsDir_GET(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/screenshots-dir")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	var got map[string]string
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	// path may be "" or "screenshots" — just verify the key exists.
	if _, ok := got["path"]; !ok {
		t.Errorf(`response missing "path" key: %+v`, got)
	}
}

func TestServerMux_NewScreenshotCount(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/new-screenshot-count")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestServerMux_CheckUpdate(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/check-update")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Static SPA fallback — anything outside /api/* is served from the assets FS.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_ServesIndexFromAssetsFS(t *testing.T) {
	a := app.NewWithStore(&fakeStore{})
	a.SSEHub = app.NewSSEHub()
	mux := NewMux(a, fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<!doctype html>")},
	})
	rec := get(t, mux, "/")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "doctype") {
		t.Errorf("body should contain SPA shell, got %q", rec.Body.String())
	}
}

func TestMatchAnnotations_Upsert(t *testing.T) {
	fs := &fakeStore{}
	a, mux := newTestApp(t, fs)
	_ = a

	rec := post(t, mux, "/api/match-annotations", map[string]any{
		"match_key": "k1",
		"leaver":    "team",
		"note":      "ally dc'd",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("upsert status = %d, body: %s", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_ClearByEmptyLeaver(t *testing.T) {
	fs := &fakeStore{}
	a, mux := newTestApp(t, fs)
	_ = a
	rec := post(t, mux, "/api/match-annotations", map[string]any{
		"match_key": "k1",
		"leaver":    "",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("clear status = %d, body: %s", rec.Code, rec.Body.String())
	}
}

func TestMatchVisibility_Hide(t *testing.T) {
	fs := &fakeStore{}
	_, mux := newTestApp(t, fs)
	rec := post(t, mux, "/api/match-visibility", map[string]any{
		"match_key": "k1",
		"hidden":    true,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("hide status = %d, body: %s", rec.Code, rec.Body.String())
	}
	if len(fs.hideCalls) != 1 || fs.hideCalls[0] != "k1" {
		t.Errorf("HideMatch not called with k1: %+v", fs.hideCalls)
	}
}

func TestMatchVisibility_Unhide(t *testing.T) {
	fs := &fakeStore{}
	_, mux := newTestApp(t, fs)
	rec := post(t, mux, "/api/match-visibility", map[string]any{
		"match_key": "k1",
		"hidden":    false,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("unhide status = %d, body: %s", rec.Code, rec.Body.String())
	}
	if len(fs.unhideCalls) != 1 || fs.unhideCalls[0] != "k1" {
		t.Errorf("UnhideMatch not called with k1: %+v", fs.unhideCalls)
	}
}

func TestMatchVisibility_MissingMatchKey400(t *testing.T) {
	fs := &fakeStore{}
	_, mux := newTestApp(t, fs)
	rec := post(t, mux, "/api/match-visibility", map[string]any{
		"hidden": true,
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing match_key should 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchVisibility_BadJSON400(t *testing.T) {
	fs := &fakeStore{}
	_, mux := newTestApp(t, fs)
	rec := post(t, mux, "/api/match-visibility", "not-json-at-all")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("malformed body should 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchVisibility_MethodNotAllowed(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/match-visibility")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET on POST-only route should 405, got %d", rec.Code)
	}
}

func TestMatchAnnotations_InvalidLeaver400(t *testing.T) {
	fs := &fakeStore{}
	a, mux := newTestApp(t, fs)
	_ = a
	rec := post(t, mux, "/api/match-annotations", map[string]any{
		"match_key": "k1",
		"leaver":    "afk",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid leaver should 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_MissingMatchKey400(t *testing.T) {
	fs := &fakeStore{}
	a, mux := newTestApp(t, fs)
	_ = a
	rec := post(t, mux, "/api/match-annotations", map[string]any{
		"leaver": "team",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing match_key should 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_AllFieldsAccepted(t *testing.T) {
	fs := &fakeStore{}
	_, mux := newTestApp(t, fs)
	rec := post(t, mux, "/api/match-annotations", map[string]any{
		"match_key":   "k1",
		"leaver":      "team",
		"note":        "ally rage-quit",
		"replay_code": "7H1K9P",
		"members":     []string{"Apollo#1", "Cheese#5"},
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_NoteOnlyPersists(t *testing.T) {
	// All-empty leaver but a note present — the row should persist.
	fs := &fakeStore{}
	_, mux := newTestApp(t, fs)
	rec := post(t, mux, "/api/match-annotations", map[string]any{
		"match_key": "k1",
		"leaver":    "",
		"note":      "no leaver tag yet",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("note-only should 204, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_E2E_PostThenReadBackOnMatchResults(t *testing.T) {
	// End-to-end: write a real SQLite store (in-memory), seed a
	// SUMMARY screenshot so a match exists, POST an annotation via
	// /api/match-annotations, then GET /api/match-results and
	// confirm the annotation surfaces on the returned record.
	//
	// Catches wiring regressions between the three layers: route →
	// app.SetMatchAnnotation → store, and then store → aggregator →
	// MatchRecord JSON.
	store, err := db.NewSQLStore(":memory:")
	if err != nil {
		t.Fatalf("NewSQLStore: %v", err)
	}
	defer func() { _ = store.Close() }()

	// One summary row so GetMatchResults returns something.
	if err := store.UpsertSummary(db.SummaryRow{
		Filename:   "s.png",
		MatchKey:   "match:e2e",
		Map:        "rialto",
		Mode:       "competitive",
		Result:     "victory",
		Date:       "2026-05-10",
		FinishedAt: "21:29",
	}); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}

	a := app.NewWithStore(store)
	a.SSEHub = app.NewSSEHub()
	mux := NewMux(a, fstest.MapFS{})

	// POST a full annotation.
	rec := post(t, mux, "/api/match-annotations", map[string]any{
		"match_key":   "match:e2e",
		"leaver":      "team",
		"note":        "ally rage-quit",
		"replay_code": "7H1K9P",
		"members":     []string{"Apollo#11234", "Cheese#5678"},
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("annotation POST status %d, body %s", rec.Code, rec.Body.String())
	}

	// GET /api/match-results — expect the annotation to surface on the
	// returned MatchRecord.
	rec = get(t, mux, "/api/match-results")
	if rec.Code != 200 {
		t.Fatalf("match-results status %d", rec.Code)
	}
	var records []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &records); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("expected 1 record, got %d", len(records))
	}
	annoRaw, ok := records[0]["annotation"]
	if !ok {
		t.Fatalf("record missing annotation: %+v", records[0])
	}
	anno, ok := annoRaw.(map[string]any)
	if !ok {
		t.Fatalf("annotation not an object: %T", annoRaw)
	}
	if anno["leaver"] != "team" {
		t.Errorf("annotation.leaver = %v, want team", anno["leaver"])
	}
	if anno["note"] != "ally rage-quit" {
		t.Errorf("annotation.note = %v", anno["note"])
	}
	if anno["replay_code"] != "7H1K9P" {
		t.Errorf("annotation.replay_code = %v", anno["replay_code"])
	}
	members, ok := anno["members"].([]any)
	if !ok || len(members) != 2 {
		t.Errorf("annotation.members shape wrong: %v", anno["members"])
	}

	// Idempotency contract: a POST with everything empty deletes the
	// row; the next GET should drop the annotation field entirely.
	rec = post(t, mux, "/api/match-annotations", map[string]any{
		"match_key": "match:e2e",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("clear POST status %d, body %s", rec.Code, rec.Body.String())
	}
	// Verify the deletion landed in the store, independent of the
	// JSON round-trip below.
	annos, err := store.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations after clear: %v", err)
	}
	if a, present := annos["match:e2e"]; present {
		t.Errorf("annotation row not deleted from store: %+v", a)
	}
	rec = get(t, mux, "/api/match-results")
	// json.Unmarshal merges into a non-nil slice destination — without
	// resetting, residual keys from the first decode survive and the
	// "annotation absent" assertion below would be a false positive.
	records = nil
	_ = json.Unmarshal(rec.Body.Bytes(), &records)
	if len(records) != 1 {
		t.Fatalf("expected 1 record after clear, got %d", len(records))
	}
	if v, present := records[0]["annotation"]; present && v != nil {
		t.Errorf("annotation should be absent or null after clear: %+v", v)
	}
}
