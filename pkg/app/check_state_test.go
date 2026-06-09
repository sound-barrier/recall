package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCheckState_RoundTrip(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	want := time.Date(2026, 6, 8, 14, 32, 11, 0, time.UTC)
	if err := SaveCheckState(CheckState{LastCheckedAt: want}); err != nil {
		t.Fatalf("SaveCheckState: %v", err)
	}

	got, err := LoadCheckState()
	if err != nil {
		t.Fatalf("LoadCheckState: %v", err)
	}
	if !got.LastCheckedAt.Equal(want) {
		t.Errorf("LastCheckedAt: got %v, want %v", got.LastCheckedAt, want)
	}
}

func TestCheckState_MissingFileReturnsZero(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	s, err := LoadCheckState()
	if err != nil {
		t.Fatalf("LoadCheckState: want nil err for missing file, got %v", err)
	}
	if !s.LastCheckedAt.IsZero() {
		t.Errorf("LastCheckedAt: want zero for missing file, got %v", s.LastCheckedAt)
	}
}

func TestCheckState_CorruptFileReturnsZero(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("RECALL_DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "check_state.json"), []byte("@@@not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	s, err := LoadCheckState()
	if err != nil {
		t.Fatalf("LoadCheckState: want nil err for corrupt file, got %v", err)
	}
	if !s.LastCheckedAt.IsZero() {
		t.Errorf("LastCheckedAt: want zero for corrupt file, got %v", s.LastCheckedAt)
	}
}

func TestDataManifest_RoundTrip(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	want := DataManifest{
		AppliedReleaseTag: "1.2.3",
		AppliedAt:         time.Date(2026, 6, 8, 14, 32, 11, 0, time.UTC),
		Files: map[string]ManifestFile{
			"heroes.yaml": {SHA256: "abcd", Size: 1234},
		},
	}
	if err := SaveManifest(want); err != nil {
		t.Fatalf("SaveManifest: %v", err)
	}

	got, err := LoadManifest()
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

	m, err := LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}
	if m.AppliedReleaseTag != "" {
		t.Errorf("AppliedReleaseTag: want empty for missing manifest, got %q", m.AppliedReleaseTag)
	}
}

func TestTouchLastChecked_WritesNow(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	now := time.Date(2026, 6, 8, 14, 0, 0, 0, time.UTC)
	if err := TouchLastChecked(now); err != nil {
		t.Fatalf("TouchLastChecked: %v", err)
	}

	s, _ := LoadCheckState()
	if !s.LastCheckedAt.Equal(now) {
		t.Errorf("LastCheckedAt: got %v, want %v", s.LastCheckedAt, now)
	}
}
