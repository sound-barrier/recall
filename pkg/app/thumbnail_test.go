package app_test

import (
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/match"
)

func findRec(t *testing.T, recs []match.MatchRecord, key string) match.MatchRecord {
	t.Helper()
	for _, r := range recs {
		if r.MatchKey == key {
			return r
		}
	}
	t.Fatalf("match %q not found in %d records", key, len(recs))
	return match.MatchRecord{}
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
