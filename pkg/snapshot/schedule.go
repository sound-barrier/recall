package snapshot

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

// The auto-backup schedule: periodic VACUUM INTO snapshots so a bad
// disk day (or the pre-1.0 wipe-and-relaunch reality) can't eat the
// only copy of a user's history. Scheduled snapshots land beside the
// pre-reparse ones under AutoPrefix, pruned to AutoKeep. Due-ness is
// derived from the newest snapshot's embedded timestamp — the files ARE
// the record, so there is nothing extra to persist and a restart can't
// lose the schedule.

const (
	// DefaultDays is the interval an install that never opened Settings
	// runs at, and MaxDays the largest interval the wire contract accepts.
	DefaultDays = 7
	MaxDays     = 365
)

// ErrInvalidInterval marks an interval outside -1 (off) or 1..MaxDays
// days. Maps to 400 at the HTTP layer.
var ErrInvalidInterval = errors.New("invalid auto-backup interval")

// Status is the GET /api/v1/settings/auto-backup shape. IntervalDays is
// the EFFECTIVE interval: -1 when disabled, otherwise the configured
// (or defaulted) day count.
type Status struct {
	IntervalDays int    `json:"interval_days"`
	LastBackupAt string `json:"last_backup_at,omitempty"`
	Stale        bool   `json:"stale"`
}

// EffectiveDays maps the stored setting to behavior: 0 means "never
// configured" and defaults ON at a week — the whole point is protecting
// users who never open Settings; -1 (or any negative) is an explicit
// opt-out; positive values are literal days.
func EffectiveDays(configured int) int {
	if configured < 0 {
		return -1
	}
	if configured == 0 {
		return DefaultDays
	}
	return configured
}

// StatusFor reports the effective interval for configuredDays, the
// newest scheduled snapshot in backupsDir, and whether that snapshot is
// overdue as of now.
func StatusFor(backupsDir string, configuredDays int, now time.Time) Status {
	days := EffectiveDays(configuredDays)
	st := Status{IntervalDays: days}
	last, ok := Latest(backupsDir, AutoPrefix)
	if ok {
		st.LastBackupAt = last.Format(time.RFC3339)
	}
	if days > 0 {
		st.Stale = !ok || now.Sub(last) > time.Duration(days)*24*time.Hour
	}
	return st
}

// ValidateInterval accepts -1 (off), 0 (reset to the default) and
// 1..MaxDays literal days. The whole [-1,MaxDays] range is valid so the
// wire contract is a plain bounded integer — schemathesis-generated
// values inside the documented bounds must never 400.
func ValidateInterval(days int) error {
	if days < -1 || days > MaxDays {
		return fmt.Errorf("%w: %d (want -1..%d)", ErrInvalidInterval, days, MaxDays)
	}
	return nil
}

// Latest parses the newest <prefix><stamp>.db in dir. The UTC stamp is
// embedded in the name, so lexical max IS the newest and no filesystem
// mtimes (fragile across restores/copies) are consulted.
func Latest(dir, prefix string) (time.Time, bool) {
	matches, err := filepath.Glob(filepath.Join(dir, prefix+"*.db"))
	if err != nil || len(matches) == 0 {
		return time.Time{}, false
	}
	// Parse each candidate and keep the newest that PARSES, rather than taking
	// the lexical max and parsing only that one. A single file whose stamp is
	// not a timestamp — a copy someone kept by hand, "auto-keep-this-one.db" —
	// sorts above every real stamp whenever the character after the prefix is
	// a letter, and the parse-the-max form then reported "no backups exist"
	// with a full directory behind it. That is not merely a wrong readout:
	// Stale stays true forever, so a snapshot is written after every parse,
	// while Prune keeps the poison file as its own lexical max — one of the
	// three kept slots gone permanently, and the retention window collapsing
	// from three weekly snapshots to the last two parse runs.
	var newest time.Time
	found := false
	for _, m := range matches {
		stamp := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(m), prefix), ".db")
		t, err := time.Parse(TimeLayout, stamp)
		if err != nil {
			continue
		}
		if !found || t.After(newest) {
			newest, found = t, true
		}
	}
	return newest, found
}
