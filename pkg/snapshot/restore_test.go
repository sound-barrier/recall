package snapshot_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/snapshot"
)

// The whole point of staging is that validation happens before anything
// destructive: a rejected payload must leave no file behind for the caller to
// clean up, because on the reject path the caller never learns a name.
func TestStageRestore_RejectsGarbageAndCleansUpAfterItself(t *testing.T) {
	dir := t.TempDir()

	staged, err := snapshot.StageRestore([]byte("this is not a sqlite database"), dir)

	if !errors.Is(err, snapshot.ErrRestoreInvalid) {
		t.Fatalf("err = %v, want ErrRestoreInvalid", err)
	}
	if staged != "" {
		t.Errorf("a rejected payload returned path %q, want the empty string", staged)
	}
	leftovers, globErr := filepath.Glob(filepath.Join(dir, "recall-restore-*.db"))
	if globErr != nil {
		t.Fatal(globErr)
	}
	if len(leftovers) != 0 {
		t.Errorf("the rejected candidate was left on disk: %v", leftovers)
	}
}

// A SQLite file that is not a RECALL database is still a rejection — the
// validator checks the schema, not just the header.
func TestStageRestore_RejectsAForeignSQLiteFile(t *testing.T) {
	dir := t.TempDir()
	recall := newRecallDB(t)
	valid, err := os.ReadFile(recall)
	if err != nil {
		t.Fatal(err)
	}
	// Keep the SQLite header, corrupt the pages behind it.
	foreign := append([]byte{}, valid[:100]...)
	foreign = append(foreign, make([]byte, len(valid)-100)...)

	if _, err := snapshot.StageRestore(foreign, dir); !errors.Is(err, snapshot.ErrRestoreInvalid) {
		t.Fatalf("err = %v, want ErrRestoreInvalid", err)
	}
}

// The accepted candidate lands in the directory the caller named, because the
// caller's next move is an atomic rename and that only works on one filesystem.
func TestStageRestore_KeepsAValidSnapshotBesideTheLiveDatabase(t *testing.T) {
	dir := t.TempDir()
	payload, err := os.ReadFile(newRecallDB(t))
	if err != nil {
		t.Fatal(err)
	}

	staged, err := snapshot.StageRestore(payload, dir)
	if err != nil {
		t.Fatalf("StageRestore: %v", err)
	}
	if filepath.Dir(staged) != dir {
		t.Errorf("staged at %q, want it inside %q so the rename is atomic", staged, dir)
	}
	if _, err := os.Stat(staged); err != nil {
		t.Errorf("the accepted candidate must survive for the caller to rename: %v", err)
	}
}

func TestStageRestore_ReportsAnUnusableStagingDirectory(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-dir")

	if _, err := snapshot.StageRestore([]byte("payload"), missing); err == nil {
		t.Fatal("StageRestore must fail when it cannot create its temp file")
	}
}
