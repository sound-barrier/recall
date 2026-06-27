package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"recall/pkg/db"
)

// ErrRestoreInvalid marks a restore payload that isn't a usable Recall
// database snapshot (not SQLite, corrupt, or missing the schema). The HTTP
// layer maps it to 422.
var ErrRestoreInvalid = errors.New("restore: not a valid Recall database")

// BackupDatabase returns a complete, compacted SQLite snapshot of the active
// profile's database as bytes. The snapshot is produced with VACUUM INTO to a
// fresh temp file beside the live DB, read back, and removed. Unlike the
// former JSON/CSV export it captures every table — reviews, the ignored and
// all-heroes lists, ambiguous candidates — so it is a true backup.
func (a *App) BackupDatabase() ([]byte, error) {
	src := dbPath(a.dataDir())
	tmp, err := freshTempPath(filepath.Dir(src), "recall-backup-*.db")
	if err != nil {
		return nil, fmt.Errorf("backup: temp path: %w", err)
	}
	defer func() { _ = os.Remove(tmp) }()
	if err := db.BackupTo(src, tmp); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(tmp) // #nosec G304 -- tmp is a path this process just created in its own db dir
	if err != nil {
		return nil, fmt.Errorf("backup: read snapshot: %w", err)
	}
	return data, nil
}

// RestoreDatabase replaces the live database with the uploaded snapshot. The
// payload is staged + validated read-only BEFORE any teardown, so an invalid
// file leaves the running DB untouched. It then serializes against parses,
// tears down the store (mirroring the profile-switch teardown), atomically
// swaps the file, drops stale WAL/shm sidecars, and reopens.
func (a *App) RestoreDatabase(payload []byte) error {
	dst := dbPath(a.dataDir())

	staged, err := a.stageRestoreCandidate(payload, filepath.Dir(dst))
	if err != nil {
		return err
	}
	keepStaged := false
	defer func() {
		if !keepStaged {
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

	if err := os.Rename(staged, dst); err != nil {
		_ = a.reopenActiveStore() // don't strand the app with a nil store
		return fmt.Errorf("restore: swap: %w", err)
	}
	keepStaged = true // the staged file IS the live DB now
	_ = os.Remove(dst + "-wal")
	_ = os.Remove(dst + "-shm")

	return a.reopenActiveStore()
}

// stageRestoreCandidate writes payload to a temp file in dir (same filesystem
// as the live DB so the later rename is atomic) and validates it. A file that
// isn't a usable Recall DB is rejected as ErrRestoreInvalid before any
// destructive step runs.
func (a *App) stageRestoreCandidate(payload []byte, dir string) (string, error) {
	tmp, err := os.CreateTemp(dir, "recall-restore-*.db")
	if err != nil {
		return "", fmt.Errorf("restore: temp: %w", err)
	}
	name := tmp.Name()
	if _, err := tmp.Write(payload); err != nil {
		_ = tmp.Close()
		_ = os.Remove(name)
		return "", fmt.Errorf("restore: write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return "", fmt.Errorf("restore: close temp: %w", err)
	}
	if err := db.ValidateBackupFile(name); err != nil {
		_ = os.Remove(name)
		if errors.Is(err, db.ErrInvalidBackup) {
			return "", fmt.Errorf("%w: %w", ErrRestoreInvalid, err)
		}
		return "", err
	}
	return name, nil
}

// closeStoreForSwap tears down everything holding the live DB file open so it
// can be replaced. Mirrors the active-profile teardown in activateAndReload.
func (a *App) closeStoreForSwap() {
	a.saveSettingsBestEffort()
	a.stopWatching()
	if a.store != nil {
		if closer, ok := a.store.(interface{ Close() error }); ok {
			_ = closer.Close()
		}
		a.store = nil
	}
}

// freshTempPath reserves a unique, non-existent path in dir so VACUUM INTO can
// create the file itself (it writes a brand-new database).
func freshTempPath(dir, pattern string) (string, error) {
	f, err := os.CreateTemp(dir, pattern)
	if err != nil {
		return "", err
	}
	name := f.Name()
	_ = f.Close()
	if err := os.Remove(name); err != nil {
		return "", err
	}
	return name, nil
}
