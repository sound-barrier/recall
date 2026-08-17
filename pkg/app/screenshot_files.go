package app

import (
	"net/http"

	"recall/pkg/match"
	"recall/pkg/screenshot"
)

// The on-disk screenshot surface — the /_screenshot/ handler and the
// thumbnail pick — lives in pkg/screenshot (carved out per the
// decomposition plan). What stays here is the one step that needs App
// state: turning a screenshots_dirs row id into a directory, which
// takes the store for the lookup and the live settings for the
// fallback. Both leaf entry points receive it as a DirResolver.

// ScreenshotHandler serves the on-disk screenshot bytes under
//
//	/_screenshot/<dir-id>/<filename>
//
// Wired into the Wails AssetServer (pkg/cmd/wails.go) and server mode's
// mux (pkg/cmd/server.go). The URL shape, the path-injection guards and
// the reason dir-id is in the URL are documented on screenshot.Handler.
func (a *App) ScreenshotHandler() http.Handler {
	return screenshot.Handler(a.resolveScreenshotDir)
}

// attachThumbnails fills in each record's ThumbnailFile on the way out of
// GetMatchResults.
func (a *App) attachThumbnails(recs []match.Record) {
	screenshot.AttachThumbnails(recs, a.resolveScreenshotDir)
}

// resolveScreenshotDir picks the on-disk directory for a screenshot:
// dir-id > 0 means look it up; dir-id == 0 means use the currently-
// configured screenshots folder (the only path for unparsed files in the
// watched dir). LookupScreenshotsDir returns ("", nil) for unknown ids, so
// the handler falls through to the configured dir — a stale FK from a
// deleted screenshots_dirs row doesn't hard-fail the preview.
func (a *App) resolveScreenshotDir(dirID int64) string {
	if dirID > 0 && a.store != nil {
		if resolved, _ := a.store.LookupScreenshotsDir(dirID); resolved != "" {
			return resolved
		}
	}
	return a.settingsSnapshot().ScreenshotsDir
}
