package cmd_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"

	"recall/pkg/app"
	"recall/pkg/cmd"
	"recall/pkg/db/dbtest"
)

// The /api/v1/system/... read + action surface.

// GET /system/data-location is what Settings → Directories renders and
// what `scripts/db/db-where.sh` has to agree with. The invariant that
// matters is that all three paths derive from ONE base — a handler (or
// App) that reported the install root while writing into the active
// profile would send a user editing the wrong settings.json.
func TestDataLocation_PathsAllHangOffTheReportedBaseDir(t *testing.T) {
	base := t.TempDir()
	t.Setenv("RECALL_DATA_DIR", base)
	_, mux := newTestApp(t, dbtest.New())

	rec := get(t, mux, "/api/v1/system/data-location")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var got struct {
		BaseDir      string `json:"base_dir"`
		SettingsPath string `json:"settings_path"`
		DatabasePath string `json:"database_path"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v (%s)", err, rec.Body.String())
	}
	if got.BaseDir != base {
		t.Errorf("base_dir = %q, want the configured data dir %q", got.BaseDir, base)
	}
	if want := filepath.Join(base, "settings.json"); got.SettingsPath != want {
		t.Errorf("settings_path = %q, want %q", got.SettingsPath, want)
	}
	if want := filepath.Join(base, "db", "recall.db"); got.DatabasePath != want {
		t.Errorf("database_path = %q, want %q", got.DatabasePath, want)
	}
}

// Every collection on the reference-data + probe endpoints is declared
// `type: array` in the spec, and a nil Go slice marshals to `null` —
// which breaks the schema, trips schemathesis, and makes the frontend's
// `.map()` calls throw instead of rendering an empty list.
func TestSystemReads_CollectionsAreArraysNeverNull(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := get(t, mux, "/api/v1/system/reference-data")
	if rec.Code != http.StatusOK {
		t.Fatalf("reference-data status = %d, want 200", rec.Code)
	}
	var ref struct {
		HeroesByRole      map[string][]string `json:"heroes_by_role"`
		MapsByGameMode    map[string][]string `json:"maps_by_game_mode"`
		ScreenshotSources []json.RawMessage   `json:"screenshot_sources"`
		Seasons           []json.RawMessage   `json:"seasons"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &ref); err != nil {
		t.Fatalf("decode reference-data: %v", err)
	}
	if ref.ScreenshotSources == nil || ref.Seasons == nil {
		t.Errorf("screenshot_sources / seasons decoded as null: %+v", ref)
	}
	for _, role := range []string{"tank", "dps", "support"} {
		if len(ref.HeroesByRole[role]) == 0 {
			t.Errorf("heroes_by_role[%q] is empty; the roster failed to load", role)
		}
	}
	if len(ref.MapsByGameMode) == 0 {
		t.Error("maps_by_game_mode is empty; the map roster failed to load")
	}

	assertJSONArray(t, get(t, mux, "/api/v1/system/screenshots-folder-candidates/stats"))

	// The tesseract probe's `tried` list is the "here's everywhere I
	// looked" disclosure Settings renders when the binary is missing;
	// null would blank the whole diagnostic.
	var probeResult struct {
		Tried []string `json:"tried"`
	}
	probeRec := get(t, mux, "/api/v1/system/tesseract-probe")
	if err := json.Unmarshal(probeRec.Body.Bytes(), &probeResult); err != nil {
		t.Fatalf("decode tesseract-probe: %v (%s)", err, probeRec.Body.String())
	}
	if len(probeResult.Tried) == 0 {
		t.Errorf("tesseract-probe reported no candidate paths: %s", probeRec.Body.String())
	}
}

// assertJSONArray fails unless the response is a 200 whose body decodes
// into a non-nil JSON array (the `[]`-not-`null` wire rule).
func assertJSONArray(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var got []json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("body is not a JSON array: %v (%s)", err, rec.Body.String())
	}
	if got == nil {
		t.Errorf("body decoded as null; the spec declares type: array")
	}
}

// POST /system/screenshots-folder-reveal with nothing configured is a
// 409 conflict, not a 500 — "you haven't picked a folder yet" is a
// state the user reaches by doing nothing, and the frontend keys the
// inline hint off the status.
func TestRevealScreenshotsFolder_UnconfiguredIsConflict(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	_, mux := newTestApp(t, dbtest.New())
	rec := fire(t, mux, http.MethodPost, "/api/v1/system/screenshots-folder-reveal", nil)
	assertProblem(t, rec, http.StatusConflict, "conflict", "screenshots directory")
}

// pprof dumps heap + goroutine state with no auth, so the mount is
// opt-in. The default build must answer 404 on /debug/pprof/ — if the
// handlers ever mount unconditionally, an operator who binds
// RECALL_SERVER_ADDR to a LAN address exposes process memory.
func TestNewMux_PprofMountsOnlyWhenOptedIn(t *testing.T) {
	_, off := newTestApp(t, dbtest.New())
	if rec := get(t, off, "/debug/pprof/"); rec.Code != http.StatusNotFound {
		t.Errorf("pprof reachable without RECALL_PPROF: status = %d, want 404", rec.Code)
	}

	t.Setenv("RECALL_PPROF", "1")
	a := app.NewWithStore(dbtest.New())
	a.SSEHub = app.NewSSEHub()
	on := cmd.NewMux(a, fstest.MapFS{})
	for _, path := range []string{"/debug/pprof/", "/debug/pprof/cmdline"} {
		if rec := get(t, on, path); rec.Code != http.StatusOK {
			t.Errorf("%s status = %d with RECALL_PPROF set, want 200", path, rec.Code)
		}
	}
}
