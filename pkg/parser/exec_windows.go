//go:build windows

package parser

import (
	"os/exec"
	"syscall"
)

// createNoWindow is the CreateProcess CreationFlag that tells Windows
// NOT to allocate a console window for the child. The Go stdlib's
// syscall package exposes CREATE_NEW_CONSOLE and a few others but not
// this one, so we use the literal from WinBase.h. golang.org/x/sys/
// windows defines the same constant — using the literal avoids
// pulling that dep in just for a single flag.
const createNoWindow = 0x08000000

// HideWindow configures cmd to run without flashing a console window.
// Without this, every exec.Command from a GUI process (the Wails
// desktop binary, or anything launched without an attached console)
// pops a brief cmd.exe window — jarring during a normal parse run
// that fires Tesseract once per screenshot.
//
// CREATE_NO_WINDOW tells the OS not to create a console for the child
// in the first place. HideWindow=true is set alongside as a belt-and-
// suspenders for any tooling that inspects the STARTUPINFO show-window
// field; CREATE_NO_WINDOW is the load-bearing flag.
//
// Exported so pkg/app's checkTesseract can call it on the same shape
// of *exec.Cmd without duplicating the build-tag dance.
func HideWindow(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
