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
func (a *App) attachThumbnails(recs []match.Record) {
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
// SUMMARY screenshot (the most recognizable thumbnail), then TEAMS, then any
// remaining source file. Empty when the match has no on-disk image.
func pickThumbnail(rec match.Record, onDisk func(dirID int64, filename string) bool) string {
	for _, f := range thumbnailCandidates(rec) {
		if onDisk(rec.SourceDirIDs[f], f) {
			return f
		}
	}
	return ""
}

// thumbnailCandidates orders a match's source files for the thumbnail pick:
// the first SUMMARY screenshot, then the first TEAMS, then every source file
// in original order (re-listing the two leaders is harmless — the directory
// listing behind the on-disk check is memoized).
func thumbnailCandidates(rec match.Record) []string {
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
	candidates := make([]string, 0, len(rec.SourceFiles)+2)
	if summary != "" {
		candidates = append(candidates, summary)
	}
	if teams != "" {
		candidates = append(candidates, teams)
	}
	return append(candidates, rec.SourceFiles...)
}
