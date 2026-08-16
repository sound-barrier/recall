package cmd_test

import (
	"net/http"
	"testing"
)

// The RECALL_E2E-gated reset route. Absent from a released binary — the
// harness sets the env var, nothing else does.

const testResetPath = "/api/v1/system/test-reset"

func TestTestReset_NotRegisteredWithoutTheE2EFlag(t *testing.T) {
	mux := newTestAppWithProfiles(t)
	if rec := fire(t, mux, http.MethodPost, testResetPath, nil); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (route must not exist off-harness)", rec.Code)
	}
}

// A reset is a clean slate, and the coaching write gate refuses every
// mutating step while a session is open — so the reset has to end one
// first. Schemathesis opens sessions and never closes them, which would
// otherwise wedge every later fuzz case behind a 409.
func TestTestReset_EndsAnOpenCoachingSession(t *testing.T) {
	t.Setenv("RECALL_E2E", "1")
	mux := newTestAppWithProfiles(t)

	rec := postBytes(t, mux, sessionPath, coachBundle(t, "Sable", sessionMatch1))
	if rec.Code != http.StatusCreated {
		t.Fatalf("open status = %d, want 201; body=%q", rec.Code, rec.Body.String())
	}
	if rec := fire(t, mux, http.MethodPost, testResetPath, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("reset status = %d, want 204; body=%q", rec.Code, rec.Body.String())
	}
	if rec := get(t, mux, sessionPath); rec.Code != http.StatusNotFound {
		t.Fatalf("session survived the reset: status = %d, want 404", rec.Code)
	}
}
