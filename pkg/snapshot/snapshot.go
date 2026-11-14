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
	"strings"
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
//
// The snapshot is written under a temporary name (see partialPattern),
// synced, and renamed into place only once whole: a write the process never
// finished leaves a temporary that nothing counts as a snapshot — not
// Latest, so the next backup is still due, and not Prune, so it cannot evict
// a good one — and that SweepPartials removes. A second write in the same
// second names the same file and replaces it: it holds the newer state.
func Write(dbPath, backupsDir, prefix string, keep int) (string, error) {
	if err := os.MkdirAll(backupsDir, 0o750); err != nil {
		return "", err
	}
	SweepPartials(backupsDir)
	stamp := time.Now().UTC().Format(TimeLayout)
	dest := filepath.Join(backupsDir, prefix+stamp+".db")
	tmp, err := freshTempPath(backupsDir, "."+prefix+stamp+"-*"+partialSuffix)
	if err != nil {
		return "", fmt.Errorf("backup: temp path: %w", err)
	}
	if err := writeWhole(dbPath, tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	Prune(backupsDir, prefix, keep)
	return dest, nil
}

// partialSuffix ends every in-progress snapshot's name. The leading dot and
// this suffix keep it out of every "<prefix>*.db" glob Latest and Prune read.
const partialSuffix = ".partial"

// writeWhole VACUUMs into tmp, makes it durable, and renames it to dest.
func writeWhole(dbPath, tmp, dest string) error {
	if err := BackupToFunc(dbPath, tmp); err != nil {
		return err
	}
	if err := syncFile(tmp); err != nil {
		return fmt.Errorf("backup: sync snapshot: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		return fmt.Errorf("backup: rename snapshot into place: %w", err)
	}
	// The rename is durable once the directory entry is; not every platform
	// can sync a directory, and the snapshot is whole either way.
	_ = syncFile(filepath.Dir(dest))
	return nil
}

func syncFile(path string) error {
	f, err := os.Open(path) // #nosec G304 -- a path this package just created
	if err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// SweepPartials removes the temporaries of writes that never finished — a
// crash or a kill between the VACUUM and the rename. Best-effort: one that
// cannot be removed is only clutter, never mistaken for a snapshot.
func SweepPartials(backupsDir string) {
	leftovers, err := filepath.Glob(filepath.Join(backupsDir, ".*"+partialSuffix))
	if err != nil {
		return
	}
	for _, f := range leftovers {
		if err := os.Remove(f); err != nil {
			applog.Subsystem("backup").Error("remove unfinished snapshot", "file", f, "err", err)
		}
	}
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
	// Only files this package WROTE are ours to count or to delete. A name
	// whose stamp does not parse is someone's own copy kept in the backups
	// folder, and it is the lexical max whenever the character after the
	// prefix is a letter — so counting it toward `keep` spent a retention slot
	// permanently (it was never the one pruned), while deleting it would
	// destroy a file the user put there on purpose. Skip it on both counts.
	ours := make([]string, 0, len(matches))
	for _, m := range matches {
		stamp := strings.TrimSuffix(strings.TrimPrefix(filepath.Base(m), prefix), ".db")
		if _, err := time.Parse(TimeLayout, stamp); err == nil {
			ours = append(ours, m)
		}
	}
	if len(ours) <= keep {
		return
	}
	sort.Strings(ours)
	for _, old := range ours[:len(ours)-keep] {
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
