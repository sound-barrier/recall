package probe_test

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"recall/pkg/probe"
)

// Tests use t.Setenv("HOME", …) to point os.UserHomeDir at a
// scratch tree under t.TempDir(). On linux UserHomeDir reads $HOME
// directly; on darwin/windows it does too as a first preference, so
// the same recipe works across all three targets.
//
// On Windows, os.UserHomeDir consults %USERPROFILE% first. We set
// both to be safe — extra env entries are harmless when not read.

func setHome(t *testing.T, home string) {
	t.Helper()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
}

func TestFirstExistingCandidate_FindsFirstMatch(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	tried := probe.ProbeCandidates()
	if len(tried) == 0 {
		t.Skipf("no probe candidates on %s; nothing to assert", runtime.GOOS)
	}
	want := tried[0]
	if err := os.MkdirAll(want, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", want, err)
	}

	got, ok := probe.FirstExistingCandidate()
	if !ok {
		t.Fatalf("expected ok=true; first candidate %q exists on disk", want)
	}
	if got != want {
		t.Fatalf("path = %q; want %q", got, want)
	}
}

func TestFirstExistingCandidate_EmptyHomeReturnsNotFound(t *testing.T) {
	home := t.TempDir()
	setHome(t, home)

	_ = home
	got, ok := probe.FirstExistingCandidate()
	if ok {
		t.Fatalf("expected ok=false on an empty home; got path=%q", got)
	}
	if got != "" {
		t.Fatalf("path = %q; want empty", got)
	}
	// Sanity: probeCandidates produces an under-HOME list — defensive
	// check kept from the old test so a regression that points the
	// probe at the real user home still fails loudly.
	for _, p := range probe.ProbeCandidates() {
		if !filepath.IsAbs(p) {
			t.Errorf("candidate %q is not absolute", p)
		}
		rel, err := filepath.Rel(home, p)
		if err != nil || rel == "" || strings.HasPrefix(rel, "..") {
			t.Errorf("candidate %q is not under HOME=%s (rel=%q err=%v)", p, home, rel, err)
		}
	}
}

func TestProbeScreenshotsCandidates_NonWindowsReturnsEmpty(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has its own assertion below")
	}
	got := probe.ScreenshotsCandidates()
	if len(got) != 0 {
		t.Errorf("non-Windows should return empty slice; got %+v", got)
	}
}

func TestProbeScreenshotsCandidates_WindowsReportsAllFour(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only behaviour")
	}
	home := t.TempDir()
	setHome(t, home)

	// Materialise three of the four candidate paths so the test
	// exercises both "exists" and "not found" cards in one pass.
	// Steam stays absent (no registry shim in unit tests).
	must := func(p string) {
		t.Helper()
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", p, err)
		}
	}
	must(filepath.Join(home, "Videos", "NVIDIA", "Overwatch 2"))
	must(filepath.Join(home, "Documents", "Overwatch", "ScreenShots", "Overwatch"))
	must(filepath.Join(home, "Pictures", "Screenshots"))

	got := probe.ScreenshotsCandidates()
	if len(got) != 4 {
		t.Fatalf("want 4 cards on Windows; got %d (%+v)", len(got), got)
	}
	wantNames := []string{"nvidia", "prntscn", "snip", "steam"}
	for i, n := range wantNames {
		if got[i].Name != n {
			t.Errorf("card[%d].Name = %q; want %q", i, got[i].Name, n)
		}
	}
	if !got[0].Exists || !got[1].Exists || !got[2].Exists {
		t.Errorf("expected nvidia/prntscn/snip to be found; got exists=%v/%v/%v",
			got[0].Exists, got[1].Exists, got[2].Exists)
	}
	if got[3].Exists {
		t.Errorf("Steam should be absent in unit tests; got exists=true path=%q", got[3].Path)
	}
}

func TestProbeScreenshotsCandidateStats_NonWindowsReturnsEmpty(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has its own assertion below")
	}
	got := probe.ScreenshotsCandidateStats()
	if len(got) != 0 {
		t.Errorf("non-Windows should return empty slice; got %+v", got)
	}
}

func TestProbeScreenshotsCandidateStats_WindowsCountsFilesAndRecognised(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only behaviour")
	}
	home := t.TempDir()
	setHome(t, home)

	// Materialise the Nvidia candidate dir + drop three files: two
	// canonical Nvidia-format names, one stray PDF that should NOT
	// count as recognised.
	nvidiaDir := filepath.Join(home, "Videos", "NVIDIA", "Overwatch 2")
	if err := os.MkdirAll(nvidiaDir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", nvidiaDir, err)
	}
	for _, name := range []string{
		"Overwatch 2 Screenshot 2026.05.10 - 19.57.14.89.png",
		"Overwatch 2 Screenshot 2026.05.11 - 20.13.22.15.png",
		"random-document.pdf",
	} {
		p := filepath.Join(nvidiaDir, name)
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatalf("write %s: %v", p, err)
		}
	}

	got := probe.ScreenshotsCandidateStats()
	if len(got) != 4 {
		t.Fatalf("want 4 cards on Windows; got %d (%+v)", len(got), got)
	}
	// Find the Nvidia entry — order matches probe.CandidateSources().
	var nvidia probe.NamedCandidateStats
	for _, s := range got {
		if s.Name == "nvidia" {
			nvidia = s
			break
		}
	}
	if nvidia.FileCount != 3 {
		t.Errorf("nvidia.FileCount = %d; want 3", nvidia.FileCount)
	}
	if nvidia.RecognisedCount != 2 {
		t.Errorf("nvidia.RecognisedCount = %d; want 2", nvidia.RecognisedCount)
	}
	if nvidia.LastModified == "" {
		t.Error("nvidia.LastModified should be populated when files exist")
	}
}

func TestProbeScreenshotsCandidateStats_NonExistentSourcesReturnEmpty(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Windows-only behaviour")
	}
	home := t.TempDir()
	setHome(t, home)

	got := probe.ScreenshotsCandidateStats()
	if len(got) != 4 {
		t.Fatalf("want 4 cards on Windows; got %d", len(got))
	}
	for _, s := range got {
		if s.FileCount != 0 || s.RecognisedCount != 0 || s.LastModified != "" {
			t.Errorf("source %q with non-existent path should be zero-valued, got %+v", s.Name, s)
		}
	}
}

func TestWalkSourceDir_BoundedAndSkipsDirs(t *testing.T) {
	tmp := t.TempDir()
	// Materialise: 3 files, 1 subdirectory.
	for _, name := range []string{"a.png", "b.png", "c.png"} {
		if err := os.WriteFile(filepath.Join(tmp, name), []byte("x"), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	if err := os.Mkdir(filepath.Join(tmp, "subdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	files, latest := probe.WalkSourceDir(tmp)
	if len(files) != 3 {
		t.Errorf("expected 3 regular files; got %d (%v)", len(files), files)
	}
	if latest.IsZero() {
		t.Error("latest mtime should be populated when files exist")
	}
}

func TestWalkSourceDir_MissingDirReturnsEmpty(t *testing.T) {
	files, latest := probe.WalkSourceDir("/nonexistent/path/please")
	if len(files) != 0 {
		t.Errorf("expected empty; got %v", files)
	}
	if !latest.IsZero() {
		t.Error("expected zero mtime for missing dir")
	}
}

func TestCountRecognised_MatchesParserGrammar(t *testing.T) {
	names := []string{
		"Overwatch 2 Screenshot 2026.05.10 - 19.57.14.89.png", // nvidia ✓
		"ScreenShot_26-06-07_22-59-52-000.jpg",                // prntscn ✓
		"Screenshot 2026-06-07 224855.png",                    // snip ✓
		"IMG_1234.png",                                        // none
		"random.pdf",                                          // none
	}
	n := probe.CountRecognised(names)
	if n != 3 {
		t.Errorf("countRecognised = %d; want 3", n)
	}
}

func TestDirExists(t *testing.T) {
	tmp := t.TempDir()
	if !probe.DirExists(tmp) {
		t.Errorf("probe.DirExists(%q) = false; want true", tmp)
	}
	if probe.DirExists(filepath.Join(tmp, "nope")) {
		t.Errorf("dirExists on missing path returned true")
	}
	// Files are not directories.
	f := filepath.Join(tmp, "file")
	if err := os.WriteFile(f, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if probe.DirExists(f) {
		t.Errorf("dirExists on a file returned true")
	}
	if probe.DirExists("") {
		t.Errorf("dirExists on empty returned true")
	}
}
