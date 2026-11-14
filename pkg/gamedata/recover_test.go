package gamedata_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/gamedata"
)

// interruptedApply lays down what a crash leaves between the asset renames
// and the manifest commit: the old manifest live, a staged manifest naming
// the new dataset, and the new files — renamed into place, or (for the
// names in stillStaged) still sitting at <name>.tmp.
func interruptedApply(t *testing.T, stillStaged ...string) (baseDir, dataDir string) {
	t.Helper()
	baseDir = t.TempDir()
	dataDir = seedRoster(t, baseDir, []byte("tank:\n  - OldTank\n"))
	writeJSON(t, filepath.Join(dataDir, "manifest.json"), gamedata.DataManifest{AppliedMainCommit: "old"})
	staged := gamedata.DataManifest{AppliedMainCommit: "new", Files: map[string]gamedata.ManifestFile{}}
	stage := map[string]bool{}
	for _, name := range stillStaged {
		stage[name] = true
	}
	for name, body := range mainAssets() {
		sum := sha256.Sum256(body)
		staged.Files[name] = gamedata.ManifestFile{SHA256: hex.EncodeToString(sum[:]), Size: int64(len(body))}
		path := filepath.Join(dataDir, name)
		if stage[name] {
			path += ".tmp"
		}
		if err := os.WriteFile(path, body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	writeJSON(t, filepath.Join(dataDir, "manifest.json.tmp"), staged)
	return baseDir, dataDir
}

func writeJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func appliedCommit(t *testing.T, baseDir string) string {
	t.Helper()
	m, err := gamedata.LoadManifest(baseDir)
	if err != nil {
		t.Fatal(err)
	}
	return m.AppliedMainCommit
}

// The crash window the staging could not close: new data live under the old
// manifest. Every file the staged manifest names is on disk and matches its
// checksum, so the apply is finished on the next start rather than left for
// the UI to re-offer forever.
func TestRecover_RollsForwardAnApplyCutOffBeforeTheManifest(t *testing.T) {
	baseDir, dataDir := interruptedApply(t)

	got, err := gamedata.Recover(baseDir)
	if err != nil {
		t.Fatalf("Recover: %v", err)
	}
	if got != gamedata.RecoveredForward || appliedCommit(t, baseDir) != "new" {
		t.Errorf("Recover = %q, manifest commit = %q; want rolled forward to new", got, appliedCommit(t, baseDir))
	}
	assertNoStagedFiles(t, dataDir)
}

// A crash part-way through the renames leaves some new files still staged;
// they are verified and renamed in before the manifest commits.
func TestRecover_FinishesAPartialRename(t *testing.T) {
	baseDir, dataDir := interruptedApply(t, "seasons.yaml", "patches.yaml")

	if got, err := gamedata.Recover(baseDir); err != nil || got != gamedata.RecoveredForward {
		t.Fatalf("Recover = %q, %v; want rolled forward", got, err)
	}
	assertFileBytes(t, filepath.Join(dataDir, "patches.yaml"), mainAssets()["patches.yaml"])
	assertNoStagedFiles(t, dataDir)
}

// A file that does not match the staged manifest cannot be committed under
// it. The staged files go and the old manifest stays: the dataset reads as
// not applied, and the next apply replaces it whole.
func TestRecover_DiscardsAStagedManifestTheFilesDoNotMatch(t *testing.T) {
	baseDir, dataDir := interruptedApply(t, "maps.yaml")
	if err := os.WriteFile(filepath.Join(dataDir, "maps.yaml.tmp"), []byte("control:\n  - Ilio"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := gamedata.Recover(baseDir)
	if !errors.Is(err, gamedata.ErrDataUpdateIO) || got != gamedata.RecoveredBack {
		t.Fatalf("Recover = %q, %v; want discarded with ErrDataUpdateIO", got, err)
	}
	if appliedCommit(t, baseDir) != "old" {
		t.Errorf("manifest commit = %q, want the old manifest kept", appliedCommit(t, baseDir))
	}
	assertNoStagedFiles(t, dataDir)
}

// A crash while staging renamed nothing: the staged files are dropped and the
// live data is left exactly as it was.
func TestRecover_DropsAnInterruptedStaging(t *testing.T) {
	baseDir := t.TempDir()
	old := []byte("tank:\n  - OldTank\n")
	dataDir := seedRoster(t, baseDir, old)
	if err := os.WriteFile(filepath.Join(dataDir, "maps.yaml.tmp"), []byte("half"), 0o600); err != nil {
		t.Fatal(err)
	}

	if got, err := gamedata.Recover(baseDir); err != nil || got != gamedata.RecoveredBack {
		t.Fatalf("Recover = %q, %v; want the staging dropped", got, err)
	}
	assertFileBytes(t, filepath.Join(dataDir, "heroes.yaml"), old)
	assertNoStagedFiles(t, dataDir)
}

// Nothing to recover is the ordinary start.
func TestRecover_IsANoOpOnACleanDirectory(t *testing.T) {
	baseDir := t.TempDir()
	seedRoster(t, baseDir, []byte("tank: []\n"))
	if got, err := gamedata.Recover(baseDir); err != nil || got != gamedata.RecoveredNothing {
		t.Errorf("Recover = %q, %v; want nothing to do", got, err)
	}
}

// A rollback that could not put the old data back is the caller's to hear
// about: the apply's error says so, rather than the log alone.
func TestApply_AFailedRollbackIsReported(t *testing.T) {
	baseDir := t.TempDir()
	dataDir := seedRoster(t, baseDir, []byte("tank:\n  - OriginalTank\n"))
	serveMainChannel(t, mainAssets())
	if err := os.MkdirAll(filepath.Join(dataDir, "manifest.json"), 0o700); err != nil {
		t.Fatal(err)
	}
	prev := gamedata.WriteFileFunc
	gamedata.WriteFileFunc = func(string, []byte, os.FileMode) error { return errors.New("disk full") }
	t.Cleanup(func() { gamedata.WriteFileFunc = prev })

	_, err := gamedata.Apply(baseDir)
	if !errors.Is(err, gamedata.ErrDataUpdateRollbackFailed) {
		t.Errorf("Apply err = %v, want ErrDataUpdateRollbackFailed alongside the cause", err)
	}
}
