package screenshot

import (
	"os"

	"recall/pkg/match"
	"recall/pkg/parser"
)

// AttachThumbnails resolves each record's ThumbnailFile — the best on-disk
// screenshot for the leaf-row hover preview. It resolves each dir-id at most
// once and lists each referenced screenshots directory at most once (not one
// stat per file), and reflects the live filesystem, so a data-only import or a
// deleted/moved screenshot leaves ThumbnailFile empty and the UI shows no
// preview rather than requesting a URL it knows will 404.
func AttachThumbnails(recs []match.Record, resolve DirResolver) {
	dirFiles := map[string]map[string]bool{} // resolved dir -> set of basenames
	dirByID := map[int64]string{}            // dir-id -> resolved dir (memoized)

	resolveDir := func(dirID int64) string {
		if dir, ok := dirByID[dirID]; ok {
			return dir
		}
		dir := resolve(dirID)
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
// every SUMMARY screenshot, then every TEAMS, then every source file in
// original order (re-listing the leaders is harmless — the directory listing
// behind the on-disk check is memoized).
//
// ALL of each type, not just the first. Promoting only the first summary meant
// that when that one file was off disk — the deleted-or-moved case this
// on-disk check exists for — the promoted teams entry was reached before a
// second summary that was still present, and a teams screenshot won over an
// available summary. The type preference has to survive a missing file or it
// is not a preference, just a guess about the first capture.
//
// Within a type the order is SourceFiles order, which aggregate builds with
// correlate.UnionSortedStrings — sorted, so "first" is the lexically smallest
// filename and therefore the earliest capture. Deterministic across runs.
func thumbnailCandidates(rec match.Record) []string {
	candidates := make([]string, 0, len(rec.SourceFiles)*2)
	for _, want := range [...]parser.ScreenshotType{parser.TypeSummary, parser.TypeTeams} {
		for _, f := range rec.SourceFiles {
			if rec.SourceTypes[f] == want {
				candidates = append(candidates, f)
			}
		}
	}
	return append(candidates, rec.SourceFiles...)
}
