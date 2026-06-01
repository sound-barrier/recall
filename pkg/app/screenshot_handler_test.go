package app

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"recall/pkg/db"
	"recall/pkg/db/dbtest"
)

// ScreenshotHandler is a CodeQL-flagged path-injection sink. The five
// rejection branches and both happy paths are exercised here in
// isolation — no real HTTP server, just httptest.NewRecorder against
// the handler the App returns. Tests in this file set
// a.settings.ScreenshotsDir directly (the test is in package app) to
// avoid touching real on-disk settings via SetScreenshotsDir.
//
// Pre-1.0 break: the URL shape is
// `/_screenshot/<dir-id>/<filename>`. Dir-id 0 means "use the
// currently configured screenshots folder"; positive values index
// the screenshots_dirs table.

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
	req := httptest.NewRequest(http.MethodGet, path, nil)
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

// ── Dir-id 0 (fallback to configured dir) ────────────────────────

func TestScreenshotHandler_DirID0_ServesConfiguredFile(t *testing.T) {
	// Dir-id 0 is the "use the currently-configured screenshots
	// folder" sentinel — embedded in URLs for files not yet in the
	// DB (the parse-progress inline preview path).
	dir := setupDirWithFile(t, "shot.png", "fake-png-bytes")
	a := &App{}
	a.settings.ScreenshotsDir = dir

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/0/shot.png")

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "fake-png-bytes" {
		t.Errorf("body: got %q, want %q", got, "fake-png-bytes")
	}
}

// ── Dir-id > 0 (look up via store) ────────────────────────────────

func TestScreenshotHandler_DirID_ResolvesViaStore(t *testing.T) {
	// User originally parsed from `oldDir`, then switched their
	// screenshots folder to `newDir`. The old screenshot's bytes
	// are still in `oldDir`. The handler must follow the dir-id
	// embedded in the URL to find them.
	oldDir := setupDirWithFile(t, "old.png", "old-bytes")
	newDir := t.TempDir()

	fake := dbtest.New()
	dirID := seedFakeWithDir(t, fake, "old.png", oldDir)

	a := &App{store: fake}
	a.settings.ScreenshotsDir = newDir // current setting points elsewhere

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
	a := &App{store: dbtest.New()}
	a.settings.ScreenshotsDir = currentDir

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/9999/fresh.png")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "fresh-bytes" {
		t.Errorf("body: got %q, want %q", got, "fresh-bytes")
	}
}

// ── URL-shape rejection branches ──────────────────────────────────

func TestScreenshotHandler_RejectsLegacyURLShape(t *testing.T) {
	// Pre-1.0 break: `/_screenshot/<filename>` (no dir-id segment)
	// is no longer valid. Old clients return 404.
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/legacy.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsNonIntegerDirID(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/abc/shot.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsNegativeDirID(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/-1/shot.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsPathOutsidePrefix(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/totally/unrelated/path.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsMalformedURLEscape(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	req := httptest.NewRequest(http.MethodGet, "/_screenshot/0/placeholder.png", nil)
	req.URL.Path = "/_screenshot/0/%ZZ.png"
	rec := httptest.NewRecorder()
	a.ScreenshotHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", rec.Code)
	}
}

func TestScreenshotHandler_RejectsPathTraversalDotDot(t *testing.T) {
	dir := setupDirWithFile(t, "shot.png", "fake-png-bytes")
	a := &App{}
	a.settings.ScreenshotsDir = dir

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/0/..")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404 (got body %q)", rec.Code, rec.Body.String())
	}
}

func TestScreenshotHandler_RejectsForwardSlashInName(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/0/foo%2Fbar.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsBackslashInName(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/0/foo%5Cbar.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsEmptyName(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/0/")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_RejectsWhenScreenshotsDirUnconfigured(t *testing.T) {
	a := &App{}

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/0/anything.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_ReturnsNotFoundForMissingFile(t *testing.T) {
	a := &App{}
	a.settings.ScreenshotsDir = t.TempDir()

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/0/missing.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404", rec.Code)
	}
}

func TestScreenshotHandler_ResolvedDirStillGoesThroughContainmentCheck(t *testing.T) {
	// Even with a valid dir-id resolving to a real dir, the
	// basename guard (no /, no \, no ..) must fire BEFORE the
	// lookup actually serves the file.
	oldDir := setupDirWithFile(t, "shot.png", "fake-bytes")
	fake := dbtest.New()
	dirID := seedFakeWithDir(t, fake, "../escape.png", oldDir)
	a := &App{store: fake}
	a.settings.ScreenshotsDir = oldDir

	rec := fire(t, a.ScreenshotHandler(), "/_screenshot/"+strconv.FormatInt(dirID, 10)+"/..%2Fescape.png")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status: got %d, want 404 (basename guard must clear)", rec.Code)
	}
}
