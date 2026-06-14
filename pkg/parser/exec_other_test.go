//go:build !windows

package parser_test

import (
	"os/exec"
	"testing"

	"recall/pkg/parser"
)

// HideWindow is a no-op on non-Windows platforms — there's no console-
// window flash to suppress when the parent isn't a Windows GUI process.
// This test pins the no-op contract so a future "let's set something
// here too" temptation gets a failing test instead of silently
// changing behavior.

func TestHideWindow_NoOpOnNonWindows(t *testing.T) {
	cmd := exec.Command("echo", "hi")
	parser.HideWindow(cmd)
	if cmd.SysProcAttr != nil {
		t.Errorf("HideWindow on non-Windows must not touch SysProcAttr; got %#v", cmd.SysProcAttr)
	}
}
