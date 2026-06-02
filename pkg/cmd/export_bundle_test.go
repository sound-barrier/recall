package cmd

import (
	"archive/zip"
	"bytes"
	"net/http"
	"strings"
	"testing"

	"recall/pkg/db/dbtest"
)

// TestExportBundle_PostReturnsZip drives the new bundle endpoint
// through httptest. The dbtest.Fake is empty, so the response body is
// a small ZIP containing just the manifest + data.json.
func TestExportBundle_PostReturnsZip(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := fire(t, mux, http.MethodPost, "/api/v1/exports/bundle", map[string]any{
		"match_keys":      []string{},
		"include_unknown": false,
		"include_hidden":  false,
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "recall-bundle-") {
		t.Errorf("Content-Disposition = %q, expected recall-bundle- prefix", cd)
	}

	// The body is a parseable ZIP with manifest.json + data.json.
	body := rec.Body.Bytes()
	zr, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("parse zip: %v", err)
	}
	have := map[string]bool{}
	for _, f := range zr.File {
		have[f.Name] = true
	}
	if !have["manifest.json"] {
		t.Error("manifest.json missing from bundle response")
	}
	if !have["data.json"] {
		t.Error("data.json missing from bundle response")
	}
}

func TestExportBundle_PostRejectsMalformedJSON(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())
	rec := postRaw(t, mux, "/api/v1/exports/bundle", "{not json")
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}
