package app

import (
	"context"
	"errors"
	"fmt"

	"recall/pkg/applog"
)

// SelfUpdater is the in-app binary self-update seam. The Wails wrapper
// (pkg/cmd) adapts the framework's *updater.Updater onto this narrow
// interface and assigns it to App.SelfUpdate; keeping wails/v3 types
// out of pkg/app means the serveronly build never links the updater
// package. Nil App.SelfUpdate means self-update isn't possible on this
// install (server mode, dev build, macOS, or an exe the running user
// can't overwrite) — every caller keys off that.
type SelfUpdater interface {
	// Check reports whether a newer release is available. found=false
	// with err=nil means up to date; err surfaces a check failure. The
	// updater also emits wails:updater:* events the UI observes.
	Check(ctx context.Context) (found bool, err error)
	// DownloadAndInstall streams, verifies, and stages the pending
	// release found by a prior Check. Progress + terminal outcome reach
	// the UI as wails:updater:* events; the returned error is a
	// belt-and-suspenders signal for the caller's log.
	DownloadAndInstall(ctx context.Context) error
	// Restart swaps the staged binary in place and relaunches. Requires
	// a completed DownloadAndInstall.
	Restart(ctx context.Context) error
}

// ErrSelfUpdateUnavailable is returned by StartSelfUpdate /
// RestartToApply when no updater is wired (server mode, dev build,
// macOS, or an unwritable install). The HTTP layer maps it to 409.
var ErrSelfUpdateUnavailable = errors.New("self-update unavailable on this install")

// selfUpdatePhase is where the app's self-update pass stands. It mirrors the
// framework updater's own states, and this is the one place the app keeps
// them: StartSelfUpdate and RestartToApply both step it, so neither has to
// guess what the other did.
type selfUpdatePhase int

const (
	// selfUpdateIdle has no pass running and nothing staged.
	selfUpdateIdle selfUpdatePhase = iota
	// selfUpdateChecking is asking whether a newer release exists.
	selfUpdateChecking
	// selfUpdateDownloading is fetching, verifying and staging it.
	selfUpdateDownloading
	// selfUpdateReady has a release staged for RestartToApply.
	selfUpdateReady
	// selfUpdateError is a pass that failed; a new one may start.
	selfUpdateError
)

func (p selfUpdatePhase) String() string {
	switch p {
	case selfUpdateIdle:
		return "idle"
	case selfUpdateChecking:
		return "checking"
	case selfUpdateDownloading:
		return "downloading"
	case selfUpdateReady:
		return "ready"
	case selfUpdateError:
		return "error"
	}
	return "unknown"
}

// beginPass starts a pass: idle|error → checking. A pass in flight is a
// no-op (started=false), and a staged update refuses, since a new pass would
// discard it.
func (p selfUpdatePhase) beginPass() (next selfUpdatePhase, started bool, err error) {
	switch p {
	case selfUpdateIdle, selfUpdateError:
		return selfUpdateChecking, true, nil
	case selfUpdateChecking, selfUpdateDownloading:
		return p, false, nil
	case selfUpdateReady:
		return p, false, ErrSelfUpdateStaged
	}
	return p, false, fmt.Errorf("self-update in unknown phase %d", p)
}

// StartSelfUpdate kicks off a check-then-download-and-install pass on a
// background goroutine and returns immediately (202-style). The check
// and every stage broadcast wails:updater:* events the About dialog
// renders; this method's own return value only reports "couldn't
// start". Single-flighted: a second call while one is in flight is a
// no-op (the UI also disables the button), so a double-click can't run
// two concurrent installs. Once a release is staged it refuses with
// ErrSelfUpdateStaged — a new pass would discard the staged binary.
func (a *App) StartSelfUpdate() error {
	if a.SelfUpdate == nil {
		return ErrSelfUpdateUnavailable
	}
	a.selfUpdateMu.Lock()
	next, started, err := a.selfUpdate.beginPass()
	a.selfUpdate = next
	a.selfUpdateMu.Unlock()
	if err != nil || !started {
		return err
	}
	go func() {
		end := selfUpdateError // what a panicking pass ends in
		defer func() { a.setSelfUpdatePhase(end) }()
		defer applog.RecoverPanic("selfupdate")
		end = a.runSelfUpdatePass(context.Background())
	}()
	return nil
}

// runSelfUpdatePass checks and, when a release is found, downloads and stages
// it, returning the phase the pass ends in.
func (a *App) runSelfUpdatePass(ctx context.Context) selfUpdatePhase {
	found, err := a.SelfUpdate.Check(ctx)
	if err != nil {
		applog.Subsystem("selfupdate").Warn("update check failed", "err", err)
		return selfUpdateError
	}
	if !found {
		return selfUpdateIdle
	}
	a.setSelfUpdatePhase(selfUpdateDownloading)
	if err := a.SelfUpdate.DownloadAndInstall(ctx); err != nil {
		applog.Subsystem("selfupdate").Warn("download/install failed", "err", err)
		return selfUpdateError
	}
	return selfUpdateReady
}

func (a *App) setSelfUpdatePhase(p selfUpdatePhase) {
	a.selfUpdateMu.Lock()
	defer a.selfUpdateMu.Unlock()
	a.selfUpdate = p
}

// RestartToApply swaps the staged update in place and relaunches. The
// frontend calls it when the user clicks "Restart now" after a
// download reaches the ready state. On success the process exits and
// the new binary starts, so this only returns on failure, when no
// updater is wired, or — ErrSelfUpdateNotReady — when nothing is staged.
// A failed restart leaves the update staged for another try.
func (a *App) RestartToApply() error {
	if a.SelfUpdate == nil {
		return ErrSelfUpdateUnavailable
	}
	a.selfUpdateMu.Lock()
	ready := a.selfUpdate == selfUpdateReady
	a.selfUpdateMu.Unlock()
	if !ready {
		return ErrSelfUpdateNotReady
	}
	return a.SelfUpdate.Restart(context.Background())
}

// ErrSelfUpdateStaged is returned by StartSelfUpdate once an update is
// downloaded and staged: another pass would discard it before
// re-downloading. Restart to apply it. The HTTP layer maps it to 409.
var ErrSelfUpdateStaged = errors.New("an update is already staged — restart to apply it")

// ErrSelfUpdateNotReady is returned by RestartToApply when no update is
// staged. The HTTP layer maps it to 409.
var ErrSelfUpdateNotReady = errors.New("no update is staged to apply")
