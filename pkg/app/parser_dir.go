package app

import (
	"path/filepath"
	"testing"

	"recall/pkg/applog"
	"recall/pkg/parser"
)

// init wires the parser's user-override data directory to
// <BaseDir>/data and triggers a Reload so files an Apply Update
// dropped on the previous launch are loaded at startup.
//
// The function passed to parser.SetDataDirFunc re-reads BaseDir()
// every call so tests that swap RECALL_DATA_DIR mid-process (e.g.
// `t.Setenv("RECALL_DATA_DIR", t.TempDir())`) still resolve to the
// right place across Reload boundaries.
//
// A test binary skips the initial Reload: package init runs before any
// TestMain can point RECALL_DATA_DIR at a temp dir, so it would read the
// developer's real override files (and trip appBaseDir's test guard). Tests
// that exercise overrides call Reload themselves.
func init() {
	parser.SetDataDirFunc(func() string {
		return filepath.Join(appBaseDir(), "data")
	})
	if testing.Testing() {
		return
	}
	if err := parser.Reload(); err != nil {
		applog.Subsystem("parser").Warn("initial roster reload failed; using embedded data", "err", err)
	}
}
