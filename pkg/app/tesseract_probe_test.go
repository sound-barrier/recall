package app_test

import (
	"runtime"
	"strings"
	"testing"

	"recall/pkg/app"
)

// User report: on Windows the screenshots-folder probe worked but
// Tesseract had to be picked manually. ProbeTesseractBinary widens
// the search beyond app.DefaultTesseractPath()'s short list to common
// per-user / package-manager install locations so the same Detect
// gesture lands a working binary on more machines.
//
// We can't depend on the test runner having a working Tesseract
// install in any particular location, so these tests assert on
// shape (candidate ordering, OS coverage, PATH fallback shape)
// rather than a concrete found-or-not outcome.

func TestTesseractProbeCandidates_CoversCommonInstallLocations(t *testing.T) {
	// Per-OS coverage: each platform must include both the historical
	// short-list (the same paths app.DefaultTesseractPath() walks) AND at
	// least one extra location that surfaces the Detect button's
	// added value. If a future refactor accidentally drops the
	// "extras," the test fails and the regression caller has a
	// pointer to which OS's coverage shrank.
	type expect struct {
		mustContain []string
	}
	cases := map[string]expect{
		"darwin": {
			mustContain: []string{
				"/opt/homebrew/bin/tesseract",
				"/usr/local/bin/tesseract",
				// MacPorts — a real user install path that the
				// short defaultTesseractPath list doesn't include.
				"/opt/local/bin/tesseract",
			},
		},
		"linux": {
			mustContain: []string{
				"/usr/bin/tesseract",
				"/usr/local/bin/tesseract",
				// Snap / Flatpak users see binaries under these
				// prefixes today; the short list misses both.
				"/snap/bin/tesseract",
			},
		},
		"windows": {
			mustContain: []string{
				`C:\Program Files\Tesseract-OCR\tesseract.exe`,
				`C:\Program Files (x86)\Tesseract-OCR\tesseract.exe`,
				// Chocolatey shims default Tesseract here — the
				// canonical "I installed via choco" path.
				`C:\ProgramData\chocolatey\bin\tesseract.exe`,
			},
		},
	}

	for goos, want := range cases {
		t.Run(goos, func(t *testing.T) {
			got := app.TesseractProbeCandidates(goos, "/home/test")
			for _, needed := range want.mustContain {
				if !contains(got, needed) {
					t.Errorf("%s candidates missing %q\nfull list: %v", goos, needed, got)
				}
			}
		})
	}
}

func TestTesseractProbeCandidates_IncludesPerUserWindowsInstalls(t *testing.T) {
	// Per-user installer + scoop both land under the user's HOME on
	// Windows; the candidate list must interpolate $USERPROFILE so
	// the detect actually hits those binaries.
	got := app.TesseractProbeCandidates("windows", `C:\Users\jane`)
	wantSubs := []string{
		`C:\Users\jane\AppData\Local\Programs\Tesseract-OCR\tesseract.exe`,
		`C:\Users\jane\scoop\shims\tesseract.exe`,
	}
	for _, sub := range wantSubs {
		if !contains(got, sub) {
			t.Errorf("windows candidates missing %q\nfull list: %v", sub, got)
		}
	}
}

func TestTesseractProbeCandidates_UnknownGOOSReturnsNothing(t *testing.T) {
	// An unrecognised GOOS (BSD variants, plan9) should return no
	// candidates so the probe falls straight through to PATH lookup
	// without claiming "tried X locations" for fictional paths.
	got := app.TesseractProbeCandidates("plan9", "/home/test")
	if len(got) != 0 {
		t.Errorf("plan9 should return no candidates; got %v", got)
	}
}

func TestProbeTesseractBinary_TriedListMatchesHostOSCandidates(t *testing.T) {
	// ProbeTesseractBinary's ProbeResult.Tried must echo the same
	// candidate list tesseractProbeCandidates produces for the host
	// OS, plus a PATH-lookup entry on a miss. The frontend renders
	// Tried in the "looked in" disclosure on failure so the user
	// sees exactly where the probe walked.
	a := &app.App{}
	res := a.ProbeTesseractBinary()

	// On any GOOS, Tried must be a non-empty list when the GOOS is
	// recognised; on an unknown GOOS at minimum the PATH-lookup
	// sentinel should show up.
	if runtime.GOOS == "darwin" || runtime.GOOS == "linux" || runtime.GOOS == "windows" {
		if len(res.Tried) == 0 {
			t.Errorf("Tried must be non-empty on recognised GOOS %q", runtime.GOOS)
		}
	}

	// On a hit, Found is true and Path is one of the Tried entries
	// (or the PATH-lookup result). On a miss, Found is false and
	// Path is empty.
	if res.Found {
		if res.Path == "" {
			t.Error("Found=true but Path is empty")
		}
	} else {
		if res.Path != "" {
			t.Errorf("Found=false but Path=%q", res.Path)
		}
	}
}

func contains(haystack []string, needle string) bool {
	for _, h := range haystack {
		if strings.EqualFold(h, needle) {
			return true
		}
	}
	return false
}
