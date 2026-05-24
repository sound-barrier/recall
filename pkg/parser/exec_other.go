//go:build !windows

package parser

import "os/exec"

// HideWindow is a no-op on non-Windows platforms. The Windows
// implementation (exec_windows.go) suppresses the console-window flash
// that every exec.Command from a GUI process triggers on Windows. On
// macOS and Linux there's no equivalent — the OS doesn't allocate a
// console for child processes spawned from a GUI app.
//
// Exported so pkg/app's checkTesseract can call it on the same shape
// of *exec.Cmd it builds, without duplicating the build-tag dance.
func HideWindow(_ *exec.Cmd) {}
