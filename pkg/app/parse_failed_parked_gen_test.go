package app_test

import (
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/parser"
)

// A file parked under an older parser gets one more normal run under this
// one: its failures were that parser's verdict, and this parser may read it.
// One parked under THIS parser stays parked. Both the skip set and the
// Unknown tab's Parked flag answer the same way.
func TestApp_ParkedFailuresFromAnOlderParserAreRetried(t *testing.T) {
	a, fake := newParseReadyApp(t)
	dirID, err := fake.EnsureScreenshotsDir(app.SettingsOf(a).ScreenshotsDir)
	if err != nil {
		t.Fatal(err)
	}
	fake.FailedFiles = map[string]db.FailedFileRow{
		"old.png": {Filename: "old.png", ScreenshotsDirID: dirID, Attempts: 3, ParserGeneration: parser.Generation - 1, LastFailedAt: "2026-09-20T00:00:00Z"},
		"new.png": {Filename: "new.png", ScreenshotsDirID: dirID, Attempts: 3, ParserGeneration: parser.Generation, LastFailedAt: "2026-09-21T00:00:00Z"},
	}
	var skip map[string]bool
	stubParseCapturingSkip(t, &skip)

	if err := a.ParseScreenshots(); err != nil {
		t.Fatalf("ParseScreenshots: %v", err)
	}
	if skip["old.png"] || !skip["new.png"] {
		t.Errorf("skip set = %v, want new.png parked and old.png retried", skip)
	}
	files, err := a.GetFailedFiles()
	if err != nil {
		t.Fatalf("GetFailedFiles: %v", err)
	}
	for _, f := range files {
		if want := f.Filename == "new.png"; f.Parked != want {
			t.Errorf("%s parked = %v, want %v", f.Filename, f.Parked, want)
		}
	}
}
