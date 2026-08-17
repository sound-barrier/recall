package app

import (
	"path/filepath"
	"time"

	"recall/pkg/applog"
	"recall/pkg/snapshot"
)

// The App-state half of automatic snapshots. pkg/snapshot owns the files —
// naming, writing, pruning, and reading due-ness back off the names; what
// stays here is everything that needs the shell: the active profile's paths,
// the persisted interval behind settingsMu, and the decision that a snapshot
// failure is logged rather than surfaced.
//
// Two producers share the directory:
//
//   - snapshotBeforeReparse — Re-parse All rewrites every row from OCR,
//     so the force path takes a silent snapshot first. Belt-and-braces,
//     not a gate: a snapshot failure is logged and the re-parse
//     proceeds — blocking the user's explicit request over a backup
//     hiccup would be worse than the tiny risk the snapshot hedges
//     against.
//   - maybeAutoBackup — the interval scheduler, writing under a
//     different prefix into the same <profile>/backups/ directory.

// autoBackupOnStartup gates Startup's background backup goroutine —
// same pattern as probeTesseractOnStartup: OFF by default so tests
// that run the real Startup never race a stray VACUUM goroutine
// against their TempDir teardown; the two production entry points opt
// in. The scheduler logic itself is covered directly in tests.
var autoBackupOnStartup = false

// EnableAutoBackupOnStartup opts this process into the boot-time
// backup check. Call once, before Startup runs.
func EnableAutoBackupOnStartup() { autoBackupOnStartup = true }

// backupsDir is where both producers write, under the active profile.
func (a *App) backupsDir() string { return filepath.Join(a.dataDir(), "backups") }

// writeSnapshot VACUUMs the active profile's DB into its backups
// directory under prefix and prunes that prefix down to keep copies.
func (a *App) writeSnapshot(prefix string, keep int) (string, error) {
	return snapshot.Write(dbPath(a.dataDir()), a.backupsDir(), prefix, keep)
}

// snapshotBeforeReparse writes backups/pre-reparse-<ts>.db and prunes
// older siblings. Never returns an error — see the file comment.
func (a *App) snapshotBeforeReparse() {
	dest, err := a.writeSnapshot(snapshot.ReparsePrefix, snapshot.ReparseKeep)
	logger := applog.Subsystem("backup")
	if err != nil {
		logger.Error("pre-reparse snapshot failed; continuing", "err", err)
		return
	}
	logger.Info("pre-reparse snapshot written", "dest", dest)
}

// GetAutoBackupStatus reports the effective interval, the newest
// automatic snapshot's timestamp, and whether it's overdue.
func (a *App) GetAutoBackupStatus() AutoBackupStatus {
	return snapshot.StatusFor(a.backupsDir(), a.settingsSnapshot().AutoBackupIntervalDays, time.Now())
}

// SetAutoBackupInterval persists the interval: -1 disables, 0 resets
// to the default (weekly), 1..365 are literal days.
func (a *App) SetAutoBackupInterval(days int) error {
	if err := snapshot.ValidateInterval(days); err != nil {
		return err
	}
	snap := a.mutateSettings(func(s *Settings) { s.AutoBackupIntervalDays = days })
	return a.saveSettings(snap)
}

// maybeAutoBackup writes a fresh automatic snapshot iff one is due.
// Called after every parse run and once at startup; cheap when not due
// (one directory glob). Failures are logged, never surfaced.
func (a *App) maybeAutoBackup() {
	st := a.GetAutoBackupStatus()
	if st.IntervalDays <= 0 || !st.Stale {
		return
	}
	dest, err := a.writeSnapshot(snapshot.AutoPrefix, snapshot.AutoKeep)
	logger := applog.Subsystem("backup")
	if err != nil {
		logger.Error("auto backup failed", "err", err)
		return
	}
	logger.Info("auto backup written", "dest", dest)
}
