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
//     its children (via the same UpsertSummary / UpsertTeams /
//     etc. APIs production parse uses) + the user-override layer
//     (user_match_data + the queue / play-mode aux rows — a manual
//     match or an edited OCR match lives entirely there) + every
//     annotation + the hidden_matches flag. Filenames carry over
//     verbatim so a future re-parse of the same source PNG on the new
//     profile is a no-op.
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
	proceed, err := a.validateMoveRequest(matchKeys, targetProfile)
	if err != nil || !proceed {
		return err
	}

	src, annotations, hidden, err := a.loadMoveSource()
	if err != nil {
		return err
	}

	keep := make(map[string]bool, len(matchKeys))
	for _, k := range matchKeys {
		keep[k] = true
	}

	// Open the target profile's store at <profileDir>/db/recall.db,
	// creating the db dir if it doesn't exist yet.
	dbDir := filepath.Join(a.profiles.ProfileDir(targetProfile), "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		return fmt.Errorf("move: ensure target db dir: %w", err)
	}
	targetStore, err := db.NewSQLStore(filepath.Join(dbDir, "recall.db"))
	if err != nil {
		return fmt.Errorf("move: open target db: %w", err)
	}
	defer func() { _ = targetStore.Close() }()

	resolveDirID := dirIDResolver(targetStore, src.ScreenshotsDirs)
	if err := movePhase1Parents(targetStore, src, keep, resolveDirID); err != nil {
		return err
	}
	if err := movePhase1Sidecars(targetStore, matchKeys, annotations, hidden); err != nil {
		return err
	}
	if err := a.movePhase1Overrides(targetStore, matchKeys); err != nil {
		return err
	}
	return a.movePhase2DeleteSource(matchKeys)
}

// validateMoveRequest validates targetProfile and decides whether the
// move should proceed. Returns proceed=false (err=nil) for the
// validated-but-empty-keys idempotent no-op.
func (a *App) validateMoveRequest(matchKeys []string, targetProfile string) (proceed bool, err error) {
	// Validate targetProfile FIRST, before the empty-keys early-return,
	// so an empty-but-invalid request (e.g. "" or "../traversal")
	// surfaces as 400 instead of being swallowed by the no-op branch.
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
		return false, err
	}
	if !containsProfile(a.profiles.List(), targetProfile) {
		return false, fmt.Errorf("%w: %q", ErrProfileNotFound, targetProfile)
	}
	if targetProfile == a.profiles.Active() {
		return false, fmt.Errorf("%w: %q", ErrMoveTargetIsActive, targetProfile)
	}
	// Validated target, nothing to move — idempotent no-op. The
	// empty-keys check sits HERE (not at the top of the function)
	// so an empty body with a bad target_profile still reports
	// the bad target instead of being swallowed.
	return len(matchKeys) > 0, nil
}

// loadMoveSource loads the active profile's full state once so the move
// doesn't make N round-trips per match. The aggregator already does the
// same shape; in-memory filter is fine until profile sizes get into the
// 10k+ match range, at which point a SQL-side LoadForKeys filter is the
// natural next step (existing read paths stay unchanged).
func (a *App) loadMoveSource() (db.Screenshots, map[string]db.Annotation, map[string]bool, error) {
	src, err := a.store.LoadAll()
	if err != nil {
		return db.Screenshots{}, nil, nil, fmt.Errorf("move: load source: %w", err)
	}
	annotations, err := a.store.LoadAnnotations()
	if err != nil {
		return db.Screenshots{}, nil, nil, fmt.Errorf("move: load annotations: %w", err)
	}
	hidden, err := a.store.LoadHiddenKeys()
	if err != nil {
		return db.Screenshots{}, nil, nil, fmt.Errorf("move: load hidden keys: %w", err)
	}
	return src, annotations, hidden, nil
}

// dirIDResolver re-maps a source screenshots_dir_id onto the target by
// resolving the source dir's path against the target's screenshots_dirs
// table. Cached so we don't EnsureScreenshotsDir-ping per row when many
// rows share the same source dir.
func dirIDResolver(targetStore db.Store, srcDirs map[int64]string) func(int64) (int64, error) {
	cache := make(map[int64]int64)
	return func(srcID int64) (int64, error) {
		if srcID == 0 {
			return 0, nil
		}
		if id, ok := cache[srcID]; ok {
			return id, nil
		}
		path := srcDirs[srcID]
		if path == "" {
			return 0, nil
		}
		id, err := targetStore.EnsureScreenshotsDir(path)
		if err != nil {
			return 0, err
		}
		cache[srcID] = id
		return id, nil
	}
}

// moveParentRows upserts every row whose match_key is in `keep` into the
// target, re-resolving its screenshots_dir id first. The accessor
// closures let one body serve all five parent-row types (struct fields
// can't be reached generically). kind feeds the error messages.
func moveParentRows[T any](
	rows []T,
	keep map[string]bool,
	kind string,
	matchKey func(T) string,
	filename func(T) string,
	dirID func(T) int64,
	remap func(*T, int64),
	resolve func(int64) (int64, error),
	upsert func(T) error,
) error {
	for i := range rows {
		r := rows[i]
		if !keep[matchKey(r)] {
			continue
		}
		newID, derr := resolve(dirID(r))
		if derr != nil {
			return fmt.Errorf("move: resolve screenshots_dir for %q: %w", filename(r), derr)
		}
		remap(&r, newID)
		if err := upsert(r); err != nil {
			return fmt.Errorf("move: upsert %s %q: %w", kind, filename(r), err)
		}
	}
	return nil
}

// movePhase1Parents upserts every parent row (across all five tables)
// whose match_key is in the move set.
func movePhase1Parents(targetStore db.Store, src db.Screenshots, keep map[string]bool, resolve func(int64) (int64, error)) error {
	if err := moveParentRows(src.Summaries, keep, "summary",
		func(r db.SummaryRow) string { return r.MatchKey },
		func(r db.SummaryRow) string { return r.Filename },
		func(r db.SummaryRow) int64 { return r.ScreenshotsDirID },
		func(r *db.SummaryRow, id int64) { r.ScreenshotsDirID = id },
		resolve, targetStore.UpsertSummary); err != nil {
		return err
	}
	if err := moveParentRows(src.Teams, keep, "teams",
		func(r db.TeamsRow) string { return r.MatchKey },
		func(r db.TeamsRow) string { return r.Filename },
		func(r db.TeamsRow) int64 { return r.ScreenshotsDirID },
		func(r *db.TeamsRow, id int64) { r.ScreenshotsDirID = id },
		resolve, targetStore.UpsertTeams); err != nil {
		return err
	}
	if err := moveParentRows(src.Personals, keep, "personal",
		func(r db.PersonalRow) string { return r.MatchKey },
		func(r db.PersonalRow) string { return r.Filename },
		func(r db.PersonalRow) int64 { return r.ScreenshotsDirID },
		func(r *db.PersonalRow, id int64) { r.ScreenshotsDirID = id },
		resolve, targetStore.UpsertPersonal); err != nil {
		return err
	}
	if err := moveParentRows(src.Ranks, keep, "rank",
		func(r db.RankRow) string { return r.MatchKey },
		func(r db.RankRow) string { return r.Filename },
		func(r db.RankRow) int64 { return r.ScreenshotsDirID },
		func(r *db.RankRow, id int64) { r.ScreenshotsDirID = id },
		resolve, targetStore.UpsertRank); err != nil {
		return err
	}
	return moveParentRows(src.Unknowns, keep, "unknown",
		func(r db.UnknownRow) string { return r.MatchKey },
		func(r db.UnknownRow) string { return r.Filename },
		func(r db.UnknownRow) int64 { return r.ScreenshotsDirID },
		func(r *db.UnknownRow, id int64) { r.ScreenshotsDirID = id },
		resolve, targetStore.UpsertUnknown)
}

// movePhase1Sidecars copies the per-key sidecar state (annotations,
// hidden flag) into the target.
func movePhase1Sidecars(targetStore db.Store, matchKeys []string, annotations map[string]db.Annotation, hidden map[string]bool) error {
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
	return nil
}

// movePhase1Overrides copies the user-override layer (the user_match_data row
// plus the queue / play-mode aux rows) into the target. A manual match — or an
// edited OCR match — lives entirely here, so without this the move would delete
// it from the source and write nothing to the target.
func (a *App) movePhase1Overrides(targetStore db.Store, matchKeys []string) error {
	userData, err := a.store.LoadAllUserMatchData()
	if err != nil {
		return fmt.Errorf("move: load user data: %w", err)
	}
	queues, err := a.store.LoadMatchQueues()
	if err != nil {
		return fmt.Errorf("move: load queues: %w", err)
	}
	playModes, err := a.store.LoadMatchPlayModes()
	if err != nil {
		return fmt.Errorf("move: load play modes: %w", err)
	}
	for _, k := range matchKeys {
		if d, ok := userData[k]; ok {
			if err := targetStore.UpsertUserMatchData(d); err != nil {
				return fmt.Errorf("move: copy user data for %q: %w", k, err)
			}
		}
		if q, ok := queues[k]; ok && q.QueueType != "" {
			if err := targetStore.SetMatchQueue(k, q.QueueType); err != nil {
				return fmt.Errorf("move: copy queue for %q: %w", k, err)
			}
		}
		if pm, ok := playModes[k]; ok && pm.PlayMode != "" {
			if err := targetStore.SetMatchPlayMode(k, pm.PlayMode); err != nil {
				return fmt.Errorf("move: copy play mode for %q: %w", k, err)
			}
		}
	}
	return nil
}

// movePhase2DeleteSource hard-deletes the moved rows from the source.
// HardDeleteMatch is idempotent on its own, so a partial completion +
// retry is safe.
func (a *App) movePhase2DeleteSource(matchKeys []string) error {
	for _, k := range matchKeys {
		if err := a.store.HardDeleteMatch(k); err != nil {
			return fmt.Errorf("move: delete source row for %q: %w", k, err)
		}
	}
	return nil
}
