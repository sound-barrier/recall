package profiles

import (
	"errors"
	"fmt"

	"recall/pkg/db"
)

// ErrMoveTargetIsActive is returned when a cross-profile move names
// the active profile as the target — a no-op move that the user
// almost certainly didn't intend.
var ErrMoveTargetIsActive = errors.New("move target is the active profile")

// Move transfers every row keyed on matchKeys from src (the active
// profile's store) to dst (the target profile's store, opened by the
// caller). The transfer is two-phase:
//
//  1. Upsert every parent row + its children into dst (via the same
//     UpsertSummary / UpsertTeams / etc. APIs production parse uses) +
//     the user-override layer (user_match_data + the queue / play-mode
//     aux rows — a manual match or an edited OCR match lives entirely
//     there) + every annotation + the hidden_matches and pinned_matches
//     flags + the review status. Filenames carry over verbatim so a
//     future re-parse of the same source PNG on the new profile is a
//     no-op.
//  2. Hard-delete the rows on src. Per-key HardDeleteMatch so a
//     single bad key doesn't strand the rest.
//
// Phase 1's copy set MUST cover every table HardDeleteMatch wipes:
// phase 2 destroys the source row outright, so a sidecar phase 1
// forgets is lost, not merely left behind.
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
// pass through as zero (null). Name/target validation is the
// caller's job (ValidateName + Contains + the active-target check).
func Move(src, dst db.Store, matchKeys []string) error {
	source, err := loadMoveSource(src)
	if err != nil {
		return err
	}

	keep := make(map[string]bool, len(matchKeys))
	for _, k := range matchKeys {
		keep[k] = true
	}

	resolveDirID := dirIDResolver(dst, source.snap.ScreenshotsDirs)
	if err := movePhase1Parents(dst, source.snap, keep, resolveDirID); err != nil {
		return err
	}
	if err := movePhase1Sidecars(dst, matchKeys, source); err != nil {
		return err
	}
	if err := movePhase1Overrides(src, dst, matchKeys); err != nil {
		return err
	}
	return movePhase2DeleteSource(src, matchKeys)
}

// loadMoveSource loads the active profile's full state once so the move
// doesn't make N round-trips per match. The aggregator already does the
// same shape; in-memory filter is fine until profile sizes get into the
// 10k+ match range, at which point a SQL-side LoadForKeys filter is the
// natural next step (existing read paths stay unchanged).
func loadMoveSource(src db.Store) (moveSource, error) {
	var out moveSource
	snap, err := src.LoadAll()
	if err != nil {
		return moveSource{}, fmt.Errorf("move: load source: %w", err)
	}
	out.snap = snap
	if out.annotations, err = src.LoadAnnotations(); err != nil {
		return moveSource{}, fmt.Errorf("move: load annotations: %w", err)
	}
	if out.hidden, err = src.LoadHiddenKeys(); err != nil {
		return moveSource{}, fmt.Errorf("move: load hidden keys: %w", err)
	}
	if out.pinned, err = src.LoadPinnedKeys(); err != nil {
		return moveSource{}, fmt.Errorf("move: load pinned keys: %w", err)
	}
	if out.reviews, err = src.LoadReviews(); err != nil {
		return moveSource{}, fmt.Errorf("move: load reviews: %w", err)
	}
	return out, nil
}

// moveSource is the source profile's state, read once up front. A struct
// rather than a positional return list because hidden and pinned share the
// same `map[string]bool` type — as adjacent positional returns a swap of the
// two would compile silently.
type moveSource struct {
	snap        db.Screenshots
	annotations map[string]db.Annotation
	hidden      map[string]bool
	pinned      map[string]bool
	reviews     map[string]db.ReviewState
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
// hidden / pinned flags, review status) into the target. SetReview stamps a
// fresh reviewed_at on the target — the same timestamp-refresh convention
// HideMatch already applies to hidden_at on move.
func movePhase1Sidecars(targetStore db.Store, matchKeys []string, src moveSource) error {
	for _, k := range matchKeys {
		if err := copyMatchSidecars(targetStore, k, src); err != nil {
			return err
		}
	}
	return nil
}

// copyMatchSidecars reproduces one match's sidecar rows on the target.
func copyMatchSidecars(targetStore db.Store, k string, src moveSource) error {
	if ann, ok := src.annotations[k]; ok {
		if err := targetStore.SetAnnotation(ann); err != nil {
			return fmt.Errorf("move: copy annotation for %q: %w", k, err)
		}
	}
	if err := copyPresenceFlags(targetStore, k, src); err != nil {
		return err
	}
	if r, ok := src.reviews[k]; ok && r.ReviewedBy != "" {
		if err := targetStore.SetReview(k, r.ReviewedBy); err != nil {
			return fmt.Errorf("move: copy review for %q: %w", k, err)
		}
	}
	return nil
}

// copyPresenceFlags copies the presence-is-state sidecars, where the row's
// existence IS the value: hidden_matches and pinned_matches.
func copyPresenceFlags(targetStore db.Store, k string, src moveSource) error {
	if src.hidden[k] {
		if err := targetStore.HideMatch(k); err != nil {
			return fmt.Errorf("move: copy hidden flag for %q: %w", k, err)
		}
	}
	if src.pinned[k] {
		if err := targetStore.PinMatch(k); err != nil {
			return fmt.Errorf("move: copy pinned flag for %q: %w", k, err)
		}
	}
	return nil
}

// movePhase1Overrides copies the user-override layer (the user_match_data row
// plus the queue / play-mode aux rows) into the target. A manual match — or an
// edited OCR match — lives entirely here, so without this the move would delete
// it from the source and write nothing to the target.
func movePhase1Overrides(src, targetStore db.Store, matchKeys []string) error {
	userData, err := src.LoadAllUserMatchData()
	if err != nil {
		return fmt.Errorf("move: load user data: %w", err)
	}
	queues, err := src.LoadMatchQueues()
	if err != nil {
		return fmt.Errorf("move: load queues: %w", err)
	}
	playModes, err := src.LoadMatchPlayModes()
	if err != nil {
		return fmt.Errorf("move: load play modes: %w", err)
	}
	for _, k := range matchKeys {
		if err := copyOverrideRows(targetStore, k, userData[k], queues[k], playModes[k]); err != nil {
			return err
		}
	}
	return nil
}

// copyOverrideRows writes one match's override layer to the target: the
// user_match_data row plus the queue / play-mode aux rows, each skipped when
// the source has nothing for the key (the zero value carries an empty field).
func copyOverrideRows(targetStore db.Store, k string, d db.UserMatchData, q db.QueueState, pm db.PlayModeState) error {
	if d.MatchKey != "" {
		if err := targetStore.UpsertUserMatchData(d); err != nil {
			return fmt.Errorf("move: copy user data for %q: %w", k, err)
		}
	}
	if q.QueueType != "" {
		if err := targetStore.SetMatchQueue(k, q.QueueType); err != nil {
			return fmt.Errorf("move: copy queue for %q: %w", k, err)
		}
	}
	if pm.PlayMode != "" {
		if err := targetStore.SetMatchPlayMode(k, pm.PlayMode); err != nil {
			return fmt.Errorf("move: copy play mode for %q: %w", k, err)
		}
	}
	return nil
}

// movePhase2DeleteSource hard-deletes the moved rows from the source.
// HardDeleteMatch is idempotent on its own, so a partial completion +
// retry is safe.
func movePhase2DeleteSource(src db.Store, matchKeys []string) error {
	for _, k := range matchKeys {
		if err := src.HardDeleteMatch(k); err != nil {
			return fmt.Errorf("move: delete source row for %q: %w", k, err)
		}
	}
	return nil
}
