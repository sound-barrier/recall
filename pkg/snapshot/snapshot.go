// Package snapshot produces, names and prunes SQLite backup files.
//
// A snapshot is a complete VACUUM INTO copy of a database file, named
// <prefix><UTC stamp>.db. The stamp is lexicographically sortable, so the
// files in a backups directory ARE the record: which one is newest, and
// therefore whether another is due, is read off the names rather than out of
// anything persisted beside them — there is nothing extra to keep in sync and
// a restart cannot lose the schedule.
//
// Everything here works on PATHS, because VACUUM INTO reads the database file
// rather than a connection. What stays in the app shell is what needs more
// than a path: the four mutexes a live restore has to take, the settings read
// behind StatusFor's interval argument, and the logging of failures this
// package only returns.
package snapshot

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"recall/pkg/applog"
	"recall/pkg/db"
)

const (
	// TimeLayout stamps a snapshot filename. It is deliberately
	// lexicographically sortable: name order IS age order, so neither
	// pruning nor due-ness consults filesystem mtimes (fragile across
	// restores and copies).
	TimeLayout = "20060102-150405"

	// AutoPrefix names the scheduler's interval snapshots and AutoKeep is
	// how many of them survive a prune.
	AutoPrefix = "auto-"
	AutoKeep   = 3

	// ReparsePrefix names the safety snapshot taken before Re-parse All
	// rewrites every row from OCR, and ReparseKeep is how many survive.
	ReparsePrefix = "pre-reparse-"
	ReparseKeep   = 2
)

// BackupToFunc is the VACUUM INTO seam (function-variable DI, cf.
// ParseScreenshotsDirFunc) so tests observe snapshot calls without a
// real SQLite file.
var BackupToFunc = db.BackupTo

// Read returns a complete, compacted SQLite snapshot of the database at
// dbPath as bytes. The snapshot is produced with VACUUM INTO to a fresh temp
// file beside the live DB, read back, and removed. Unlike the former JSON/CSV
// export it captures every table — reviews, the ignored and all-heroes lists,
// ambiguous candidates — so it is a true backup.
func Read(dbPath string) ([]byte, error) {
	tmp, err := freshTempPath(filepath.Dir(dbPath), "recall-backup-*.db")
	if err != nil {
		return nil, fmt.Errorf("backup: temp path: %w", err)
	}
	defer func() { _ = os.Remove(tmp) }()
	if err := db.BackupTo(dbPath, tmp); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(tmp) // #nosec G304 -- tmp is a path this process just created in its own db dir
	if err != nil {
		return nil, fmt.Errorf("backup: read snapshot: %w", err)
	}
	return data, nil
}

// Write VACUUMs the database at dbPath into
// <backupsDir>/<prefix><stamp>.db and prunes that prefix down to keep
// copies. Returns the written path.
func Write(dbPath, backupsDir, prefix string, keep int) (string, error) {
	if err := os.MkdirAll(backupsDir, 0o750); err != nil {
		return "", err
	}
	dest := filepath.Join(backupsDir, prefix+time.Now().UTC().Format(TimeLayout)+".db")
	if _, err := os.Stat(dest); err == nil {
		// Same-second collision (test-speed re-runs) — VACUUM INTO
		// refuses to overwrite, so reuse the existing snapshot.
		return dest, nil
	}
	if err := BackupToFunc(dbPath, dest); err != nil {
		return "", err
	}
	Prune(backupsDir, prefix, keep)
	return dest, nil
}

// Prune removes all but the newest keep files matching prefix*.db in
// dir. Timestamps embed lexicographically-sortable UTC stamps, so name
// order IS age order.
//
// A Glob failure and "nothing to prune" are separate arms on purpose.
// Both skip the removal loop — pruning nothing is always the safe
// choice — but a path the pattern can't express yields
// filepath.ErrBadPattern, which would otherwise disable pruning for the
// life of the install while backups/ grew without bound, and say nothing
// about it. NOT reachable through a profile name: profileNameRe forbids
// a bracket and every rename path enforces it. The reachable sources are
// an unmatched '[' in RECALL_DATA_DIR or in the OS home directory the
// default data dir is built from — neither of which this process
// validates.
func Prune(dir, prefix string, keep int) {
	matches, err := filepath.Glob(filepath.Join(dir, prefix+"*.db"))
	if err != nil {
		applog.Subsystem("backup").Error("prune skipped; backups path is not a valid glob pattern",
			"dir", dir, "err", err)
		return
	}
	if len(matches) <= keep {
		return
	}
	sort.Strings(matches)
	for _, old := range matches[:len(matches)-keep] {
		if err := os.Remove(old); err != nil {
			applog.Subsystem("backup").Error("prune failed", "file", old, "err", err)
		}
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
