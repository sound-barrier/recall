package app_test

import "testing"

// mustNoErr fails the test immediately on an unexpected error — the plumbing
// around the behavior under test, not the assertion itself.
//
// It was hosted in seed_test.go until the seed writer was carved out to
// pkg/seed; 22 test files across the package lean on it, so it gets a home of
// its own rather than riding along in whichever file happened to declare it.
func mustNoErr(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
