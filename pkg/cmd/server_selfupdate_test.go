package cmd_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"recall/pkg/db/dbtest"
)

// stubSelfUpdater satisfies app.SelfUpdater with immediate returns so the
// handler tests exercise only the 202-vs-409 transport mapping. found makes
// a pass find (and stage) a release.
type stubSelfUpdater struct{ found bool }

func (s stubSelfUpdater) Check(context.Context) (bool, error)    { return s.found, nil }
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

// stagedMux wires an updater and runs a pass to the staged state.
func stagedMux(t *testing.T) *http.ServeMux {
	t.Helper()
	a, mux := newTestApp(t, dbtest.New())
	a.SelfUpdate = stubSelfUpdater{found: true}
	if rec := fire(t, mux, "POST", "/api/v1/system/self-update", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("start status = %d", rec.Code)
	}
	deadline := time.Now().Add(2 * time.Second)
	for fire(t, mux, "POST", "/api/v1/system/self-update", nil).Code != http.StatusConflict {
		if time.Now().After(deadline) {
			t.Fatal("the pass never staged its release")
		}
		time.Sleep(5 * time.Millisecond)
	}
	return mux
}

func TestPostSelfUpdateRestart_WithUpdater_Returns202(t *testing.T) {
	mux := stagedMux(t)

	rec := fire(t, mux, "POST", "/api/v1/system/self-update/restart", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body %s", rec.Code, rec.Body.String())
	}
}

func TestPostSelfUpdateRestart_NothingStaged_Returns409(t *testing.T) {
	a, mux := newTestApp(t, dbtest.New())
	a.SelfUpdate = stubSelfUpdater{}

	rec := fire(t, mux, "POST", "/api/v1/system/self-update/restart", nil)
	assertProblem(t, rec, http.StatusConflict, "self-update-not-ready", "no update is staged")
}

// A staged release is not discarded by a second start.
func TestPostSelfUpdate_AfterStaged_Returns409(t *testing.T) {
	rec := fire(t, stagedMux(t), "POST", "/api/v1/system/self-update", nil)
	assertProblem(t, rec, http.StatusConflict, "self-update-staged", "already staged")
}
