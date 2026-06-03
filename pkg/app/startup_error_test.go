package app

import (
	"errors"
	"os"
	"testing"
)

func TestStartupError_NilOnSuccessfulBoot(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := New()
	a.Startup(t.Context())
	if err := a.StartupError(); err != nil {
		t.Errorf("StartupError = %v, want nil on clean boot", err)
	}
}

func TestCaptureFatal_FirstErrorWins(t *testing.T) {
	a := &App{}
	first := errors.New("first")
	second := errors.New("second")
	a.captureFatal("stage-a", first)
	a.captureFatal("stage-b", second)
	got := a.StartupError()
	if got == nil {
		t.Fatal("StartupError = nil, want first error captured")
	}
	if !errors.Is(got, first) {
		t.Errorf("StartupError = %v, want wraps %v", got, first)
	}
}

func TestStartupError_BadProfilesDirCaptured(t *testing.T) {
	// Point HOME at a path the user can't create files in — the
	// macOS-stable trick is to point it at a single regular file
	// so LoadProfiles' mkdir + open both fail.
	tmp := t.TempDir()
	// Replace the dir with a regular file at the target path.
	if err := mkRegularFile(tmp + "/blocker"); err != nil {
		t.Fatalf("setup: %v", err)
	}
	t.Setenv("HOME", tmp+"/blocker")
	t.Setenv("XDG_CONFIG_HOME", tmp+"/blocker")
	t.Setenv("RECALL_DATA_DIR", tmp+"/blocker")
	a := New()
	a.Startup(t.Context())
	// Startup returned without panicking — the previous log.Fatal
	// implementation would have killed the test process here.
	if err := a.StartupError(); err == nil {
		t.Error("StartupError = nil, want non-nil after blocked HOME")
	}
}

func mkRegularFile(path string) error {
	return os.WriteFile(path, []byte{}, 0o600)
}
