package aggregate

import "recall/pkg/parser"

// NewScreenshotView builds a ScreenshotView (unexported fields) for tests that
// drive FoldGroup directly. Test-only — compiled only under `go test`.
func NewScreenshotView(filename, typeName, matchKey, parsedAt string, dirID int64, data parser.MatchResult) ScreenshotView {
	return ScreenshotView{filename: filename, typeName: typeName, matchKey: matchKey, parsedAt: parsedAt, dirID: dirID, data: data}
}
