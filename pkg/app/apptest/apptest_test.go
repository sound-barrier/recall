package apptest_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/app/apptest"
)

type runnerFunc func() int

func (f runnerFunc) Run() int { return f() }

// under reports whether path sits inside root once both are symlink-resolved.
func under(t *testing.T, path, root string) bool {
	t.Helper()
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("EvalSymlinks(%q): %v", path, err)
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatalf("EvalSymlinks(%q): %v", root, err)
	}
	rel, err := filepath.Rel(resolvedRoot, resolvedPath)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// mise exports RECALL_DATA_DIR=<repo>/data, so a pre-set value is the normal
// case on a developer machine and must be overridden, never honored.
func TestRun_PointsDataDirAtFreshTempDirEvenWhenPreset(t *testing.T) {
	preset := filepath.Join(string(filepath.Separator), "recall-real-data")
	t.Setenv("RECALL_DATA_DIR", preset)

	var during string
	code := apptest.Run(runnerFunc(func() int {
		during = os.Getenv("RECALL_DATA_DIR")
		if during == preset {
			return 0
		}
		if !under(t, during, os.TempDir()) {
			t.Errorf("RECALL_DATA_DIR during the run = %q, want a dir under %q", during, os.TempDir())
		}
		return 7
	}))

	if during == preset {
		t.Fatalf("RECALL_DATA_DIR stayed at the pre-set %q during the run", preset)
	}
	if code != 7 {
		t.Errorf("Run returned %d, want the runner's exit code 7", code)
	}
	if _, err := os.Stat(during); !os.IsNotExist(err) {
		t.Errorf("data dir %q must be removed after the run; stat err = %v", during, err)
	}
}
