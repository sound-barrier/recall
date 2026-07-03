package app

import (
	"context"
	"errors"

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

// StartSelfUpdate kicks off a check-then-download-and-install pass on a
// background goroutine and returns immediately (202-style). The check
// and every stage broadcast wails:updater:* events the About dialog
// renders; this method's own return value only reports "couldn't
// start". Single-flighted: a second call while one is in flight is a
// no-op (the UI also disables the button), so a double-click can't run
// two concurrent installs.
func (a *App) StartSelfUpdate() error {
	if a.SelfUpdate == nil {
		return ErrSelfUpdateUnavailable
	}
	if !a.selfUpdateRunning.CompareAndSwap(false, true) {
		return nil
	}
	go func() {
		defer applog.RecoverPanic("selfupdate")
		defer a.selfUpdateRunning.Store(false)
		ctx := context.Background()
		found, err := a.SelfUpdate.Check(ctx)
		if err != nil {
			applog.Subsystem("selfupdate").Warn("update check failed", "err", err)
			return
		}
		if !found {
			return
		}
		if err := a.SelfUpdate.DownloadAndInstall(ctx); err != nil {
			applog.Subsystem("selfupdate").Warn("download/install failed", "err", err)
		}
	}()
	return nil
}

// RestartToApply swaps the staged update in place and relaunches. The
// frontend calls it when the user clicks "Restart now" after a
// download reaches the ready state. On success the process exits and
// the new binary starts, so this only returns on failure or when no
// updater is wired.
func (a *App) RestartToApply() error {
	if a.SelfUpdate == nil {
		return ErrSelfUpdateUnavailable
	}
	return a.SelfUpdate.Restart(context.Background())
}
