package cmd_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"testing"

	"recall/pkg/db/dbtest"
)

// The /api/v1/settings/... surface: the auto-backup interval's sentinel
// vocabulary, the screenshots-folder set/reset lifecycle, the uniform
// one-string-body 400, and what a failed settings write looks like on
// the wire.

// newSettingsMux wires a mux whose settings.json lands in a temp dir —
// every test in this file persists a setting, and the default data dir
// is the developer's real one.
func newSettingsMux(t *testing.T) *http.ServeMux {
	t.Helper()
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	_, mux := newTestApp(t, dbtest.New())
	return mux
}

const autoBackupPath = "/api/v1/settings/auto-backup"

// autoBackupInterval reads `interval_days` out of an auto-backup response.
func autoBackupInterval(t *testing.T, body []byte) int {
	t.Helper()
	var got struct {
		IntervalDays *int `json:"interval_days"`
		Stale        bool `json:"stale"`
	}
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("decode auto-backup status %q: %v", body, err)
	}
	if got.IntervalDays == nil {
		t.Fatalf("response missing interval_days: %s", body)
	}
	return *got.IntervalDays
}

// The stored interval is not the effective one: 0 means "never
// configured" and resolves to the weekly default, negatives mean
// "disabled". Both the PUT echo and the next GET must report the
// EFFECTIVE value, or the Settings toggle renders a number the
// scheduler doesn't use.
func TestAutoBackup_SentinelIntervalsResolveToEffectiveValue(t *testing.T) {
	cases := []struct {
		name      string
		put, want int
	}{
		{"explicit interval", 30, 30},
		{"zero resets to the weekly default", 0, 7},
		{"minus one disables", -1, -1},
		{"lower bound", 1, 1},
		{"upper bound", 365, 365},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mux := newSettingsMux(t)
			rec := put(t, mux, autoBackupPath, map[string]any{"interval_days": tc.put})
			if rec.Code != http.StatusOK {
				t.Fatalf("PUT status = %d, want 200; body=%q", rec.Code, rec.Body.String())
			}
			if got := autoBackupInterval(t, rec.Body.Bytes()); got != tc.want {
				t.Errorf("PUT echo interval_days = %d, want %d", got, tc.want)
			}
			if got := autoBackupInterval(t, get(t, mux, autoBackupPath).Body.Bytes()); got != tc.want {
				t.Errorf("GET after PUT interval_days = %d, want %d", got, tc.want)
			}
		})
	}
}

// Out-of-range days carry the sentinel's bounds in `detail`; a body that
// isn't `{"interval_days": <int>}` carries the shape instead. Both are
// 400 invalid-body problems, never a silent clamp.
func TestAutoBackup_RejectsOutOfRangeAndMalformedBodies(t *testing.T) {
	cases := []struct {
		name, body, wantDetail string
	}{
		{"below the disable sentinel", `{"interval_days":-2}`, "want -1..365"},
		{"above the yearly ceiling", `{"interval_days":366}`, "want -1..365"},
		{"missing field", `{}`, `body must be {"interval_days":<int>}`},
		{"null field", `{"interval_days":null}`, `body must be {"interval_days":<int>}`},
		{"wrong type", `{"interval_days":"weekly"}`, `body must be {"interval_days":<int>}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mux := newSettingsMux(t)
			rec := putRaw(t, mux, autoBackupPath, tc.body)
			assertProblem(t, rec, http.StatusBadRequest, "invalid-body", tc.wantDetail)
		})
	}
}

const screenshotsFolderPath = "/api/v1/settings/screenshots-folder"

// screenshotsFolder reads `path` out of a screenshots-folder response.
func screenshotsFolder(t *testing.T, body []byte) string {
	t.Helper()
	var got map[string]string
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("decode %q: %v", body, err)
	}
	v, ok := got["path"]
	if !ok {
		t.Fatalf(`response missing "path" key: %s`, body)
	}
	return v
}

// PUT echoes the path it persisted and DELETE puts the setting back to
// the unconfigured empty state — the Reset button's only contract, and
// the one the parse pipeline reads to decide it has nothing to watch.
func TestScreenshotsFolder_SetEchoesStoredPathAndResetClearsIt(t *testing.T) {
	mux := newSettingsMux(t)
	dir := t.TempDir()

	rec := put(t, mux, screenshotsFolderPath, map[string]any{"path": dir})
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := screenshotsFolder(t, rec.Body.Bytes()); got != dir {
		t.Errorf("PUT echo path = %q, want the stored %q", got, dir)
	}
	if got := screenshotsFolder(t, get(t, mux, screenshotsFolderPath).Body.Bytes()); got != dir {
		t.Errorf("GET after PUT path = %q, want %q", got, dir)
	}

	if rec := del(t, mux, screenshotsFolderPath); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	if got := screenshotsFolder(t, get(t, mux, screenshotsFolderPath).Body.Bytes()); got != "" {
		t.Errorf("path after reset = %q, want the empty unconfigured state", got)
	}
}

// A directory that exists but isn't in canonical form is a 409, not a
// silently-cleaned 200 — that guard is what makes the PUT echo above
// honest about what got stored.
func TestScreenshotsFolder_RejectsNonCanonicalPath(t *testing.T) {
	mux := newSettingsMux(t)
	dir := t.TempDir()
	rec := put(t, mux, screenshotsFolderPath, map[string]any{"path": dir + "/"})
	assertProblem(t, rec, http.StatusConflict, "conflict", "canonical")
	if got := screenshotsFolder(t, get(t, mux, screenshotsFolderPath).Body.Bytes()); got != "" {
		t.Errorf("a rejected path must not persist; got %q", got)
	}
}

// Both one-string setters share decodeRequiredString, whose whole point
// is that every spec-violating shape collapses to the SAME 400 detail —
// a client can't tell "not JSON" from "empty string" and doesn't need to.
func TestRequiredStringSetters_RejectEverySpecViolatingShape(t *testing.T) {
	bodies := []struct{ name, body string }{
		{"not an object", `"nope"`},
		{"field absent", `{}`},
		{"field null", `{"path":null}`},
		{"field not a string", `{"path":123}`},
		{"field whitespace only", `{"path":"   "}`},
	}
	for _, route := range []string{screenshotsFolderPath, "/api/v1/settings/tesseract"} {
		for _, tc := range bodies {
			t.Run(path.Base(route)+" "+tc.name, func(t *testing.T) {
				mux := newSettingsMux(t)
				rec := putRaw(t, mux, route, tc.body)
				assertProblem(t, rec, http.StatusBadRequest, "invalid-body", `body must be {"path":"..."}`)
			})
		}
	}
}

// A settings write that can't hit disk must surface as a 500 problem.
// Returning 204 anyway would leave the UI showing a toggle the next
// restart silently reverts.
func TestSettingsWrites_UnwritableDataDirSurfacesAs500Problem(t *testing.T) {
	cases := []struct {
		name, method, path string
		body               any
	}{
		{"watcher", http.MethodPut, "/api/v1/settings/watcher", map[string]any{"enabled": true}},
		{"close behavior", http.MethodPut, "/api/v1/settings/close-behavior", map[string]any{"exit_on_close": true}},
		{"auto backup", http.MethodPut, autoBackupPath, map[string]any{"interval_days": 14}},
		{"screenshots folder reset", http.MethodDelete, screenshotsFolderPath, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			blockedDataDir(t)
			_, mux := newTestApp(t, dbtest.New())
			rec := fire(t, mux, tc.method, tc.path, tc.body)
			assertProblem(t, rec, http.StatusInternalServerError, "internal", "")
		})
	}
}

// blockedDataDir points RECALL_DATA_DIR at a path occupied by a regular
// file, so every MkdirAll under it fails and settings can never persist.
func blockedDataDir(t *testing.T) {
	t.Helper()
	blocker := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatalf("write blocker file: %v", err)
	}
	t.Setenv("RECALL_DATA_DIR", blocker)
}
