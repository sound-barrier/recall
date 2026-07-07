package app

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"recall/pkg/applog"
)

// The auto-backup scheduler: periodic VACUUM INTO snapshots so a bad
// disk day (or the pre-1.0 wipe-and-relaunch reality) can't eat the
// only copy of a user's history. Snapshots land beside the pre-reparse
// ones in <profile>/backups/ as auto-<ts>.db, pruned to autoBackupKeep.
// Due-ness is derived from the newest snapshot's embedded timestamp —
// the files ARE the record, so there is nothing extra to persist and a
// restart can't lose the schedule.

const (
	autoBackupPrefix      = "auto-"
	autoBackupKeep        = 3
	autoBackupDefaultDays = 7
	autoBackupMaxDays     = 365
	snapshotTimeLayout    = "20060102-150405"
)

// autoBackupOnStartup gates Startup's background backup goroutine —
// same pattern as probeTesseractOnStartup: OFF by default so tests
// that run the real Startup never race a stray VACUUM goroutine
// against their TempDir teardown; the two production entry points opt
// in. The scheduler logic itself is covered directly in tests.
var autoBackupOnStartup = false

// EnableAutoBackupOnStartup opts this process into the boot-time
// backup check. Call once, before Startup runs.
func EnableAutoBackupOnStartup() { autoBackupOnStartup = true }

// ErrInvalidBackupInterval marks a PUT with an interval outside
// -1 (off) or 1..365 days. Maps to 400 at the HTTP layer.
var ErrInvalidBackupInterval = errors.New("invalid auto-backup interval")

// AutoBackupStatus is the GET /api/v1/settings/auto-backup shape.
// IntervalDays is the EFFECTIVE interval: -1 when disabled, otherwise
// the configured (or defaulted) day count.
type AutoBackupStatus struct {
	IntervalDays int    `json:"interval_days"`
	LastBackupAt string `json:"last_backup_at,omitempty"`
	Stale        bool   `json:"stale"`
}

// effectiveAutoBackupDays maps the stored setting to behavior: 0 means
// "never configured" and defaults ON at a week — the whole point is
// protecting users who never open Settings; -1 (or any negative) is an
// explicit opt-out; positive values are literal days.
func effectiveAutoBackupDays(configured int) int {
	if configured < 0 {
		return -1
	}
	if configured == 0 {
		return autoBackupDefaultDays
	}
	return configured
}

// GetAutoBackupStatus reports the effective interval, the newest
// automatic snapshot's timestamp, and whether it's overdue.
func (a *App) GetAutoBackupStatus() AutoBackupStatus {
	days := effectiveAutoBackupDays(a.settingsSnapshot().AutoBackupIntervalDays)
	st := AutoBackupStatus{IntervalDays: days}
	last, ok := latestSnapshotTime(filepath.Join(a.dataDir(), "backups"), autoBackupPrefix)
	if ok {
		st.LastBackupAt = last.Format(time.RFC3339)
	}
	if days > 0 {
		st.Stale = !ok || time.Since(last) > time.Duration(days)*24*time.Hour
	}
	return st
}

// SetAutoBackupInterval persists the interval: -1 disables, 1..365 are
// literal days. (0 is rejected rather than silently meaning "default" —
// the wire contract stays unambiguous.)
func (a *App) SetAutoBackupInterval(days int) error {
	if days != -1 && (days < 1 || days > autoBackupMaxDays) {
		return fmt.Errorf("%w: %d (want -1 or 1..%d)", ErrInvalidBackupInterval, days, autoBackupMaxDays)
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
	dest, err := a.writeSnapshot(autoBackupPrefix, autoBackupKeep)
	logger := applog.Subsystem("backup")
	if err != nil {
		logger.Error("auto backup failed", "err", err)
		return
	}
	logger.Info("auto backup written", "dest", dest)
}

// latestSnapshotTime parses the newest <prefix><ts>.db in dir. The
// UTC stamp is embedded in the name, so lexical max IS the newest and
// no filesystem mtimes (fragile across restores/copies) are consulted.
func latestSnapshotTime(dir, prefix string) (time.Time, bool) {
	matches, err := filepath.Glob(filepath.Join(dir, prefix+"*.db"))
	if err != nil || len(matches) == 0 {
		return time.Time{}, false
	}
	newest := ""
	for _, m := range matches {
		if base := filepath.Base(m); base > newest {
			newest = base
		}
	}
	stamp := strings.TrimSuffix(strings.TrimPrefix(newest, prefix), ".db")
	t, err := time.Parse(snapshotTimeLayout, stamp)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}
