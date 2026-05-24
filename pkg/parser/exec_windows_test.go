//go:build windows

package parser

import (
	"os/exec"
	"syscall"
	"testing"
)

// HideWindow must configure the child process so Windows doesn't
// flash a cmd.exe console window. CREATE_NO_WINDOW (0x08000000) is
// the right flag here: it tells the OS not to create a console at all
// (vs HideWindow alone, which creates one and hides it — can still
// flicker on slow boxes). HideWindow=true is set as belt-and-
// suspenders so the STARTUPINFO ShowWindow field reads SW_HIDE in
// case any tooling inspects it.

const expectedCreateNoWindow uint32 = 0x08000000

func TestHideWindow_SetsCreateNoWindowFlag(t *testing.T) {
	cmd := exec.Command("dummy")
	HideWindow(cmd)
	if cmd.SysProcAttr == nil {
		t.Fatal("SysProcAttr should be set after HideWindow")
	}
	if cmd.SysProcAttr.CreationFlags&expectedCreateNoWindow == 0 {
		t.Errorf("CREATE_NO_WINDOW flag should be set; got CreationFlags=%#x", cmd.SysProcAttr.CreationFlags)
	}
	if !cmd.SysProcAttr.HideWindow {
		t.Error("HideWindow field should be true (belt + suspenders for STARTUPINFO)")
	}
}

func TestHideWindow_PreservesExistingSysProcAttrFields(t *testing.T) {
	cmd := exec.Command("dummy")
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000010} // sentinel value
	HideWindow(cmd)
	if cmd.SysProcAttr.CreationFlags&0x00000010 == 0 {
		t.Error("HideWindow must OR into existing CreationFlags, not overwrite them")
	}
	if cmd.SysProcAttr.CreationFlags&expectedCreateNoWindow == 0 {
		t.Error("HideWindow should still add CREATE_NO_WINDOW")
	}
}
