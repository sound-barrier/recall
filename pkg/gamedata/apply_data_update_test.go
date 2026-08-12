package gamedata_test

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/gamedata"
)

// mainAssets returns a minimal-but-valid payload for every file an apply
// writes. Each one parses under parser.ValidateDataYAML, which the apply
// runs before it touches disk.
func mainAssets() map[string][]byte {
	return map[string][]byte{
		"heroes.yaml": []byte("tank:\n  - Reinhardt\ndps:\n  - Phoenix\nsupport: []\n"),
		"maps.yaml":   []byte("control:\n  - Ilios\n"),
		"screenshot_sources.yaml": []byte(`sources:
  - name: snip
    prefix: "Screenshot "
    regex: '^Screenshot (\d{4})-(\d{2})-(\d{2}) (\d{2})(\d{2})(\d{2})\.png$'
    year_offset: 0
    example: "Screenshot 2026-06-07 224855.png"
`),
		"seasons.yaml": []byte(`seasons:
  - name: "Reign of Talon — Season 1"
    chapter: "Reign of Talon"
    number: 1
    start: "2026-02-10T19:00:00Z"
    end: "2026-04-14T19:00:00Z"
`),
		// A deliberately SHORT ladder: these tests exercise Apply's fetch and
		// rollback, not the real tier list, and a literal here keeps them
		// independent of pkg/parser's embedded data.
		"ranks.yaml": []byte("ranks:\n  - bronze\n  - silver\n"),
	}
}

// serveMainChannel points the package's main-channel URL seams at an
// httptest server publishing each asset plus its sha256 sidecar, so Apply
// runs its real fetch + verify path against local bytes.
// mainChannelCommit is the commit every apply test serves; the value is
// arbitrary, it just has to be a stable 16-hex-char sha.
const mainChannelCommit = "abc1234567890def"

func serveMainChannel(t *testing.T, assets map[string][]byte) {
	t.Helper()
	commit := mainChannelCommit
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/version.json", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, `{"commit_sha":%q,"committed_at":"2026-08-01T00:00:00Z"}`, commit)
	})
	for name, body := range assets {
		sum := sha256.Sum256(body)
		sidecar := hex.EncodeToString(sum[:]) + "  " + name + "\n"
		mux.HandleFunc("/"+name, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) })
		mux.HandleFunc("/"+name+".sha256", func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, sidecar) })
	}
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	prevAsset, prevVersion := gamedata.MainAssetURL, gamedata.MainVersionURL
	gamedata.MainAssetURL = func(name string) string { return srv.URL + "/" + name }
	gamedata.MainVersionURL = srv.URL + "/version.json"
	t.Cleanup(func() { gamedata.MainAssetURL, gamedata.MainVersionURL = prevAsset, prevVersion })
}

// seedRoster lays down a pre-apply data dir holding one roster file the apply
// will try to replace, and returns the data dir.
func seedRoster(t *testing.T, baseDir string, heroes []byte) string {
	t.Helper()
	dataDir := filepath.Join(baseDir, "data")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		t.Fatalf("seed data dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "heroes.yaml"), heroes, 0o600); err != nil {
		t.Fatalf("seed heroes.yaml: %v", err)
	}
	return dataDir
}

// withReadFileFunc swaps the pre-apply snapshot's read seam, restoring the
// production reader when the test ends.
func withReadFileFunc(t *testing.T, fn func(string) ([]byte, error)) {
	t.Helper()
	prev := gamedata.ReadFileFunc
	gamedata.ReadFileFunc = fn
	t.Cleanup(func() { gamedata.ReadFileFunc = prev })
}

// assertFileBytes fails when path does not hold want.
func assertFileBytes(t *testing.T, path string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", filepath.Base(path), err)
	}
	if string(got) != string(want) {
		t.Errorf("%s =\n%q\nwant\n%q", filepath.Base(path), got, want)
	}
}

// assertNoStagedFiles fails when a .tmp file survived the apply.
func assertNoStagedFiles(t *testing.T, dataDir string) {
	t.Helper()
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		t.Fatalf("read data dir: %v", err)
	}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".tmp") {
			t.Errorf("staged file %s survived the apply", e.Name())
		}
	}
}

// A roster file that exists but cannot be read must abort the apply before
// anything is written: the snapshot is the only promise of a rollback, and a
// file that could not be snapshotted has no restorable copy. Recording the
// read error as a nil entry made restoreSnapshot — which reads nil as "this
// file was absent, remove it" — delete the user's live roster YAML on the
// next rollback.
func TestApply_UnreadableRosterFile_AbortsWithoutTouchingDisk(t *testing.T) {
	baseDir := t.TempDir()
	original := []byte("tank:\n  - OriginalTank\n")
	dataDir := seedRoster(t, baseDir, original)
	serveMainChannel(t, mainAssets())

	withReadFileFunc(t, func(path string) ([]byte, error) {
		if filepath.Base(path) == "heroes.yaml" {
			return nil, fmt.Errorf("read %s: %w", path, errors.New("simulated I/O error"))
		}
		return os.ReadFile(path)
	})

	if _, err := gamedata.Apply(baseDir); !errors.Is(err, gamedata.ErrDataUpdateIO) {
		t.Fatalf("Apply err = %v, want ErrDataUpdateIO: a file that cannot be snapshotted cannot be rolled back, so the apply must abort before writing", err)
	}
	assertFileBytes(t, filepath.Join(dataDir, "heroes.yaml"), original)
	assertNoStagedFiles(t, dataDir)
}

// The STAGING arm: the manifest cannot even be written to its .tmp path, so
// the apply aborts before any asset is renamed.
func TestApply_UnstageableManifest_LeavesRosterUncommitted(t *testing.T) {
	baseDir := t.TempDir()
	original := []byte("tank:\n  - OriginalTank\n")
	dataDir := seedRoster(t, baseDir, original)
	serveMainChannel(t, mainAssets())
	blockManifestWrites(t, dataDir)

	if _, err := gamedata.Apply(baseDir); !errors.Is(err, gamedata.ErrDataUpdateIO) {
		t.Fatalf("Apply err = %v, want ErrDataUpdateIO", err)
	}
	assertFileBytes(t, filepath.Join(dataDir, "heroes.yaml"), original)
	assertNoStagedFiles(t, dataDir)
}

// The COMMIT arm, which is the one the "manifest is the commit point" claim
// actually rests on: staging succeeds, the four rosters are renamed into
// place, and only then does the manifest rename fail. The assets must go back.
// Without the rollback on that arm the apply returns an error while the NEW
// dataset is live under the OLD manifest — computeGameDataStatus then reports
// "not applied" forever and the UI re-offers an update the user already has.
//
// Only <data>/manifest.json is blocked here, so the .tmp write succeeds and
// the failure lands on the rename. Blocking both paths (the staging test
// above) never reaches this arm at all.
func TestApply_UncommittableManifest_RollsTheRosterBack(t *testing.T) {
	baseDir := t.TempDir()
	original := []byte("tank:\n  - OriginalTank\n")
	dataDir := seedRoster(t, baseDir, original)
	serveMainChannel(t, mainAssets())
	if err := os.MkdirAll(filepath.Join(dataDir, "manifest.json"), 0o700); err != nil {
		t.Fatalf("block manifest.json: %v", err)
	}

	if _, err := gamedata.Apply(baseDir); !errors.Is(err, gamedata.ErrDataUpdateIO) {
		t.Fatalf("Apply err = %v, want ErrDataUpdateIO", err)
	}
	assertFileBytes(t, filepath.Join(dataDir, "heroes.yaml"), original)
	assertNoStagedFiles(t, dataDir)
}

// blockManifestWrites makes every write of the manifest fail: a directory sits
// at the manifest path and at its staging path, so the write hits EISDIR
// whichever of the two the apply reaches for.
func blockManifestWrites(t *testing.T, dataDir string) {
	t.Helper()
	for _, name := range []string{"manifest.json", "manifest.json.tmp"} {
		if err := os.MkdirAll(filepath.Join(dataDir, name), 0o700); err != nil {
			t.Fatalf("block %s: %v", name, err)
		}
	}
}

// A first-ever apply finds no data directory at all, so every snapshot read is
// ENOENT — which must read as "absent before, remove on rollback", not as the
// unreadable-file abort above. This is the arm that keeps fresh installs
// working, and it pins that a successful apply still records the manifest.
func TestApply_FreshInstall_WritesEveryAssetAndManifest(t *testing.T) {
	baseDir := t.TempDir()
	assets := mainAssets()
	serveMainChannel(t, assets)

	got, err := gamedata.Apply(baseDir)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if got.AppliedCommit != "abc1234" {
		t.Errorf("AppliedCommit = %q, want abc1234", got.AppliedCommit)
	}
	for name, want := range assets {
		assertFileBytes(t, filepath.Join(baseDir, "data", name), want)
	}
	m, err := gamedata.LoadManifest(baseDir)
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}
	if m.AppliedSource != "main" || m.AppliedMainCommit != "abc1234" {
		t.Errorf("manifest = {source %q, commit %q}, want {main, abc1234}", m.AppliedSource, m.AppliedMainCommit)
	}
}
