package app_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
)

// A payload can carry a perfectly valid checksum sidecar and still be
// malformed YAML — the sidecar only proves the bytes arrived intact.
// Committing such a payload replaces the on-disk files and records the
// version as applied, while the parser silently falls back to embedded
// data with a permanent load-error banner. Validation must reject the
// payload BEFORE anything is written.
func TestApplyGameDataUpdate_MalformedYAML_RejectedBeforeCommit(t *testing.T) {
	heroes := []byte("tank: [unclosed\n") // checksum-valid, YAML-invalid
	maps := []byte("control:\n  - Ilios\n")
	sources := validSourcesYAML()
	applyMainTestSetup(t, "abc1234567890def", heroes, maps, sources)

	if _, err := (&app.App{}).ApplyGameDataUpdate(); err == nil {
		t.Fatal("ApplyGameDataUpdate accepted malformed heroes.yaml, want validation error")
	}

	written := filepath.Join(os.Getenv("RECALL_DATA_DIR"), "data", "heroes.yaml")
	if _, err := os.Stat(written); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("malformed heroes.yaml reached the data dir (%s): stat err = %v", written, err)
	}
}
