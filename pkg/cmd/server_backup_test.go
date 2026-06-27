package cmd_test

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Backup / restore / merge-import HTTP contract.
//
//   - GET  /api/v1/database  → native .db snapshot (binary)
//   - PUT  /api/v1/database  → restore (replace); 204 / 400 / 422
//   - POST /api/v1/imports   → MERGE a bundle's matches; 200 {imported, skipped}
//
// The merge handler splits payload-level vs semantic failures into 400 vs 409
// via the app-layer ErrImportMalformed sentinel.

func TestServerMux_Import_NotABundle_Returns400(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// Neither a PK-led ZIP nor a readable bundle — ErrImportMalformed → 400.
	rec := postRaw(t, mux, "/api/v1/imports", "garbage payload")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%q", rec.Code, rec.Body.String())
	}
}

func TestServerMux_Import_UnsupportedBundleSchema_Returns409(t *testing.T) {
	_, mux := newTestApp(t, nil)
	// A readable ZIP whose manifest names a schema this build doesn't know:
	// past the malformed gate, so the handler falls through to 409.
	bundle := buildBundle(t, "recall-bundle/v9999", "recall-export/v1", nil)
	rec := postBytes(t, mux, "/api/v1/imports", bundle)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%q", rec.Code, rec.Body.String())
	}
}

func TestServerMux_Import_ValidBundle_Returns200WithSummary(t *testing.T) {
	_, mux := newTestApp(t, nil)
	bundle := buildBundle(t, "recall-bundle/v1", "recall-export/v1", []bundleSummary{
		{Filename: "a.png", MatchKey: "match-A"},
	})
	rec := postBytes(t, mux, "/api/v1/imports", bundle)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var got struct {
		Imported int `json:"imported"`
		Skipped  int `json:"skipped"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode summary: %v", err)
	}
	if got.Imported != 1 || got.Skipped != 0 {
		t.Fatalf("summary = %+v, want {Imported:1, Skipped:0}", got)
	}
}

func TestServerMux_Backup_ReturnsSQLiteSnapshot(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := get(t, mux, "/api/v1/database")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/octet-stream" {
		t.Errorf("Content-Type = %q, want application/octet-stream", ct)
	}
	if !strings.HasPrefix(rec.Body.String(), "SQLite format 3\x00") {
		t.Errorf("body does not start with the SQLite file header")
	}
}

func TestServerMux_Restore_RoundTrips(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	snapshot := get(t, mux, "/api/v1/database").Body.Bytes()

	rec := putBytes(t, mux, "/api/v1/database", snapshot)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("restore status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
}

func TestServerMux_Restore_RejectsGarbage_Returns422(t *testing.T) {
	_, mux := newTestAppWithProfiles(t)
	rec := putBytes(t, mux, "/api/v1/database", []byte("not a sqlite database"))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body=%q", rec.Code, rec.Body.String())
	}
}

// ── bundle-building test helpers ──────────────────────────────────────────

type bundleSummary struct {
	Filename string `json:"filename"`
	MatchKey string `json:"match_key"`
}

// buildBundle assembles a minimal recall-bundle ZIP (manifest.json + data.json,
// no screenshots) with the given manifest + data schema strings and summary
// rows — enough to drive the import handler without a full ExportBundle.
func buildBundle(t *testing.T, manifestSchema, dataSchema string, summaries []bundleSummary) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	writeJSONEntry(t, zw, "manifest.json", map[string]any{"schema": manifestSchema})
	writeJSONEntry(t, zw, "data.json", map[string]any{
		"schema":    dataSchema,
		"summaries": summaries,
	})
	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func writeJSONEntry(t *testing.T, zw *zip.Writer, name string, v any) {
	t.Helper()
	w, err := zw.Create(name)
	if err != nil {
		t.Fatalf("zip create %s: %v", name, err)
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		t.Fatalf("encode %s: %v", name, err)
	}
}

func postBytes(t *testing.T, mux *http.ServeMux, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func putBytes(t *testing.T, mux *http.ServeMux, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPut, path, bytes.NewReader(body))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}
