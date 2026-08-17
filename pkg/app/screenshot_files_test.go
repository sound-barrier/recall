package app_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"recall/pkg/app"
	"recall/pkg/db"
	"recall/pkg/db/dbtest"
	"recall/pkg/match"
)

// What the shell still owns of the screenshot surface: resolveScreenshotDir,
// and the two one-line delegators that hand it to pkg/screenshot. The URL
// shape, the path-injection guards and the thumbnail pick are tested against
// the leaf in pkg/screenshot; these tests cover the three branches only the
// shell can reach — dir-id 0, a dir-id the store knows, a dir-id it does not —
// and prove both delegators are wired to the real resolver.
//
// Tests here set app.SettingsOf(a).ScreenshotsDir directly to avoid touching
// real on-disk settings via SetScreenshotsDir.

// setupDirWithFile returns a tempdir containing one file (`name`,
// with the given contents). t.TempDir() handles cleanup.
func setupDirWithFile(t *testing.T, name, contents string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(contents), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return dir
}

// fire dispatches a GET to handler and returns the recorder.
func fire(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
	h.ServeHTTP(rec, req)
	return rec
}

// seedFakeWithDir wires up a *Fake with one SummaryRow pointing at
// the given dir id. Returns the id so tests can build the URL.
func seedFakeWithDir(t *testing.T, fake *dbtest.Fake, filename, dir string) int64 {
	t.Helper()
	id, err := fake.EnsureScreenshotsDir(dir)
	if err != nil {
		t.Fatalf("EnsureScreenshotsDir: %v", err)
	}
	if err := fake.UpsertSummary(db.SummaryRow{
		Filename:         filename,
		MatchKey:         "match-t",
		ScreenshotsDirID: id,
	}); err != nil {
		t.Fatalf("UpsertSummary: %v", err)
	}
	return id
}

func TestScreenshotHandler_DirID0_ServesConfiguredFile(t *testing.T) {
	// Dir-id 0 is the "use the currently-configured screenshots
	// folder" sentinel — embedded in URLs for files not yet in the
	// DB (the parse-progress inline preview path). The store is never
	// consulted for it, which is why an App with no store answers.
	dir := setupDirWithFile(t, "shot.png", "fake-png-bytes")
	a := &app.App{}
	app.SettingsOf(a).ScreenshotsDir = dir

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/0/shot.png")

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "fake-png-bytes" {
		t.Errorf("body: got %q, want %q", got, "fake-png-bytes")
	}
}

func TestScreenshotHandler_DirID_ResolvesViaStore(t *testing.T) {
	// User originally parsed from `oldDir`, then switched their
	// screenshots folder to `newDir`. The old screenshot's bytes
	// are still in `oldDir`. The handler must follow the dir-id
	// embedded in the URL to find them.
	oldDir := setupDirWithFile(t, "old.png", "old-bytes")
	newDir := t.TempDir()

	fake := dbtest.New()
	dirID := seedFakeWithDir(t, fake, "old.png", oldDir)

	a := app.NewWithStore(fake)
	app.SettingsOf(a).ScreenshotsDir = newDir // current setting points elsewhere

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/"+strconv.FormatInt(dirID, 10)+"/old.png")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "old-bytes" {
		t.Errorf("body: got %q, want %q", got, "old-bytes")
	}
}

func TestScreenshotHandler_UnknownDirID_FallsBackToConfigured(t *testing.T) {
	// A dir-id that doesn't exist in screenshots_dirs (stale FK,
	// hand-crafted URL) falls back to the configured dir rather
	// than hard-failing.
	currentDir := setupDirWithFile(t, "fresh.png", "fresh-bytes")
	a := app.NewWithStore(dbtest.New())
	app.SettingsOf(a).ScreenshotsDir = currentDir

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/9999/fresh.png")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "fresh-bytes" {
		t.Errorf("body: got %q, want %q", got, "fresh-bytes")
	}
}

func TestScreenshotHandler_RejectsWhenScreenshotsDirUnconfigured(t *testing.T) {
	// No store and no configured folder: the resolver answers "", which
	// is the leaf's 404 contract.
	a := &app.App{}

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/0/anything.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func findRec(t *testing.T, recs []match.Record, key string) match.Record {
	t.Helper()
	for _, r := range recs {
		if r.MatchKey == key {
			return r
		}
	}
	t.Fatalf("match %q not found in %d records", key, len(recs))
	return match.Record{}
}

func TestApp_GetMatchResults_ThumbnailFile_OnlyWhenFileExists(t *testing.T) {
	a := newRealApp(t)
	shots := t.TempDir()
	if err := a.SetScreenshotsDir(shots); err != nil {
		t.Fatalf("SetScreenshotsDir: %v", err)
	}
	seedSummary(t, a, "a.png", "match-A")

	// The screenshot row exists in the DB, but the image file is NOT on disk
	// (the data-only import / deleted-file case): no thumbnail should resolve.
	recs, err := a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if got := findRec(t, recs, "match-A").ThumbnailFile; got != "" {
		t.Fatalf("ThumbnailFile = %q with no file on disk; want empty", got)
	}

	// Once the image lands on disk, the thumbnail resolves to it.
	if err := os.WriteFile(filepath.Join(shots, "a.png"), []byte("fake png"), 0o600); err != nil {
		t.Fatalf("write screenshot: %v", err)
	}
	recs, err = a.GetMatchResults()
	if err != nil {
		t.Fatalf("GetMatchResults: %v", err)
	}
	if got := findRec(t, recs, "match-A").ThumbnailFile; got != "a.png" {
		t.Fatalf("ThumbnailFile = %q after the file exists; want a.png", got)
	}
}
