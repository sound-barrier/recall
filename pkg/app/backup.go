package app

import (
	"fmt"
	"os"
	"path/filepath"

	"recall/pkg/snapshot"
)

// BackupDatabase returns a complete, compacted SQLite snapshot of the active
// profile's database as bytes.
func (a *App) BackupDatabase() ([]byte, error) {
	return snapshot.Read(dbPath(a.dataDir()))
}

// RestoreDatabase replaces the live database with the uploaded snapshot. The
// payload is staged + validated read-only BEFORE any teardown, so an invalid
// file leaves the running DB untouched. It then serializes against parses,
// tears down the store (mirroring the profile-switch teardown), atomically
// swaps the file, drops stale WAL/shm sidecars, and reopens.
func (a *App) RestoreDatabase(payload []byte) error {
	if err := a.assertNoCoachSession(); err != nil {
		return err
	}
	if err := a.assertActiveMutable(); err != nil {
		return err
	}
	dst := dbPath(a.dataDir())

	staged, err := snapshot.StageRestore(payload, filepath.Dir(dst))
	if err != nil {
		return err
	}
	keepStaged := false
	defer func() {
		if !keepStaged {
			// #nosec G703 -- staged is os.CreateTemp's own name inside the
			// profile's db dir. Only the file's CONTENTS came from the
			// request; gosec stopped being able to see that when the
			// staging helper moved to pkg/snapshot, since its taint
			// analysis does not follow a call across packages.
			_ = os.Remove(staged)
		}
	}()

	// Serialize against the OCR write path: refuse if a parse is mid-flight
	// and block a new one from starting during the swap.
	if _, claimed := a.claimParse(false); !claimed {
		return ErrParseInFlight
	}
	defer a.endParse()

	a.closeStoreForSwap()

	// #nosec G703 -- staged is os.CreateTemp's own name (see the deferred
	// cleanup above) and dst is the active profile's database path.
	if err := os.Rename(staged, dst); err != nil {
		_ = a.reopenActiveStore() // don't strand the app with a nil store
		return fmt.Errorf("restore: swap: %w", err)
	}
	keepStaged = true // the staged file IS the live DB now
	_ = os.Remove(dst + "-wal")
	_ = os.Remove(dst + "-shm")

	return a.reopenActiveStore()
}

// closeStoreForSwap tears down everything holding the live DB file open so it
// can be replaced. Mirrors the active-profile teardown in activateAndReload.
func (a *App) closeStoreForSwap() {
	// The session's notes hang off THIS store's coach_players rows; the
	// file about to be swapped in has different ones (design rule 4).
	a.endCoachSession()
	a.saveSettingsBestEffort()
	a.stopWatching()
	if a.store != nil {
		if closer, ok := a.store.(interface{ Close() error }); ok {
			_ = closer.Close()
		}
		a.store = nil
	}
}
