package app_test

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/app"
)

// baseDirPanic resolves app.BaseDir() and returns the panic it raised as text,
// or "" when it returned normally.
func baseDirPanic() (msg string) {
	defer func() {
		if r := recover(); r != nil {
			msg = fmt.Sprint(r)
		}
	}()
	_ = app.BaseDir()
	return ""
}

func assertBaseDirRefused(t *testing.T, dataDir string) {
	t.Helper()
	t.Setenv("RECALL_DATA_DIR", dataDir)
	msg := baseDirPanic()
	if msg == "" {
		t.Fatalf("app.BaseDir() with RECALL_DATA_DIR=%q returned normally; a test binary must refuse a dir outside the OS temp dir", dataDir)
	}
	if !strings.Contains(msg, "apptest.Run") {
		t.Errorf("panic must name the fix (apptest.Run in TestMain); got %q", msg)
	}
}

func TestBaseDir_RefusesDirOutsideTempInTestBinary(t *testing.T) {
	assertBaseDirRefused(t, filepath.Join(string(filepath.Separator), "recall-not-a-temp-dir"))
}

// A sibling that merely shares the temp dir's name as a string prefix
// (".../T-not-temp" beside ".../T") is outside it.
func TestBaseDir_RefusesTempDirNamePrefixSibling(t *testing.T) {
	tempRoot := filepath.Clean(os.TempDir())
	assertBaseDirRefused(t, tempRoot+"-not-temp")
}

func TestBaseDir_AcceptsDirUnderTemp(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("RECALL_DATA_DIR", dir)
	if got := app.BaseDir(); got != dir {
		t.Errorf("app.BaseDir() = %q, want %q", got, dir)
	}
}

// The data dir is often created by the first write, so a not-yet-existing
// path under the temp dir must resolve without a panic.
func TestBaseDir_AcceptsNotYetCreatedDirUnderTemp(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "not", "created", "yet")
	t.Setenv("RECALL_DATA_DIR", dir)
	if got := app.BaseDir(); got != dir {
		t.Errorf("app.BaseDir() = %q, want %q", got, dir)
	}
}

// macOS hands out the temp dir as /var/... while /var is a symlink to
// /private/var, so the same dir also appears in its resolved form.
func TestBaseDir_AcceptsSymlinkResolvedTempDir(t *testing.T) {
	resolved, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatalf("EvalSymlinks: %v", err)
	}
	t.Setenv("RECALL_DATA_DIR", resolved)
	if got := app.BaseDir(); got != resolved {
		t.Errorf("app.BaseDir() = %q, want %q", got, resolved)
	}
}
