package app_test

import (
	"errors"
	"os"
	"strings"
	"testing"

	"recall/pkg/app"
)

func TestStartupError_NilOnSuccessfulBoot(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	a := app.New()
	a.Startup(t.Context())
	if err := a.StartupError(); err != nil {
		t.Errorf("StartupError = %v, want nil on clean boot", err)
	}
}

func TestCaptureFatal_FirstErrorWins(t *testing.T) {
	a := &app.App{}
	first := errors.New("first")
	second := errors.New("second")
	app.CaptureFatal(a, "stage-a", first)
	app.CaptureFatal(a, "stage-b", second)
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
	a := app.New()
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

func TestGetStartupError_EmptyWhenNoFailure(t *testing.T) {
	a := &app.App{}
	if got := a.GetStartupError(); got != "" {
		t.Errorf("GetStartupError = %q, want empty string when startupErr is nil", got)
	}
}

func TestGetStartupError_ReturnsCapturedMessage(t *testing.T) {
	a := &app.App{}
	app.CaptureFatal(a, "stage-x", errors.New("disk full"))
	got := a.GetStartupError()
	if got == "" {
		t.Fatal("GetStartupError = empty, want non-empty after capture")
	}
	// The wrapper format is `startup: <stage>: <inner>`; assert on
	// both so a future format change is caught here AND a future
	// stage rename is caught here.
	if !strings.Contains(got, "stage-x") || !strings.Contains(got, "disk full") {
		t.Errorf("GetStartupError = %q, want to contain stage + inner error", got)
	}
}
