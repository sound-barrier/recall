package cmd_test

import (
	"context"
	"net/http"
	"testing"

	"recall/pkg/db/dbtest"
)

// stubSelfUpdater satisfies app.SelfUpdater with immediate no-op returns
// so the handler tests exercise only the 202-vs-409 transport mapping.
type stubSelfUpdater struct{}

func (stubSelfUpdater) Check(context.Context) (bool, error)      { return false, nil }
func (stubSelfUpdater) DownloadAndInstall(context.Context) error { return nil }
func (stubSelfUpdater) Restart(context.Context) error            { return nil }

func TestPostSelfUpdate_NoUpdater_Returns409(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := fire(t, mux, "POST", "/api/v1/system/self-update", nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 when no updater is wired", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
}

func TestPostSelfUpdate_WithUpdater_Returns202(t *testing.T) {
	a, mux := newTestApp(t, dbtest.New())
	a.SelfUpdate = stubSelfUpdater{}

	rec := fire(t, mux, "POST", "/api/v1/system/self-update", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body %s", rec.Code, rec.Body.String())
	}
	if rec.Body.Len() != 0 {
		t.Errorf("202 body = %q, want empty", rec.Body.String())
	}
}

func TestPostSelfUpdateRestart_NoUpdater_Returns409(t *testing.T) {
	_, mux := newTestApp(t, dbtest.New())

	rec := fire(t, mux, "POST", "/api/v1/system/self-update/restart", nil)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
}

func TestPostSelfUpdateRestart_WithUpdater_Returns202(t *testing.T) {
	a, mux := newTestApp(t, dbtest.New())
	a.SelfUpdate = stubSelfUpdater{}

	rec := fire(t, mux, "POST", "/api/v1/system/self-update/restart", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body %s", rec.Code, rec.Body.String())
	}
}
