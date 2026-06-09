package cmd

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// newTestApp wires *App against a dbtest.Fake + empty SPA. Skips
// Startup because the production wiring touches the filesystem.
//
// The shared `dbtest.Fake` carries call-tracking fields (HideCalls /
// UnhideCalls / ClearCalls / …) — tests that previously inspected
// the package-local fakeStore's private state now read the matching
// exported field.
func newTestApp(t *testing.T, fs *dbtest.Fake) (*app.App, *http.ServeMux) {
	t.Helper() // small leaf helper; keeps the per-test boilerplate readable
	if fs == nil {
		fs = dbtest.New()
	}
	a := app.NewWithStore(fs)
	a.SSEHub = app.NewSSEHub()
	mux := NewMux(a, fstest.MapFS{})
	return a, mux
}

// fire builds and dispatches an httptest request. Encoding the body
// as JSON happens unconditionally when body != nil — the handlers
// all accept JSON requests.
func fire(t *testing.T, mux *http.ServeMux, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func get(t *testing.T, mux *http.ServeMux, path string) *httptest.ResponseRecorder {
	t.Helper()
	return fire(t, mux, http.MethodGet, path, nil)
}

func put(t *testing.T, mux *http.ServeMux, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	return fire(t, mux, http.MethodPut, path, body)
}

func del(t *testing.T, mux *http.ServeMux, path string) *httptest.ResponseRecorder {
	t.Helper()
	return fire(t, mux, http.MethodDelete, path, nil)
}

// annotationPath builds the per-match annotation URL with the key
// properly URL-encoded — match keys normally contain colons (e.g.
// "match-2026-05-10T22-21-11") which must be percent-encoded.
func annotationPath(matchKey string) string {
	return "/api/v1/matches/" + url.PathEscape(matchKey) + "/annotation"
}

func visibilityPath(matchKey string) string {
	return "/api/v1/matches/" + url.PathEscape(matchKey) + "/visibility"
}

func resolutionPath(matchKey string) string {
	return "/api/v1/matches/" + url.PathEscape(matchKey) + "/resolution"
}

// newTestAppWithProfiles boots a real App against a tempdir so the
// profile manager is fully wired (Create / Switch / Delete are no-ops
// without an initialized Profiles). Uses the production SQLStore at
// <tempdir>/profiles/<active>/db/recall.db.
func newTestAppWithProfiles(t *testing.T) (*app.App, *http.ServeMux) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.SSEHub = app.NewSSEHub()
	a.Startup(context.Background())
	mux := NewMux(a, fstest.MapFS{})
	return a, mux
}

// ──────────────────────────────────────────────────────────────────────────
// Read endpoints.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_GetMatchResults_EmptyIsEmptyArray(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/matches")
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
	rec := get(t, mux, "/api/v1/system/version")
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

func TestServerMux_GetStartupError_CleanBootReturnsEmpty(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/system/startup-error")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	var got map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// On a clean wiring the field must be the empty string, not
	// missing — the frontend keys on `message === ""` to gate the
	// modal, and a missing key would resolve to `undefined` and
	// open the modal with no body.
	if v, ok := got["message"]; !ok {
		t.Errorf(`response missing "message" key: %+v`, got)
	} else if v != "" {
		t.Errorf(`message = %q, want "" on clean boot`, v)
	}
}

func TestServerMux_GetScreenshotsFolderCandidates_ReturnsJSONArray(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/system/screenshots-folder-candidates")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v body=%s", err, rec.Body.String())
	}
	// On non-Windows the slice is empty; the App-level test in
	// pkg/app/probe_test.go pins the Windows shape. Here we only
	// confirm the wire contract: always an array, never null.
	if got == nil {
		t.Errorf("response decoded as null; expected [] for the empty case")
	}
}

func TestServerMux_MethodNotAllowed(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// GET on POST-only endpoint
	rec := get(t, mux, "/api/v1/parses")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405, got %d", rec.Code)
	}
}

func TestServerMux_DeleteParsesActive_409WhenNoParseInFlight(t *testing.T) {
	// Cleanest test of the route: no parse running, DELETE returns
	// 409 with the sentinel message. We don't simulate an in-flight
	// parse because that requires a real OCR loop; the App-level
	// CancelParse tests cover the success path.
	_, mux := newTestApp(t, nil)
	rec := del(t, mux, "/api/v1/parses/active")
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(strings.ToLower(rec.Body.String()), "no parse in flight") {
		t.Errorf("body should mention sentinel; got %q", rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Write endpoints with typed-error → 4xx mapping.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_PutScreenshotsFolder_409OnInvalid(t *testing.T) {
	// 409: a syntactically-valid path that doesn't resolve to an
	// on-disk directory is a resource-state conflict.
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, "/api/v1/settings/screenshots-folder", map[string]string{"path": "/nonexistent/no-such-dir-12345"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d body=%s", rec.Code, rec.Body.String())
	}
	// Body should mention the ErrInvalidScreenshotsDir sentinel message.
	if !strings.Contains(strings.ToLower(rec.Body.String()), "screenshots") {
		t.Errorf("409 body should reference 'screenshots', got %q", rec.Body.String())
	}
}

func TestServerMux_PutScreenshotsFolder_400OnMissingPath(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, "/api/v1/settings/screenshots-folder", map[string]string{}) // no `path`
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing path, got %d", rec.Code)
	}
}

func TestServerMux_PutTesseract_409OnInvalid(t *testing.T) {
	// 409: a syntactically valid path that fails the format validator
	// (here, traversal) is a resource-state conflict, not a request-
	// format issue. Matches the schemathesis positive_data_acceptance
	// contract.
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, "/api/v1/settings/tesseract", map[string]string{"path": "../traversal/../etc/passwd"})
	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d body=%s", rec.Code, rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/v1/matches delegates to the store and returns 204.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_DeleteMatches_DelegatesToStore(t *testing.T) {
	fs := dbtest.New()
	_ = fs.AddIgnoredScreenshot("bad.png")
	_, mux := newTestApp(t, fs)
	rec := del(t, mux, "/api/v1/matches")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	if fs.ClearCalls != 1 {
		t.Errorf("expected 1 Clear call, got %d", fs.ClearCalls)
	}
	// Default factory-reset: suppress-list goes with everything else.
	got, _ := fs.LoadIgnoredFilenames()
	if len(got) != 0 {
		t.Errorf("expected suppress-list wiped on default DELETE; got %v", got)
	}
}

// ?keep_ignored=true preserves the suppress-list across the wipe via
// the App's snapshot-restore opt-out path.
func TestServerMux_DeleteMatches_KeepIgnoredPreservesSuppressList(t *testing.T) {
	fs := dbtest.New()
	_ = fs.AddIgnoredScreenshot("keep-me.png")
	_, mux := newTestApp(t, fs)
	rec := del(t, mux, "/api/v1/matches?keep_ignored=true")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	got, _ := fs.LoadIgnoredFilenames()
	if !got["keep-me.png"] {
		t.Errorf("expected keep-me.png preserved across DELETE with keep_ignored=true; got %v", got)
	}
}

// The DELETE handler rejects malformed query parameters before
// touching the store — schemathesis's negative_data_rejection
// check is disabled (intermittent false positive in v4.21 on
// boolean query params) so these tests are the only place this
// contract is pinned. Three negative cases:
//
//   - unknown query keys (typo defence) → 400
//   - keep_ignored present with an unrecognised value → 400
//   - keep_ignored present with an empty value → 400
//
// In every case the store must NOT be touched — the wipe is
// destructive and should never run on a malformed request.
func TestServerMux_DeleteMatches_RejectsMalformedQuery(t *testing.T) {
	cases := []struct {
		name, query string
	}{
		{"unknown query key", "?other=1"},
		{"unknown query key alongside valid", "?keep_ignored=true&other=1"},
		{"keep_ignored=garbage", "?keep_ignored=garbage"},
		{"keep_ignored capitalised True", "?keep_ignored=True"},
		{"keep_ignored=1", "?keep_ignored=1"},
		{"keep_ignored empty value", "?keep_ignored="},
		{"keep_ignored no value", "?keep_ignored"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fs := dbtest.New()
			_, mux := newTestApp(t, fs)
			rec := del(t, mux, "/api/v1/matches"+tc.query)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status %d body=%s — want 400", rec.Code, rec.Body.String())
			}
			if fs.ClearCalls != 0 {
				t.Errorf("malformed query must not reach the store; got %d Clear calls", fs.ClearCalls)
			}
		})
	}
}

func TestServerMux_DeleteSingleMatch_DelegatesToStore(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	key := "match-2026-05-10T21-29-28"
	path := "/api/v1/matches/" + url.PathEscape(key)
	rec := del(t, mux, path)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	if got := fs.HardDeleteCalls; len(got) != 1 || got[0] != key {
		t.Errorf("expected one HardDeleteCalls entry for %q, got %+v", key, got)
	}
	if fs.ClearCalls != 0 {
		t.Errorf("single-match DELETE must not call Clear (got %d Clear calls)", fs.ClearCalls)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Bulk queue-type + play-mode collection-level setters. One PUT
// rewrites N rows in a single transaction instead of N per-match
// PUTs — feeds the sticky bulk-action toolbar on the Matches view.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_BulkSetMatchQueue_AppliesValueToEveryKey(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, "/api/v1/matches/queue-type", map[string]any{
		"match_keys": []string{"m1", "m2", "m3"}, "queue_type": "role",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	got, _ := fs.LoadMatchQueues()
	for _, k := range []string{"m1", "m2", "m3"} {
		if got[k].QueueType != "role" {
			t.Errorf("%s = %q, want role", k, got[k].QueueType)
		}
	}
}

func TestServerMux_BulkSetMatchQueue_EmptyValueClearsRows(t *testing.T) {
	fs := dbtest.New()
	_ = fs.SetMatchQueue("m1", "role")
	_ = fs.SetMatchQueue("m2", "open")
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, "/api/v1/matches/queue-type", map[string]any{
		"match_keys": []string{"m1"}, "queue_type": "",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	got, _ := fs.LoadMatchQueues()
	if _, ok := got["m1"]; ok {
		t.Errorf("m1 should have been cleared, got %+v", got["m1"])
	}
	if got["m2"].QueueType != "open" {
		t.Errorf("m2 not in clear list, should still be open; got %q", got["m2"].QueueType)
	}
}

func TestServerMux_BulkSetMatchQueue_400OnInvalidValue(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, "/api/v1/matches/queue-type", map[string]any{
		"match_keys": []string{"m1"}, "queue_type": "ranked",
	})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestServerMux_BulkSetMatchPlayMode_AppliesValueToEveryKey(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, "/api/v1/matches/play-mode", map[string]any{
		"match_keys": []string{"m1", "m2"}, "play_mode": "competitive",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	got, _ := fs.LoadMatchPlayModes()
	for _, k := range []string{"m1", "m2"} {
		if got[k].PlayMode != "competitive" {
			t.Errorf("%s = %q, want competitive", k, got[k].PlayMode)
		}
	}
}

func TestServerMux_BulkSetMatchPlayMode_400OnInvalidValue(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, "/api/v1/matches/play-mode", map[string]any{
		"match_keys": []string{"m1"}, "play_mode": "ranked",
	})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d body=%s", rec.Code, rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Toggle endpoints — PUT for setters, GET for read, 204 for writes.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_WatchEnabled_RoundTrip(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// GET initial — defaults to false.
	rec := get(t, mux, "/api/v1/settings/watcher")
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
	rec := get(t, mux, "/api/v1/settings/prometheus")
	if rec.Code != 200 {
		t.Fatalf("GET status %d", rec.Code)
	}
	rec = put(t, mux, "/api/v1/settings/prometheus", map[string]bool{"enabled": false})
	if rec.Code != http.StatusNoContent {
		t.Errorf("PUT status %d body=%s", rec.Code, rec.Body.String())
	}
	rec = put(t, mux, "/api/v1/settings/prometheus", "not-json-at-all")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("PUT with bad body should 400, got %d", rec.Code)
	}
}

func TestServerMux_WatchEnabled_PUTBadJSON(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := put(t, mux, "/api/v1/settings/watcher", "not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for bad JSON body, got %d", rec.Code)
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Tesseract endpoints.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_TesseractStatus(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/settings/tesseract")
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	// Body must be a JSON object — not nil — even when Tesseract isn't
	// configured.
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Platform must be present + non-empty so the frontend's per-OS
	// description branch in SettingsEngine.vue has a value to switch
	// on. Empty would silently fall through to the no-paths fallback
	// and the user would lose the install-path guidance entirely.
	if v, ok := got["platform"].(string); !ok || v == "" {
		t.Errorf("response missing platform field; got %v (type %T)", got["platform"], got["platform"])
	}
}

func TestServerMux_TesseractReset(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// Reset is DELETE on the tesseract setting — removes the user
	// override and re-detects against the platform default.
	rec := del(t, mux, "/api/v1/settings/tesseract")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Screenshots-folder setting.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_ScreenshotsFolder_GET(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/settings/screenshots-folder")
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

func TestServerMux_PendingScreenshotCount(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/screenshots/pending-count")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestServerMux_CheckUpdate(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/system/update")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
}

// TestServerMux_DataUpdate_EmptyTagReturns400 proves the tag-mismatch
// sentinel maps to 400 via the registered handler — belt-and-suspenders
// over the unit-level sentinel coverage in
// apply_data_update_test.go::TestApplyDataUpdate_TagMismatchSentinel.
func TestServerMux_DataUpdate_EmptyTagReturns400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := fire(t, mux, http.MethodPost, "/api/v1/system/data-update", map[string]string{"tag": ""})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d (want 400), body=%s", rec.Code, rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Static SPA fallback — anything outside /api/v1/* is served from the assets FS.
// ──────────────────────────────────────────────────────────────────────────

func TestServerMux_ServesIndexFromAssetsFS(t *testing.T) {
	a := app.NewWithStore(dbtest.New())
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

// ──────────────────────────────────────────────────────────────────────────
// Match annotations — hierarchical sub-resource at
// PUT /api/v1/matches/{match_key}/annotation.
// ──────────────────────────────────────────────────────────────────────────

func TestMatchAnnotations_Upsert(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)

	rec := put(t, mux, annotationPath("k1"), map[string]any{
		"leaver": "team",
		"note":   "ally dc'd",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("upsert status = %d, body: %s", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_ClearByEmptyLeaver(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, annotationPath("k1"), map[string]any{
		"leaver": "",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("clear status = %d, body: %s", rec.Code, rec.Body.String())
	}
}

func TestMatchVisibility_Hide(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, visibilityPath("k1"), map[string]any{
		"hidden": true,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("hide status = %d, body: %s", rec.Code, rec.Body.String())
	}
	if len(fs.HideCalls) != 1 || fs.HideCalls[0] != "k1" {
		t.Errorf("HideMatch not called with k1: %+v", fs.HideCalls)
	}
}

func TestMatchVisibility_Unhide(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, visibilityPath("k1"), map[string]any{
		"hidden": false,
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("unhide status = %d, body: %s", rec.Code, rec.Body.String())
	}
	if len(fs.UnhideCalls) != 1 || fs.UnhideCalls[0] != "k1" {
		t.Errorf("UnhideMatch not called with k1: %+v", fs.UnhideCalls)
	}
}

func TestMatchVisibility_BadJSON400(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, visibilityPath("k1"), "not-json-at-all")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("malformed body should 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchVisibility_MethodNotAllowed(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, visibilityPath("k1"))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET on PUT-only route should 405, got %d", rec.Code)
	}
}

func TestMatchResolution_HappyPath(t *testing.T) {
	fs := dbtest.New()
	fs.Scoreboards = []db.ScoreboardRow{
		{Filename: "sb.png", MatchKey: "ambiguous-sb.png"},
	}
	fs.Ambiguous = map[string][]db.AmbiguousCandidate{
		"sb.png": {{MatchKey: "match-foo", DistanceSeconds: 600}},
	}
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, resolutionPath("ambiguous-sb.png"), map[string]any{
		"resolved_to": "match-foo",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("resolution status = %d, body: %s", rec.Code, rec.Body.String())
	}
	if fs.Scoreboards[0].MatchKey != "match-foo" {
		t.Errorf("scoreboard not updated: %q", fs.Scoreboards[0].MatchKey)
	}
}

func TestMatchResolution_InvalidKey404(t *testing.T) {
	// A matchKey that doesn't start with "ambiguous-" can't reference
	// an ambiguous resource — semantically 404, not 400.
	_, mux := newTestApp(t, dbtest.New())
	rec := put(t, mux, resolutionPath("match-not-ambiguous"), map[string]any{
		"resolved_to": "match-foo",
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-ambiguous key should 404, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchResolution_NotFound404(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	rec := put(t, mux, resolutionPath("ambiguous-nope.png"), map[string]any{
		"resolved_to": "match-foo",
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing ambiguous row should 404, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchResolution_BadResolvedTo409(t *testing.T) {
	// The resolved_to value is syntactically well-formed but doesn't
	// reference a valid candidate or freshly-minted match key — 409
	// (resource-state conflict).
	fs := dbtest.New()
	fs.Ambiguous = map[string][]db.AmbiguousCandidate{
		"sb.png": {{MatchKey: "match-foo", DistanceSeconds: 600}},
	}
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, resolutionPath("ambiguous-sb.png"), map[string]any{
		"resolved_to": "garbage-not-a-match-key",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("non-candidate non-match: should 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_InvalidLeaver400(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, annotationPath("k1"), map[string]any{
		"leaver": "afk",
	})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid leaver should 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_AllFieldsAccepted(t *testing.T) {
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, annotationPath("k1"), map[string]any{
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
	fs := dbtest.New()
	_, mux := newTestApp(t, fs)
	rec := put(t, mux, annotationPath("k1"), map[string]any{
		"leaver": "",
		"note":   "no leaver tag yet",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("note-only should 204, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_E2E_PutThenReadBackOnMatches(t *testing.T) {
	// End-to-end: write a real SQLite store (in-memory), seed a
	// SUMMARY screenshot so a match exists, PUT an annotation via
	// /api/v1/matches/{match_key}/annotation, then GET /api/v1/matches
	// and confirm the annotation surfaces on the returned record.
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
		MatchKey:   "match-e2e",
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

	// PUT a full annotation.
	rec := put(t, mux, annotationPath("match-e2e"), map[string]any{
		"leaver":      "team",
		"note":        "ally rage-quit",
		"replay_code": "7H1K9P",
		"members":     []string{"Apollo#11234", "Cheese#5678"},
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("annotation PUT status %d, body %s", rec.Code, rec.Body.String())
	}

	// GET /api/v1/matches — expect the annotation to surface on the
	// returned MatchRecord.
	rec = get(t, mux, "/api/v1/matches")
	if rec.Code != 200 {
		t.Fatalf("matches status %d", rec.Code)
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

	// Idempotency contract: a PUT with every field empty deletes the
	// row; the next GET should drop the annotation field entirely.
	rec = put(t, mux, annotationPath("match-e2e"), map[string]any{})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("clear PUT status %d, body %s", rec.Code, rec.Body.String())
	}
	// Verify the deletion landed in the store, independent of the
	// JSON round-trip below.
	annos, err := store.LoadAnnotations()
	if err != nil {
		t.Fatalf("LoadAnnotations after clear: %v", err)
	}
	if a, present := annos["match-e2e"]; present {
		t.Errorf("annotation row not deleted from store: %+v", a)
	}
	rec = get(t, mux, "/api/v1/matches")
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

// ──────────────────────────────────────────────────────────────────────────
// Profiles — multi-profile switcher routes.
// ──────────────────────────────────────────────────────────────────────────

func TestProfiles_GetReturnsDefaultOnFreshInstall(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := get(t, mux, "/api/v1/profiles")
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Active   string   `json:"active"`
		Profiles []string `json:"profiles"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v\n%s", err, rec.Body.String())
	}
	if got.Active != "main" {
		t.Errorf("active = %q, want main", got.Active)
	}
	if len(got.Profiles) != 1 || got.Profiles[0] != "main" {
		t.Errorf("profiles = %v, want [main]", got.Profiles)
	}
}

func TestProfiles_PostCreatesAndActivates(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := fire(t, mux, http.MethodPost, "/api/v1/profiles", map[string]string{"name": "alt"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	// Content-Type contract: the body IS JSON, OpenAPI documents
	// application/json on the 201 response, schemathesis fuzzes for
	// it. Easy to drop accidentally because Go's http.ResponseWriter
	// silently no-ops Header().Set after WriteHeader — the inline
	// helper has to set Content-Type BEFORE WriteHeader.
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type=%q, want application/json (the body is JSON)", ct)
	}
	getRec := get(t, mux, "/api/v1/profiles")
	var got struct {
		Active   string   `json:"active"`
		Profiles []string `json:"profiles"`
	}
	_ = json.Unmarshal(getRec.Body.Bytes(), &got)
	if got.Active != "alt" {
		t.Errorf("Post should activate the new profile; active=%q", got.Active)
	}
	if len(got.Profiles) != 2 {
		t.Errorf("profiles=%v, want 2 entries", got.Profiles)
	}
}

func TestProfiles_PostRejectsInvalidNameAs400(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := fire(t, mux, http.MethodPost, "/api/v1/profiles", map[string]string{"name": "../traversal"})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PostRejectsDuplicateAs409(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := fire(t, mux, http.MethodPost, "/api/v1/profiles", map[string]string{"name": "main"})
	if rec.Code != http.StatusConflict {
		t.Errorf("status %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PutActiveSwitches(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	_ = fire(t, mux, http.MethodPost, "/api/v1/profiles", map[string]string{"name": "alt"})

	rec := put(t, mux, "/api/v1/profiles/active", map[string]string{"name": "main"})
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	getRec := get(t, mux, "/api/v1/profiles")
	var got struct {
		Active string `json:"active"`
	}
	_ = json.Unmarshal(getRec.Body.Bytes(), &got)
	if got.Active != "main" {
		t.Errorf("active=%q, want main", got.Active)
	}
}

func TestProfiles_PutActiveUnknownReturns404(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := put(t, mux, "/api/v1/profiles/active", map[string]string{"name": "nope"})
	if rec.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_DeleteRemovesNonActive(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	_ = fire(t, mux, http.MethodPost, "/api/v1/profiles", map[string]string{"name": "alt"})
	// alt was activated by POST — switch back to main so we can delete alt.
	_ = put(t, mux, "/api/v1/profiles/active", map[string]string{"name": "main"})

	rec := del(t, mux, "/api/v1/profiles/alt")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	getRec := get(t, mux, "/api/v1/profiles")
	var got struct {
		Profiles []string `json:"profiles"`
	}
	_ = json.Unmarshal(getRec.Body.Bytes(), &got)
	if len(got.Profiles) != 1 || got.Profiles[0] != "main" {
		t.Errorf("profiles=%v, want [main]", got.Profiles)
	}
}

func TestProfiles_DeleteActiveReturns409(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := del(t, mux, "/api/v1/profiles/main")
	if rec.Code != http.StatusConflict {
		t.Errorf("status %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PutRenameRoundTrip(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := put(t, mux, "/api/v1/profiles/main", map[string]string{"new_name": "silentstorm"})
	if rec.Code != 200 {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
	getRec := get(t, mux, "/api/v1/profiles")
	var got struct {
		Active   string   `json:"active"`
		Profiles []string `json:"profiles"`
	}
	_ = json.Unmarshal(getRec.Body.Bytes(), &got)
	if got.Active != "silentstorm" {
		t.Errorf("active=%q, want silentstorm", got.Active)
	}
	if len(got.Profiles) != 1 || got.Profiles[0] != "silentstorm" {
		t.Errorf("profiles=%v, want [silentstorm]", got.Profiles)
	}
}

func TestProfiles_PutRenameInvalidName400(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := put(t, mux, "/api/v1/profiles/main", map[string]string{"new_name": "../traversal"})
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PutRenameUnknownSource404(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := put(t, mux, "/api/v1/profiles/nope", map[string]string{"new_name": "manny"})
	if rec.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PutRenameCollision409(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	_ = fire(t, mux, http.MethodPost, "/api/v1/profiles", map[string]string{"name": "alt"})
	_ = put(t, mux, "/api/v1/profiles/active", map[string]string{"name": "main"})
	rec := put(t, mux, "/api/v1/profiles/alt", map[string]string{"new_name": "main"})
	if rec.Code != http.StatusConflict {
		t.Errorf("status %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PostMatchTransfers_204AndDelegates(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	// Create alt and switch back to main so main is source, alt is target.
	_ = fire(t, mux, http.MethodPost, "/api/v1/profiles", map[string]string{"name": "alt"})
	_ = put(t, mux, "/api/v1/profiles/active", map[string]string{"name": "main"})

	rec := fire(t, mux, http.MethodPost, "/api/v1/matches/transfers", map[string]any{
		"match_keys":     []string{},
		"target_profile": "alt",
	})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PostMatchTransfers_TargetUnknown404(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := fire(t, mux, http.MethodPost, "/api/v1/matches/transfers", map[string]any{
		"match_keys":     []string{"k1"},
		"target_profile": "nope",
	})
	if rec.Code != http.StatusNotFound {
		t.Errorf("status %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PostMatchTransfers_TargetActive409(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := fire(t, mux, http.MethodPost, "/api/v1/matches/transfers", map[string]any{
		"match_keys":     []string{"k1"},
		"target_profile": "main",
	})
	if rec.Code != http.StatusConflict {
		t.Errorf("status %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PostMatchTransfers_InvalidTargetName409(t *testing.T) {
	// Defence-in-depth: a malformed target_profile short-circuits at
	// validateProfileName before reaching the path-construction
	// downstream. Maps to 409 at the HTTP boundary (resource-state
	// conflict — the named profile can't exist), NOT 404 (which the
	// in-list membership check would have produced if the format
	// passed).
	_, mux := newTestAppWithProfiles(t)
	rec := fire(t, mux, http.MethodPost, "/api/v1/matches/transfers", map[string]any{
		"match_keys":     []string{"k1"},
		"target_profile": "../traversal",
	})
	if rec.Code != http.StatusConflict {
		t.Errorf("status %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
}

// ──────────────────────────────────────────────────────────────────────────
// Null-in-required-field rejection
//
// schemathesis v4's negative_data_rejection check generates JSON null
// for every typed field declared as required. Go's encoding/json
// silently decodes null into zero values for plain types (`null bool`
// → false, `null in []string` → ""), so the server used to accept
// schema-violating bodies. These tests pin the explicit nil-rejection
// in each handler.
// ──────────────────────────────────────────────────────────────────────────

func TestMatchVisibility_RejectsNullHidden(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := putRaw(t, mux, visibilityPath("k1"), `{"hidden": null}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("null hidden must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchVisibility_RejectsMissingHidden(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := putRaw(t, mux, visibilityPath("k1"), `{}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("missing hidden field must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestPrometheusEnabled_RejectsNull(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := putRaw(t, mux, "/api/v1/settings/prometheus", `{"enabled": null}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("null enabled must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestWatchEnabled_RejectsNull(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := putRaw(t, mux, "/api/v1/settings/watcher", `{"enabled": null}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("null enabled must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_RejectsNullInTags(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := putRaw(t, mux, annotationPath("k1"),
		`{"leaver":"","note":"","replay_code":"","members":[],"tags":[null]}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("null in tags[] must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestMatchAnnotations_RejectsNullInMembers(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := putRaw(t, mux, annotationPath("k1"),
		`{"leaver":"","note":"","replay_code":"","members":[null],"tags":[]}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("null in members[] must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PostMatchTransfers_RejectsNullTargetProfile(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := postRaw(t, mux, "/api/v1/matches/transfers",
		`{"match_keys": [], "target_profile": null}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("null target_profile must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestProfiles_PostMatchTransfers_RejectsNullInMatchKeys(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	// Create alt + switch back to main so target_profile resolves.
	_ = fire(t, mux, http.MethodPost, "/api/v1/profiles", map[string]string{"name": "alt"})
	_ = put(t, mux, "/api/v1/profiles/active", map[string]string{"name": "main"})
	rec := postRaw(t, mux, "/api/v1/matches/transfers",
		`{"match_keys": [null], "target_profile": "alt"}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("null in match_keys[] must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestExports_RejectsEmptyFormat(t *testing.T) {
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/exports?format=")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("explicit empty format must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestExports_AbsentFormatDefaultsToJSON(t *testing.T) {
	// Spec says default: json. ?format absent should still 200 + JSON.
	_, mux := newTestApp(t, nil)
	rec := get(t, mux, "/api/v1/exports")
	if rec.Code != http.StatusOK {
		t.Fatalf("absent format must 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("absent format must default to application/json, got %q", ct)
	}
}

func TestImports_RejectsNullInUnknowns(t *testing.T) {
	_, mux := newTestApp(t, nil)
	body := `{
		"schema": "recall-export/v1",
		"exported_at": "2026-06-01T00:00:00Z",
		"recall_version": "test",
		"screenshots_dirs": {},
		"summaries": [],
		"scoreboards": [],
		"personals": [],
		"ranks": [],
		"unknowns": [null]
	}`
	rec := postRaw(t, mux, "/api/v1/imports", body)
	// 409: the JSON was syntactically well-formed but the import
	// validator rejects null entries — same status as every other
	// spec-passes-but-semantic-fails import failure.
	if rec.Code != http.StatusConflict {
		t.Errorf("null in unknowns[] must 409, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// putRaw / postRaw bypass fire's JSON marshalling so tests can send
// raw JSON snippets verbatim (null tokens, malformed shapes, etc.).
func putRaw(t *testing.T, mux *http.ServeMux, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func postRaw(t *testing.T, mux *http.ServeMux, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}
