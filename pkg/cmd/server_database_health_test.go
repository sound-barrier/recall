package cmd_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"recall/pkg/db/dbtest"
)

// Settings → Advanced → Database health transport surface.

func TestGetDatabaseHealth_ReportsSnapshot(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := get(t, mux, "/api/v1/database/health")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var h map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &h); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if h["integrity"] != "ok" {
		t.Errorf("integrity = %v, want ok", h["integrity"])
	}
	if _, present := h["checked_at"]; !present {
		t.Error("checked_at missing from the health report")
	}
}

func TestDatabaseMaintenance_OptimizeReturnsFreshHealth(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := fire(t, mux, "POST", "/api/v1/database/maintenance",
		map[string]string{"operation": "optimize"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body %s", rec.Code, rec.Body.String())
	}
	var h map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &h); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if h["integrity"] != "ok" {
		t.Errorf("integrity = %v, want ok", h["integrity"])
	}
}

func TestDatabaseMaintenance_UnknownOperationReturns400(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := fire(t, mux, "POST", "/api/v1/database/maintenance",
		map[string]string{"operation": "defragment"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want problem+json", ct)
	}
}

func TestDatabaseMaintenance_MalformedBodyReturns400(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := fire(t, mux, "POST", "/api/v1/database/maintenance",
		json.RawMessage(`"not an object"`))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}
