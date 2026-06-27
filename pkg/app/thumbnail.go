package app

import (
	"os"

	"recall/pkg/match"
)

// attachThumbnails resolves each record's ThumbnailFile — the best on-disk
// screenshot for the leaf-row hover preview. It lists each referenced
// screenshots directory at most once (not one stat per file) and reflects the
// live filesystem, so a data-only import or a deleted/moved screenshot leaves
// ThumbnailFile empty and the UI shows no preview rather than requesting a URL
// it knows will 404.
func (a *App) attachThumbnails(recs []match.MatchRecord) {
	dirFiles := map[string]map[string]bool{} // resolved dir -> set of basenames
	dirByID := map[int64]string{}            // dir-id -> resolved dir (memoized)

	resolveDir := func(dirID int64) string {
		if dir, ok := dirByID[dirID]; ok {
			return dir
		}
		dir := a.resolveScreenshotDir(dirID)
		dirByID[dirID] = dir
		return dir
	}
	listDir := func(dir string) map[string]bool {
		if set, ok := dirFiles[dir]; ok {
			return set
		}
		set := map[string]bool{}
		if dir != "" {
			if entries, err := os.ReadDir(dir); err == nil {
				for _, e := range entries {
					if !e.IsDir() {
						set[e.Name()] = true
					}
				}
			}
		}
		dirFiles[dir] = set
		return set
	}
	onDisk := func(dirID int64, filename string) bool {
		return listDir(resolveDir(dirID))[filename]
	}

	for i := range recs {
		recs[i].ThumbnailFile = pickThumbnail(recs[i], onDisk)
	}
}

// pickThumbnail returns the first source file present on disk, preferring the
// SUMMARY screenshot (the most recognisable thumbnail), then TEAMS, then any
// remaining source file. Empty when the match has no on-disk image.
func pickThumbnail(rec match.MatchRecord, onDisk func(dirID int64, filename string) bool) string {
	exists := func(f string) bool { return onDisk(rec.SourceDirIDs[f], f) }

	var summary, teams string
	for _, f := range rec.SourceFiles {
		switch rec.SourceTypes[f] {
		case "summary":
			if summary == "" {
				summary = f
			}
		case "teams":
			if teams == "" {
				teams = f
			}
		}
	}
	if summary != "" && exists(summary) {
		return summary
	}
	if teams != "" && exists(teams) {
		return teams
	}
	for _, f := range rec.SourceFiles {
		if exists(f) {
			return f
		}
	}
	return ""
}
