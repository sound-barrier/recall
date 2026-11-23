// Package apptest keeps a test binary out of the developer's real Recall data.
//
// Every package whose tests reach pkg/app's data-dir resolver (directly or
// through app.BaseDir) wires it from TestMain:
//
//	func TestMain(m *testing.M) { os.Exit(apptest.Run(m)) }
//
// The resolver panics in a test binary whose data dir is outside the OS temp
// dir, so a package that needs this and lacks it fails loudly rather than
// writing to ~/Library/Application Support/Recall or the mise dev database.
package apptest

import (
	"fmt"
	"os"
)

// dataDirEnv is pkg/app's install-root override. Spelled here rather than
// imported so this package stays a leaf; if the name ever drifts, the
// resolver's guard panics instead of letting a test reach real data.
const dataDirEnv = "RECALL_DATA_DIR"

// runner is the slice of *testing.M that Run drives.
type runner interface{ Run() int }

// Run points RECALL_DATA_DIR at a fresh temp dir — overriding any value the
// shell exported, which under mise is the repo's dev database — runs the
// tests, removes the dir, and returns the exit code for os.Exit.
func Run(m runner) int {
	dir, err := os.MkdirTemp("", "recall-test-data-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "apptest: create isolated data dir: %v\n", err)
		return 1
	}
	if err := os.Setenv(dataDirEnv, dir); err != nil {
		fmt.Fprintf(os.Stderr, "apptest: set %s: %v\n", dataDirEnv, err)
		return 1
	}
	code := m.Run()
	if err := os.RemoveAll(dir); err != nil {
		fmt.Fprintf(os.Stderr, "apptest: remove isolated data dir %s: %v\n", dir, err)
	}
	return code
}
