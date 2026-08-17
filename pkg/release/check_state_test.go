package release_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"recall/pkg/release"
)

// The check-state file, driven directly against a baseDir. Before the
// carve every one of these had to fake an install root through an
// environment variable because the path was resolved inside the package.

func TestCheckState_RoundTrip(t *testing.T) {
	dir := t.TempDir()
	want := time.Date(2026, 6, 8, 14, 32, 11, 0, time.UTC)

	if err := release.SaveCheckState(dir, release.CheckState{LastCheckedAt: want}); err != nil {
		t.Fatalf("SaveCheckState: %v", err)
	}
	got, err := release.LoadCheckState(dir)
	if err != nil {
		t.Fatalf("LoadCheckState: %v", err)
	}

	if !got.LastCheckedAt.Equal(want) {
		t.Errorf("LastCheckedAt: got %v, want %v", got.LastCheckedAt, want)
	}
}

func TestCheckState_MissingFileReturnsZero(t *testing.T) {
	s, err := release.LoadCheckState(t.TempDir())
	if err != nil {
		t.Fatalf("LoadCheckState: want nil err for missing file, got %v", err)
	}
	if !s.LastCheckedAt.IsZero() {
		t.Errorf("LastCheckedAt: want zero for missing file, got %v", s.LastCheckedAt)
	}
}

func TestCheckState_CorruptFileReturnsZero(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "check_state.json"), []byte("@@@not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	s, err := release.LoadCheckState(dir)

	if err != nil {
		t.Fatalf("LoadCheckState: want nil err for corrupt file, got %v", err)
	}
	if !s.LastCheckedAt.IsZero() {
		t.Errorf("LastCheckedAt: want zero for corrupt file, got %v", s.LastCheckedAt)
	}
}

// The one read failure that is NOT swallowed. "Missing" and "corrupt"
// both collapse to the never-checked zero value on purpose, but a file
// that exists and cannot be read is a real fault the caller should hear
// about — and the arm had no test because reaching it meant sabotaging
// the process-wide install root.
func TestCheckState_UnreadableFileIsAnError(t *testing.T) {
	dir := t.TempDir()
	// A directory where the file belongs: os.ReadFile fails with EISDIR,
	// which is emphatically not fs.ErrNotExist.
	if err := os.Mkdir(filepath.Join(dir, "check_state.json"), 0o700); err != nil {
		t.Fatal(err)
	}

	s, err := release.LoadCheckState(dir)

	if err == nil {
		t.Fatal("LoadCheckState: want an error for an unreadable check_state.json, got nil")
	}
	if !s.LastCheckedAt.IsZero() {
		t.Errorf("LastCheckedAt: want zero alongside the error, got %v", s.LastCheckedAt)
	}
}

// SaveCheckState creates the install root when it does not exist yet —
// the first-run path, where nothing has written under baseDir before.
func TestCheckState_SaveCreatesTheBaseDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "never", "created")
	want := time.Date(2026, 6, 8, 14, 32, 11, 0, time.UTC)

	if err := release.SaveCheckState(dir, release.CheckState{LastCheckedAt: want}); err != nil {
		t.Fatalf("SaveCheckState: %v", err)
	}

	got, err := release.LoadCheckState(dir)
	if err != nil {
		t.Fatalf("LoadCheckState: %v", err)
	}
	if !got.LastCheckedAt.Equal(want) {
		t.Errorf("LastCheckedAt: got %v, want %v", got.LastCheckedAt, want)
	}
}

func TestTouchLastChecked_WritesNow(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 6, 8, 14, 0, 0, 0, time.UTC)

	if err := release.TouchLastChecked(dir, now); err != nil {
		t.Fatalf("TouchLastChecked: %v", err)
	}

	s, err := release.LoadCheckState(dir)
	if err != nil {
		t.Fatalf("LoadCheckState: %v", err)
	}
	if !s.LastCheckedAt.Equal(now) {
		t.Errorf("LastCheckedAt: got %v, want %v", s.LastCheckedAt, now)
	}
}

// The stamp is documented as UTC, and every caller so far happened to
// hand it a UTC clock — so the .UTC() conversion was never actually
// exercised. A machine in a positive-offset zone would otherwise persist
// a local wall time that reads as the future once parsed back.
func TestTouchLastChecked_NormalizesToUTC(t *testing.T) {
	dir := t.TempDir()
	aheadOfUTC := time.FixedZone("+0530", int((5*time.Hour + 30*time.Minute).Seconds()))
	local := time.Date(2026, 6, 8, 19, 30, 0, 0, aheadOfUTC)

	if err := release.TouchLastChecked(dir, local); err != nil {
		t.Fatalf("TouchLastChecked: %v", err)
	}

	s, err := release.LoadCheckState(dir)
	if err != nil {
		t.Fatalf("LoadCheckState: %v", err)
	}
	if _, offset := s.LastCheckedAt.Zone(); offset != 0 {
		t.Errorf("zone offset = %d, want 0 — the stamp must persist as UTC", offset)
	}
	if want := time.Date(2026, 6, 8, 14, 0, 0, 0, time.UTC); !s.LastCheckedAt.Equal(want) {
		t.Errorf("LastCheckedAt: got %v, want the same instant as %v", s.LastCheckedAt, want)
	}
}
