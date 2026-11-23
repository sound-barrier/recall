package profiles

import (
	"fmt"

	"recall/pkg/db"
)

// movePhase1Evidence copies each moved screenshot's field evidence onto the
// target, under the target's id for its folder. Part of phase 1's copy set
// because HardDeleteMatch wipes it: evidence left behind is lost, and the
// moved readings would point at no region until a re-parse on the target.
func movePhase1Evidence(targetStore db.Store, src moveSource, keep map[string]bool, resolve func(int64) (int64, error)) error {
	for file := range movedFiles(src.snap, keep) {
		ev, ok := src.evidence[file]
		if !ok {
			continue
		}
		dirID, err := resolve(file.DirID)
		if err != nil {
			return fmt.Errorf("move: resolve screenshots_dir for %q: %w", file.Filename, err)
		}
		if err := targetStore.ReplaceFieldEvidence(db.FileRef{DirID: dirID, Filename: file.Filename}, ev); err != nil {
			return fmt.Errorf("move: copy field evidence for %q: %w", file.Filename, err)
		}
	}
	return nil
}

// movedFiles collects every parent-row screenshot (folder + filename)
// belonging to a moved match. An unset folder is the sentinel row, as the
// store files it.
func movedFiles(snap db.Screenshots, keep map[string]bool) map[db.FileRef]bool {
	out := map[db.FileRef]bool{}
	collectMovedFiles(out, snap.Summaries, keep, func(r db.SummaryRow) (string, int64, string) { return r.MatchKey, r.ScreenshotsDirID, r.Filename })
	collectMovedFiles(out, snap.Teams, keep, func(r db.TeamsRow) (string, int64, string) { return r.MatchKey, r.ScreenshotsDirID, r.Filename })
	collectMovedFiles(out, snap.Personals, keep, func(r db.PersonalRow) (string, int64, string) { return r.MatchKey, r.ScreenshotsDirID, r.Filename })
	collectMovedFiles(out, snap.Ranks, keep, func(r db.RankRow) (string, int64, string) { return r.MatchKey, r.ScreenshotsDirID, r.Filename })
	collectMovedFiles(out, snap.Unknowns, keep, func(r db.UnknownRow) (string, int64, string) { return r.MatchKey, r.ScreenshotsDirID, r.Filename })
	return out
}

// collectMovedFiles adds one parent table's screenshots for the kept keys.
// Generic over the row type so the five parent tables share one loop rather
// than five copies (which is also what keeps movedFiles under the complexity
// ceiling).
func collectMovedFiles[T any](out map[db.FileRef]bool, rows []T, keep map[string]bool, key func(T) (string, int64, string)) {
	for _, r := range rows {
		matchKey, dirID, filename := key(r)
		if !keep[matchKey] {
			continue
		}
		out[db.FileRef{DirID: dirID, Filename: filename}.Filed()] = true
	}
}

// copyFieldConfirmations reproduces one match's confirmed readings on the
// target, each with the value it was confirmed at. Part of phase 1's copy set
// because HardDeleteMatch wipes them, and a lost confirmation re-opens a flag
// the user already looked at.
func copyFieldConfirmations(targetStore db.Store, k string, confirmed db.ConfirmedReadings) error {
	for field, value := range confirmed {
		if err := targetStore.ConfirmFieldReading(k, field, value); err != nil {
			return fmt.Errorf("move: copy confirmation of %s for %q: %w", field, k, err)
		}
	}
	return nil
}
