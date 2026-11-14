package cmd_test

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"recall/pkg/app"
	"recall/pkg/cmd"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/snapshot"
)

// A read or write that arrives while the store is being swapped (a restore,
// a profile switch or rename) is refused with 503 and a Retry-After: the
// server is briefly unable to serve ANY store-backed request, which is what
// 503 means — nothing about the request or the resource it names is in
// conflict, so the 409 this used to share with real conflicts sent clients
// the wrong signal. With no store open at all (a swap that could reopen
// none), the same 503 without the promise of a quick retry.

// closeGate is a store whose Close blocks until released, holding a swap
// open mid-way.
type closeGate struct {
	db.Store
	closing chan struct{}
	release chan struct{}
}

func (c *closeGate) Close() error {
	close(c.closing)
	<-c.release
	return nil
}

func TestStoreSwap_ARequestMidSwapIs503WithRetryAfter(t *testing.T) {
	base := t.TempDir()
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", base)
	src := filepath.Join(t.TempDir(), "src.db")
	seed, err := db.NewSQLStore(src)
	if err != nil {
		t.Fatal(err)
	}
	_ = seed.Close()
	payload, err := snapshot.Read(src)
	if err != nil {
		t.Fatal(err)
	}

	gate := &closeGate{Store: dbtest.New(), closing: make(chan struct{}), release: make(chan struct{})}
	a := app.NewWithStore(gate)
	a.SSEHub = app.NewSSEHub()
	if err := os.MkdirAll(filepath.Join(base, "db"), 0o700); err != nil {
		t.Fatal(err)
	}
	mux := cmd.NewMux(a, fstest.MapFS{})
	restored := make(chan error, 1)
	go func() { restored <- a.RestoreDatabase(payload) }()
	<-gate.closing

	read := get(t, mux, "/api/v1/matches")
	write := fire(t, mux, http.MethodPut, "/api/v1/matches/match-2026-05-10T21-29-28/visibility", map[string]bool{"hidden": true})
	close(gate.release)
	if err := <-restored; err != nil {
		t.Fatalf("RestoreDatabase: %v", err)
	}

	for name, rec := range map[string]int{"read": read.Code, "write": write.Code} {
		if rec != http.StatusServiceUnavailable {
			t.Errorf("%s mid-swap = %d, want 503", name, rec)
		}
	}
	if got := read.Header().Get("Retry-After"); got == "" {
		t.Error("a mid-swap 503 carries no Retry-After")
	}
	assertProblem(t, read, http.StatusServiceUnavailable, "store-swapping", "")
}

func TestStoreSwap_NoStoreOpenIs503(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := &app.App{SSEHub: app.NewSSEHub()}
	rec := get(t, cmd.NewMux(a, fstest.MapFS{}), "/api/v1/matches")
	assertProblem(t, rec, http.StatusServiceUnavailable, "store-unavailable", "")
}
