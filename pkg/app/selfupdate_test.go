package app_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"recall/pkg/app"
)

// fakeSelfUpdater records calls and lets a test gate Check so the
// single-flight window is observable.
type fakeSelfUpdater struct {
	found      bool
	checkErr   error
	checkGate  chan struct{} // if non-nil, Check blocks until closed
	checks     atomic.Int32
	downloads  atomic.Int32
	restarts   atomic.Int32
	restartErr error
	// downloadErr, when set, fails DownloadAndInstall. Set only while no
	// pass is running.
	downloadErr error
}

func (f *fakeSelfUpdater) Check(context.Context) (bool, error) {
	f.checks.Add(1)
	if f.checkGate != nil {
		<-f.checkGate
	}
	return f.found, f.checkErr
}

func (f *fakeSelfUpdater) DownloadAndInstall(context.Context) error {
	f.downloads.Add(1)
	return f.downloadErr
}

func (f *fakeSelfUpdater) Restart(context.Context) error {
	f.restarts.Add(1)
	return f.restartErr
}

func eventually(t *testing.T, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal(msg)
}

func TestStartSelfUpdate_NilUpdater_ReturnsUnavailable(t *testing.T) {
	a := &app.App{}
	if err := a.StartSelfUpdate(); !errors.Is(err, app.ErrSelfUpdateUnavailable) {
		t.Fatalf("StartSelfUpdate with no updater = %v, want ErrSelfUpdateUnavailable", err)
	}
}

func TestRestartToApply_NilUpdater_ReturnsUnavailable(t *testing.T) {
	a := &app.App{}
	if err := a.RestartToApply(); !errors.Is(err, app.ErrSelfUpdateUnavailable) {
		t.Fatalf("RestartToApply with no updater = %v, want ErrSelfUpdateUnavailable", err)
	}
}

func TestStartSelfUpdate_UpdateFound_DownloadsAndInstalls(t *testing.T) {
	f := &fakeSelfUpdater{found: true}
	a := &app.App{SelfUpdate: f}
	if err := a.StartSelfUpdate(); err != nil {
		t.Fatalf("StartSelfUpdate = %v, want nil", err)
	}
	eventually(t, func() bool { return f.downloads.Load() == 1 },
		"DownloadAndInstall was not called after a found update")
}

func TestStartSelfUpdate_UpToDate_DoesNotDownload(t *testing.T) {
	f := &fakeSelfUpdater{found: false}
	a := &app.App{SelfUpdate: f}
	if err := a.StartSelfUpdate(); err != nil {
		t.Fatalf("StartSelfUpdate = %v", err)
	}
	eventually(t, func() bool { return f.checks.Load() == 1 }, "Check was not called")
	// Give the goroutine a beat; it must not download when up to date.
	time.Sleep(50 * time.Millisecond)
	if f.downloads.Load() != 0 {
		t.Errorf("DownloadAndInstall called %d times for an up-to-date app, want 0", f.downloads.Load())
	}
}

func TestStartSelfUpdate_CheckError_DoesNotDownload(t *testing.T) {
	f := &fakeSelfUpdater{checkErr: errors.New("network down")}
	a := &app.App{SelfUpdate: f}
	_ = a.StartSelfUpdate()
	eventually(t, func() bool { return f.checks.Load() == 1 }, "Check was not called")
	time.Sleep(50 * time.Millisecond)
	if f.downloads.Load() != 0 {
		t.Errorf("DownloadAndInstall called after a check error, want 0")
	}
}

func TestStartSelfUpdate_SingleFlight_SecondCallIsNoOp(t *testing.T) {
	gate := make(chan struct{})
	f := &fakeSelfUpdater{found: true, checkGate: gate}
	a := &app.App{SelfUpdate: f}

	if err := a.StartSelfUpdate(); err != nil { // enters Check, blocks on gate
		t.Fatalf("first StartSelfUpdate = %v", err)
	}
	eventually(t, func() bool { return f.checks.Load() == 1 }, "first Check did not start")

	// Second call while the first is in flight must not start another pass.
	if err := a.StartSelfUpdate(); err != nil {
		t.Fatalf("second StartSelfUpdate = %v, want nil no-op", err)
	}
	time.Sleep(30 * time.Millisecond)
	if got := f.checks.Load(); got != 1 {
		t.Fatalf("Check ran %d times during single-flight window, want 1", got)
	}

	close(gate) // let the first finish
	eventually(t, func() bool { return f.downloads.Load() == 1 }, "first pass did not complete")
}

// A pass that found nothing (or failed) ends idle, so a later call checks
// again.
func TestStartSelfUpdate_AfterAnUpToDatePass_ChecksAgain(t *testing.T) {
	f := &fakeSelfUpdater{found: false}
	a := &app.App{SelfUpdate: f}
	mustNoErr(t, a.StartSelfUpdate())
	eventually(t, func() bool { return app.SelfUpdateStateOf(a) == "idle" && f.checks.Load() == 1 }, "first pass did not end")
	mustNoErr(t, a.StartSelfUpdate())
	eventually(t, func() bool { return f.checks.Load() == 2 }, "updater did not re-run after an up-to-date pass")
}

// stagedApp is an app whose self-update pass has downloaded and staged a
// release: Ready to restart.
func stagedApp(t *testing.T) (*app.App, *fakeSelfUpdater) {
	t.Helper()
	f := &fakeSelfUpdater{found: true}
	a := &app.App{SelfUpdate: f}
	mustNoErr(t, a.StartSelfUpdate())
	eventually(t, func() bool { return app.SelfUpdateStateOf(a) == "ready" }, "the pass never reached ready")
	return a, f
}

// The traced bug: a second StartSelfUpdate after Ready re-ran Check and then
// DownloadAndInstall, which discards the staged binary first — so a failed
// re-download lost an update that was ready to apply. Once staged, a start
// is refused and the staged binary is left alone.
func TestStartSelfUpdate_AfterReady_IsRefusedAndKeepsTheStagedUpdate(t *testing.T) {
	a, f := stagedApp(t)
	if err := a.StartSelfUpdate(); !errors.Is(err, app.ErrSelfUpdateStaged) {
		t.Fatalf("StartSelfUpdate after ready = %v, want ErrSelfUpdateStaged", err)
	}
	time.Sleep(30 * time.Millisecond)
	if f.checks.Load() != 1 || f.downloads.Load() != 1 {
		t.Errorf("checks/downloads = %d/%d after a refused start, want 1/1", f.checks.Load(), f.downloads.Load())
	}
	if got := app.SelfUpdateStateOf(a); got != "ready" {
		t.Errorf("state = %q after a refused start, want ready", got)
	}
}

// A failed download ends in error, and error is not a dead end: the user can
// try again.
func TestStartSelfUpdate_AfterAFailedDownload_CanRetry(t *testing.T) {
	f := &fakeSelfUpdater{found: true, downloadErr: errors.New("connection reset")}
	a := &app.App{SelfUpdate: f}
	mustNoErr(t, a.StartSelfUpdate())
	eventually(t, func() bool { return app.SelfUpdateStateOf(a) == "error" }, "a failed download did not end in error")
	f.downloadErr = nil
	mustNoErr(t, a.StartSelfUpdate())
	eventually(t, func() bool { return app.SelfUpdateStateOf(a) == "ready" }, "a retry after an error did not reach ready")
}

func TestRestartToApply_DelegatesToRestart(t *testing.T) {
	a, f := stagedApp(t)
	if err := a.RestartToApply(); err != nil {
		t.Fatalf("RestartToApply = %v", err)
	}
	if f.restarts.Load() != 1 {
		t.Errorf("Restart called %d times, want 1", f.restarts.Load())
	}
}

func TestRestartToApply_PropagatesError(t *testing.T) {
	sentinel := errors.New("swap failed")
	a, f := stagedApp(t)
	f.restartErr = sentinel
	if err := a.RestartToApply(); !errors.Is(err, sentinel) {
		t.Fatalf("RestartToApply = %v, want the delegated error", err)
	}
}

// RestartToApply asks the app's own state, not only the framework's: with
// nothing staged it refuses before touching the updater.
func TestRestartToApply_BeforeReady_IsRefused(t *testing.T) {
	f := &fakeSelfUpdater{}
	a := &app.App{SelfUpdate: f}
	if err := a.RestartToApply(); !errors.Is(err, app.ErrSelfUpdateNotReady) {
		t.Fatalf("RestartToApply with nothing staged = %v, want ErrSelfUpdateNotReady", err)
	}
	if f.restarts.Load() != 0 {
		t.Errorf("Restart called %d times with nothing staged, want 0", f.restarts.Load())
	}
}
