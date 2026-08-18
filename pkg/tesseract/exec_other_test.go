//go:build !windows

package tesseract_test

import (
	"os/exec"
	"testing"

	"recall/pkg/tesseract"
)

// HideWindow is a no-op on non-Windows platforms — there's no console-
// window flash to suppress when the parent isn't a Windows GUI process.
// This test pins the no-op contract so a future "let's set something
// here too" temptation gets a failing test instead of silently
// changing behavior.

func TestHideWindow_NoOpOnNonWindows(t *testing.T) {
	cmd := exec.CommandContext(t.Context(), "echo", "hi")
	tesseract.HideWindow(cmd)
	if cmd.SysProcAttr != nil {
		t.Errorf("HideWindow on non-Windows must not touch SysProcAttr; got %#v", cmd.SysProcAttr)
	}
}
