package aggregate

import (
	"cmp"
	"slices"

	"recall/pkg/db"
	"recall/pkg/match"
)

// FieldRegions lists where on the match's own screenshots each field was
// read, from the evidence the parse stored, ordered by file then field.
// found reports whether any screenshot row carries key; a match with no
// screenshots (manual, replay) or an unknown key is the caller's to tell
// apart. Never nil, so the list goes on the wire as [].
func FieldRegions(key string, snap db.Screenshots) (regions []match.FieldRegion, found bool) {
	views := collectViewsForKey(snap, key)
	regions = make([]match.FieldRegion, 0, len(views)*8)
	for _, v := range views {
		regions = append(regions, viewRegions(v, snap)...)
	}
	slices.SortFunc(regions, func(a, b match.FieldRegion) int {
		return cmp.Or(cmp.Compare(a.SourceFile, b.SourceFile), cmp.Compare(a.Field, b.Field))
	})
	return regions, len(views) > 0
}

// viewRegions is one screenshot's stored evidence as regions.
func viewRegions(v ScreenshotView, snap db.Screenshots) []match.FieldRegion {
	ev := snap.FieldEvidence[db.FileRef{DirID: v.dirID, Filename: v.filename}.Filed()]
	out := make([]match.FieldRegion, 0, len(ev.Fields))
	for _, f := range ev.Fields {
		out = append(out, match.FieldRegion{
			SourceFile: v.filename, DirID: servedDirID(v.dirID, snap.ScreenshotsDirs), Field: f.Field,
			X: f.Rect.Min.X, Y: f.Rect.Min.Y, Width: f.Rect.Dx(), Height: f.Rect.Dy(),
			ImageWidth: ev.ImageSize.X, ImageHeight: ev.ImageSize.Y,
		})
	}
	return out
}

// servedDirID is the folder id a /_screenshot URL for a row filed under
// dirID carries: the row's own folder while it still resolves, else 0, which
// the handler serves from the configured folder. A stale id after a folder
// row was deleted would otherwise name a URL that cannot resolve.
func servedDirID(dirID int64, dirs map[int64]string) int64 {
	if _, ok := dirs[dirID]; ok && dirID != 0 {
		return dirID
	}
	return 0
}
