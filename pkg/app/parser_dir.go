package app

import (
	"path/filepath"

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
func init() {
	parser.SetDataDirFunc(func() string {
		return filepath.Join(appBaseDir(), "data")
	})
	_ = parser.Reload()
}
