package screenshot_test

import (
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/match"
	"recall/pkg/screenshot"
)

// dirWithFiles returns a tempdir holding one empty file per name.
func dirWithFiles(t *testing.T, names ...string) string {
	t.Helper()
	dir := t.TempDir()
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("png"), 0o600); err != nil {
			t.Fatalf("write %s: %v", n, err)
		}
	}
	return dir
}

// recordWith builds a record whose source files all live in dirID.
func recordWith(key string, dirID int64, typesByFile map[string]string, files ...string) match.Record {
	rec := match.Record{
		MatchKey:     key,
		SourceFiles:  files,
		SourceTypes:  typesByFile,
		SourceDirIDs: map[string]int64{},
	}
	for _, f := range files {
		rec.SourceDirIDs[f] = dirID
	}
	return rec
}

func TestAttachThumbnails_PrefersSummaryThenTeamsThenAnything(t *testing.T) {
	dir := dirWithFiles(t, "rank.png", "teams.png", "summary.png")
	recs := []match.Record{
		recordWith("all-three", 1,
			map[string]string{"rank.png": "rank", "teams.png": "teams", "summary.png": "summary"},
			"rank.png", "teams.png", "summary.png"),
		recordWith("no-summary", 1,
			map[string]string{"rank.png": "rank", "teams.png": "teams"},
			"rank.png", "teams.png"),
		recordWith("neither", 1,
			map[string]string{"rank.png": "rank"},
			"rank.png"),
	}

	screenshot.AttachThumbnails(recs, fixedDir(dir))

	want := []string{"summary.png", "teams.png", "rank.png"}
	for i, w := range want {
		if got := recs[i].ThumbnailFile; got != w {
			t.Errorf("%s: ThumbnailFile = %q, want %q", recs[i].MatchKey, got, w)
		}
	}
}

func TestAttachThumbnails_EmptyWhenNoSourceFileIsOnDisk(t *testing.T) {
	// The data-only import / deleted-screenshot case: rows exist, bytes
	// do not, and the UI must not request a URL it knows will 404.
	recs := []match.Record{
		recordWith("gone", 1, map[string]string{"summary.png": "summary"}, "summary.png"),
	}

	screenshot.AttachThumbnails(recs, fixedDir(t.TempDir()))

	if got := recs[0].ThumbnailFile; got != "" {
		t.Errorf("ThumbnailFile = %q with nothing on disk, want empty", got)
	}
}

func TestAttachThumbnails_UnresolvedDirYieldsNoThumbnail(t *testing.T) {
	// "" is the resolver's "no directory" answer; there is nothing to list.
	recs := []match.Record{
		recordWith("nowhere", 3, map[string]string{"summary.png": "summary"}, "summary.png"),
	}

	screenshot.AttachThumbnails(recs, fixedDir(""))

	if got := recs[0].ThumbnailFile; got != "" {
		t.Errorf("ThumbnailFile = %q for an unresolved dir, want empty", got)
	}
}

func TestAttachThumbnails_ResolvesEachDirIDExactlyOnce(t *testing.T) {
	// The memoization is the whole reason this function exists instead of a
	// stat per file: a corpus of 2,000 matches shot from two folders must
	// ask the resolver twice, not 2,000 times. Behind each resolver call is
	// a store round-trip in production, and behind each distinct directory
	// one os.ReadDir.
	dir := dirWithFiles(t, "summary.png")
	calls := map[int64]int{}
	counting := func(dirID int64) string {
		calls[dirID]++
		return dir
	}

	summaryOnly := map[string]string{"summary.png": "summary"}
	recs := []match.Record{
		recordWith("a", 1, summaryOnly, "summary.png"),
		recordWith("b", 1, summaryOnly, "summary.png"),
		recordWith("c", 2, summaryOnly, "summary.png"),
		recordWith("d", 2, summaryOnly, "summary.png"),
		recordWith("e", 1, summaryOnly, "summary.png"),
	}

	screenshot.AttachThumbnails(recs, counting)

	if len(calls) != 2 || calls[1] != 1 || calls[2] != 1 {
		t.Errorf("resolver calls = %v, want exactly one per distinct dir-id ({1:1, 2:1})", calls)
	}
	for _, r := range recs {
		if r.ThumbnailFile != "summary.png" {
			t.Fatalf("%s: ThumbnailFile = %q, want summary.png — the memo must not change the answer",
				r.MatchKey, r.ThumbnailFile)
		}
	}
}

func TestAttachThumbnails_RemembersThatADirIDResolvesToNothing(t *testing.T) {
	// The negative answer is memoized too, or a corpus of unresolvable
	// records re-asks the store once per record.
	calls := 0
	counting := func(int64) string {
		calls++
		return ""
	}
	summaryOnly := map[string]string{"summary.png": "summary"}
	recs := []match.Record{
		recordWith("a", 9, summaryOnly, "summary.png"),
		recordWith("b", 9, summaryOnly, "summary.png"),
	}

	screenshot.AttachThumbnails(recs, counting)

	if calls != 1 {
		t.Errorf("resolver called %d times for one dir-id, want 1", calls)
	}
}
