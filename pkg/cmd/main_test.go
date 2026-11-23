package cmd_test

import (
	"os"
	"testing"

	"recall/pkg/app/apptest"
)

// TestMain keeps every test in this package out of real app data: the data-dir
// resolver panics in a test binary pointed anywhere but the OS temp dir.
func TestMain(m *testing.M) { os.Exit(apptest.Run(m)) }
