package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"recall/pkg/db"
)

// ErrMoveTargetIsActive is returned by MoveMatches when the caller
// names the active profile as the target — a no-op move that the
// user almost certainly didn't intend.
var ErrMoveTargetIsActive = errors.New("move target is the active profile")

// MoveMatches transfers every row keyed on matchKeys from the active
// profile's DB to targetProfile's DB. The transfer is two-phase:
//
//  1. Open the target profile's SQLStore, upsert every parent row +
//     its children (via the same UpsertSummary / UpsertScoreboard /
//     etc. APIs production parse uses) + every annotation + the
//     hidden_matches flag. Filenames carry over verbatim so a future
//     re-parse of the same source PNG on the new profile is a no-op.
//  2. Hard-delete the rows on the source. Per-key HardDeleteMatch
//     so a single bad key doesn't strand the rest.
//
// If phase 1 succeeds but phase 2 fails, the user is left with the
// match present in BOTH profiles. The retry on the same keys
// re-targets the already-moved rows (their target inserts are
// idempotent via ON CONFLICT(filename) UPSERTs) and completes the
// source delete. Acceptable: the canonical copy is on the target.
//
// screenshots_dir_id on each parent row is re-resolved against the
// target's screenshots_dirs table — the integer id space is not
// shared between profiles, but the path string is. Empty/zero ids
// pass through as zero (null).
func (a *App) MoveMatches(matchKeys []string, targetProfile string) error {
	if a.profiles == nil {
		return fmt.Errorf("profiles: not initialized")
	}
	if len(matchKeys) == 0 {
		return nil
	}
	// Validate targetProfile against the same regex Create / Rename use
	// BEFORE membership in the active list. Two reasons:
	//  1. Defence in depth — the list contents come from a runtime
	//     read that, while validated at write time, is not a static
	//     allow-list as far as taint analysis is concerned. Routing
	//     the name through the regex sanitises the value before it
	//     flows into the path-construction below
	//     (a.profiles.ProfileDir → filepath.Join → os.MkdirAll).
	//     CodeQL's "Uncontrolled data used in path expression" rule
	//     recognises the regex check; the slice-membership probe alone
	//     does not.
	//  2. Clearer 400 vs 404 mapping at the HTTP boundary —
	//     malformed names (path-traversal, special chars) return
	//     ErrInvalidProfileName → 400, while well-formed-but-unknown
	//     names return ErrProfileNotFound → 404. The membership
	//     check below catches the second case.
	if err := validateProfileName(targetProfile); err != nil {
		return err
	}
	if !containsProfile(a.profiles.List(), targetProfile) {
		return fmt.Errorf("%w: %q", ErrProfileNotFound, targetProfile)
	}
	if targetProfile == a.profiles.Active() {
		return fmt.Errorf("%w: %q", ErrMoveTargetIsActive, targetProfile)
	}

	// Load full source state once so we don't make N round-trips per
	// match. The aggregator already does the same shape; in-memory
	// filter is fine until profile sizes get into the 10k+ match
	// range, at which point a SQL-side LoadForKeys filter is the
	// natural next step (existing read paths stay unchanged).
	src, err := a.store.LoadAll()
	if err != nil {
		return fmt.Errorf("move: load source: %w", err)
	}
	annotations, err := a.store.LoadAnnotations()
	if err != nil {
		return fmt.Errorf("move: load annotations: %w", err)
	}
	hidden, err := a.store.LoadHiddenKeys()
	if err != nil {
		return fmt.Errorf("move: load hidden keys: %w", err)
	}

	keep := make(map[string]bool, len(matchKeys))
	for _, k := range matchKeys {
		keep[k] = true
	}

	// Open the target profile's store at <profileDir>/db/recall.db,
	// creating the db dir if it doesn't exist yet.
	targetDir := a.profiles.ProfileDir(targetProfile)
	dbDir := filepath.Join(targetDir, "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		return fmt.Errorf("move: ensure target db dir: %w", err)
	}
	targetStore, err := db.NewSQLStore(filepath.Join(dbDir, "recall.db"))
	if err != nil {
		return fmt.Errorf("move: open target db: %w", err)
	}
	defer func() { _ = targetStore.Close() }()

	// Re-map screenshots_dir_id by resolving the source dir path on
	// the target. Cached so we don't EnsureScreenshotsDir-ping per
	// row when many rows share the same source dir.
	dirIDCache := make(map[int64]int64)
	resolveDirID := func(srcID int64) (int64, error) {
		if srcID == 0 {
			return 0, nil
		}
		if id, ok := dirIDCache[srcID]; ok {
			return id, nil
		}
		path := src.ScreenshotsDirs[srcID]
		if path == "" {
			return 0, nil
		}
		id, err := targetStore.EnsureScreenshotsDir(path)
		if err != nil {
			return 0, err
		}
		dirIDCache[srcID] = id
		return id, nil
	}

	// Phase 1a: upsert every parent row whose match_key is in the
	// move set.
	for _, r := range src.Summaries {
		if !keep[r.MatchKey] {
			continue
		}
		newID, derr := resolveDirID(r.ScreenshotsDirID)
		if derr != nil {
			return fmt.Errorf("move: resolve screenshots_dir for %q: %w", r.Filename, derr)
		}
		r.ScreenshotsDirID = newID
		if err := targetStore.UpsertSummary(r); err != nil {
			return fmt.Errorf("move: upsert summary %q: %w", r.Filename, err)
		}
	}
	for _, r := range src.Scoreboards {
		if !keep[r.MatchKey] {
			continue
		}
		newID, derr := resolveDirID(r.ScreenshotsDirID)
		if derr != nil {
			return fmt.Errorf("move: resolve screenshots_dir for %q: %w", r.Filename, derr)
		}
		r.ScreenshotsDirID = newID
		if err := targetStore.UpsertScoreboard(r); err != nil {
			return fmt.Errorf("move: upsert scoreboard %q: %w", r.Filename, err)
		}
	}
	for _, r := range src.Personals {
		if !keep[r.MatchKey] {
			continue
		}
		newID, derr := resolveDirID(r.ScreenshotsDirID)
		if derr != nil {
			return fmt.Errorf("move: resolve screenshots_dir for %q: %w", r.Filename, derr)
		}
		r.ScreenshotsDirID = newID
		if err := targetStore.UpsertPersonal(r); err != nil {
			return fmt.Errorf("move: upsert personal %q: %w", r.Filename, err)
		}
	}
	for _, r := range src.Ranks {
		if !keep[r.MatchKey] {
			continue
		}
		newID, derr := resolveDirID(r.ScreenshotsDirID)
		if derr != nil {
			return fmt.Errorf("move: resolve screenshots_dir for %q: %w", r.Filename, derr)
		}
		r.ScreenshotsDirID = newID
		if err := targetStore.UpsertRank(r); err != nil {
			return fmt.Errorf("move: upsert rank %q: %w", r.Filename, err)
		}
	}
	for _, r := range src.Unknowns {
		if !keep[r.MatchKey] {
			continue
		}
		newID, derr := resolveDirID(r.ScreenshotsDirID)
		if derr != nil {
			return fmt.Errorf("move: resolve screenshots_dir for %q: %w", r.Filename, derr)
		}
		r.ScreenshotsDirID = newID
		if err := targetStore.UpsertUnknown(r); err != nil {
			return fmt.Errorf("move: upsert unknown %q: %w", r.Filename, err)
		}
	}

	// Phase 1b: per-key sidecar state (annotations, hidden flag).
	for _, k := range matchKeys {
		if ann, ok := annotations[k]; ok {
			if err := targetStore.SetAnnotation(ann); err != nil {
				return fmt.Errorf("move: copy annotation for %q: %w", k, err)
			}
		}
		if hidden[k] {
			if err := targetStore.HideMatch(k); err != nil {
				return fmt.Errorf("move: copy hidden flag for %q: %w", k, err)
			}
		}
	}

	// Phase 2: hard-delete from the source. HardDeleteMatch is
	// idempotent on its own, so a partial completion + retry is safe.
	for _, k := range matchKeys {
		if err := a.store.HardDeleteMatch(k); err != nil {
			return fmt.Errorf("move: delete source row for %q: %w", k, err)
		}
	}
	return nil
}
