package app_test

import (
	"testing"
	"time"

	"recall/pkg/app"
)

// The install-root half of the check-state and manifest files. Both
// stores live in leaf packages that take a baseDir, and their file
// semantics — missing, corrupt, unreadable — are pinned there. What
// stays here is the resolution: that <RECALL_DATA_DIR> is what the shell
// hands them, install-global rather than per-profile, so a profile switch
// cannot reset the "haven't checked in a while" banner.

func TestCheckState_RoundTripUnderTheInstallRoot(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	want := time.Date(2026, 6, 8, 14, 32, 11, 0, time.UTC)
	if err := app.SaveCheckState(app.CheckState{LastCheckedAt: want}); err != nil {
		t.Fatalf("SaveCheckState: %v", err)
	}

	got, err := app.LoadCheckState()
	if err != nil {
		t.Fatalf("LoadCheckState: %v", err)
	}
	if !got.LastCheckedAt.Equal(want) {
		t.Errorf("LastCheckedAt: got %v, want %v", got.LastCheckedAt, want)
	}
}

func TestDataManifest_RoundTrip(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	want := app.DataManifest{
		AppliedReleaseTag: "1.2.3",
		AppliedAt:         time.Date(2026, 6, 8, 14, 32, 11, 0, time.UTC),
		Files: map[string]app.ManifestFile{
			"heroes.yaml": {SHA256: "abcd", Size: 1234},
		},
	}
	if err := app.SaveManifest(want); err != nil {
		t.Fatalf("SaveManifest: %v", err)
	}

	got, err := app.LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}
	if got.AppliedReleaseTag != want.AppliedReleaseTag {
		t.Errorf("AppliedReleaseTag: got %q, want %q", got.AppliedReleaseTag, want.AppliedReleaseTag)
	}
	if !got.AppliedAt.Equal(want.AppliedAt) {
		t.Errorf("AppliedAt: got %v, want %v", got.AppliedAt, want.AppliedAt)
	}
	if got.Files["heroes.yaml"].SHA256 != "abcd" {
		t.Errorf("Files[heroes.yaml].SHA256: got %q, want abcd", got.Files["heroes.yaml"].SHA256)
	}
}

func TestDataManifest_MissingFileReturnsZero(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	m, err := app.LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}
	if m.AppliedReleaseTag != "" {
		t.Errorf("AppliedReleaseTag: want empty for missing manifest, got %q", m.AppliedReleaseTag)
	}
}

func TestTouchLastChecked_WritesUnderTheInstallRoot(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	now := time.Date(2026, 6, 8, 14, 0, 0, 0, time.UTC)
	if err := app.TouchLastChecked(now); err != nil {
		t.Fatalf("TouchLastChecked: %v", err)
	}

	s, _ := app.LoadCheckState()
	if !s.LastCheckedAt.Equal(now) {
		t.Errorf("LastCheckedAt: got %v, want %v", s.LastCheckedAt, now)
	}
}
