package app

import (
	"os"
	"path/filepath"
	"sort"
	"time"

	"recall/pkg/applog"
	"recall/pkg/db"
)

// Automatic safety snapshots. Two producers share this file:
//
//   - snapshotBeforeReparse — Re-parse All rewrites every row from OCR,
//     so the force path takes a silent snapshot first (keep the newest
//     preReparseKeep). Belt-and-braces, not a gate: a snapshot failure
//     is logged and the re-parse proceeds — blocking the user's
//     explicit request over a backup hiccup would be worse than the
//     tiny risk the snapshot hedges against.
//   - the auto-backup scheduler (backup_scheduler.go) writes its
//     interval snapshots into the same <profile>/backups/ directory
//     with a different prefix, sharing writeSnapshot/pruneSnapshots.

const preReparseKeep = 2

// backupToFunc is the VACUUM INTO seam (function-variable DI, cf.
// ParseScreenshotsDirFunc) so tests observe snapshot calls without a
// real SQLite file.
var backupToFunc = db.BackupTo

// snapshotBeforeReparse writes backups/pre-reparse-<ts>.db and prunes
// older siblings. Never returns an error — see the file comment.
func (a *App) snapshotBeforeReparse() {
	dest, err := a.writeSnapshot("pre-reparse-", preReparseKeep)
	logger := applog.Subsystem("backup")
	if err != nil {
		logger.Error("pre-reparse snapshot failed; continuing", "err", err)
		return
	}
	logger.Info("pre-reparse snapshot written", "dest", dest)
}

// writeSnapshot VACUUMs the active profile's DB into
// <profile>/backups/<prefix><ts>.db and prunes that prefix down to
// keep copies. Returns the written path.
func (a *App) writeSnapshot(prefix string, keep int) (string, error) {
	dir := filepath.Join(a.dataDir(), "backups")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	dest := filepath.Join(dir, prefix+time.Now().UTC().Format("20060102-150405")+".db")
	if _, err := os.Stat(dest); err == nil {
		// Same-second collision (test-speed re-runs) — VACUUM INTO
		// refuses to overwrite, so reuse the existing snapshot.
		return dest, nil
	}
	if err := backupToFunc(dbPath(a.dataDir()), dest); err != nil {
		return "", err
	}
	pruneSnapshots(dir, prefix, keep)
	return dest, nil
}

// pruneSnapshots removes all but the newest keep files matching
// prefix*.db in dir. Timestamps embed lexicographically-sortable
// UTC stamps, so name order IS age order.
//
// A Glob failure and "nothing to prune" are separate arms on purpose.
// Both skip the removal loop — pruning nothing is always the safe
// choice — but a data dir the pattern can't express (a bracket in a
// user-chosen profile name yields filepath.ErrBadPattern) would
// otherwise disable pruning for the life of the install while
// backups/ grew without bound, and say nothing about it.
func pruneSnapshots(dir, prefix string, keep int) {
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
