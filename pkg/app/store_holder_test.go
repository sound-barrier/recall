package app_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// gatedStore is a store a test can stop in the middle of a call: Close
// announces itself on closing and waits for release, and Health (when
// healthGate is set) announces itself on healthIn and waits for healthGate.
type gatedStore struct {
	db.Store
	closing    chan struct{}
	release    chan struct{}
	healthIn   chan struct{}
	healthGate chan struct{}
}

func newGatedStore() *gatedStore {
	return &gatedStore{
		Store:   dbtest.New(),
		closing: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (g *gatedStore) Close() error {
	close(g.closing)
	<-g.release
	return nil
}

func (g *gatedStore) Health() (db.Health, error) {
	if g.healthGate != nil {
		close(g.healthIn)
		<-g.healthGate
	}
	return g.Store.Health()
}

// restoreRaceApp wires an app onto g and hands back a snapshot it can
// restore, so a test can hold the restore's swap open on g.
func restoreRaceApp(t *testing.T, g *gatedStore) (*app.App, []byte) {
	t.Helper()
	payload, err := newRealApp(t).BackupDatabase()
	mustNoErr(t, err)
	a := app.NewWithStore(g)
	mustNoErr(t, os.MkdirAll(filepath.Join(app.DataDir(a), "db"), 0o700))
	t.Cleanup(func() {
		if s := app.Store(a); s != nil && s != db.Store(g) {
			_ = s.Close()
		}
	})
	return a, payload
}

// The traced bug: a read during a restore went straight to whatever the store
// field held — the store being closed, or nil once it was — so it answered from a
// closing database or panicked. A read during a swap is refused instead.
func TestStoreSwap_AReadDuringARestoreIsRefused(t *testing.T) {
	g := newGatedStore()
	a, payload := restoreRaceApp(t, g)

	restored := make(chan error, 1)
	go func() { restored <- a.RestoreDatabase(payload) }()
	<-g.closing

	_, err := a.GetDatabaseHealth()
	close(g.release)
	if !errors.Is(err, app.ErrStoreSwapInProgress) {
		t.Errorf("read during the swap = %v, want ErrStoreSwapInProgress", err)
	}
	mustNoErr(t, <-restored)
	if _, err := a.GetDatabaseHealth(); err != nil {
		t.Errorf("read after the swap = %v, want the restored store", err)
	}
}

// The other half: a read already running when a swap starts finishes on the
// store it started on. The swap waits for it rather than closing the
// database out from under it.
func TestStoreSwap_ARestoreWaitsForAReadInFlight(t *testing.T) {
	g := newGatedStore()
	g.healthIn, g.healthGate = make(chan struct{}), make(chan struct{})
	a, payload := restoreRaceApp(t, g)

	read := make(chan error, 1)
	go func() {
		_, err := a.GetDatabaseHealth()
		read <- err
	}()
	<-g.healthIn

	restored := make(chan error, 1)
	go func() { restored <- a.RestoreDatabase(payload) }()
	select {
	case <-g.closing:
		t.Error("the swap closed the store while a read was still using it")
	case <-time.After(100 * time.Millisecond):
	}

	close(g.healthGate)
	mustNoErr(t, <-read)
	<-g.closing
	close(g.release)
	mustNoErr(t, <-restored)
}
