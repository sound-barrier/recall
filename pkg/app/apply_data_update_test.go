package app

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/parser"
)

// withRenameFunc swaps renameFunc for a deterministic test wrapper
// and restores the prior func on cleanup.
func withRenameFunc(t *testing.T, fn func(oldpath, newpath string) error) {
	t.Helper()
	prev := renameFunc
	renameFunc = fn
	t.Cleanup(func() { renameFunc = prev })
}

// applyTestSetup wires up the GitHub release server + asset server +
// env vars + tag-confirm hook a single ApplyDataUpdate test needs.
// Returns the asset server URL so caller-side overrides can layer on.
//
// Registers a cleanup that re-Reloads the parser back to embedded
// after t.Setenv has cleared RECALL_DATA_DIR — without this, the
// minimal heroes/maps the test writes into the temp dir would leak
// into other tests in the package as the global atomic-pointer
// dataset.
func applyTestSetup(t *testing.T, tag string, heroes, maps, sources []byte) string {
	t.Helper()
	// Register the parser.Reload cleanup BEFORE t.Setenv so its
	// LIFO firing puts the Reload AFTER the env restore — by which
	// point RECALL_DATA_DIR points back at the pre-test value and
	// Reload finds no override files → embedded fallback.
	t.Cleanup(func() { _ = parser.Reload() })
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	releaseSrv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v`+tag+`","html_url":"https://example/v`+tag+`"}`)
	withReleasesURL(t, releaseSrv.URL)

	assetSrv := fakeAssetServer(t, heroes, maps, sources)
	withReleaseAssetURL(t, func(_, name string) string { return assetSrv.URL + "/" + name })

	return assetSrv.URL
}

func TestApplyDataUpdate_HappyPath_WritesFilesAndManifest(t *testing.T) {
	heroes := []byte("tank:\n  - Reinhardt\nsupport: []\ndps:\n  - Phoenix\n")
	maps := []byte("control:\n  - Ilios\n  - NewMap\n")
	sources := validSourcesYAML()
	applyTestSetup(t, "1.2.3", heroes, maps, sources)

	got, err := (&App{}).ApplyDataUpdate("1.2.3")
	if err != nil {
		t.Fatalf("ApplyDataUpdate: %v", err)
	}
	if got.AppliedTag != "1.2.3" {
		t.Errorf("AppliedTag: got %q, want 1.2.3", got.AppliedTag)
	}

	// Files written to <RECALL_DATA_DIR>/data/.
	dataDir := filepath.Join(appBaseDir(), "data")
	for _, name := range []string{"heroes.yaml", "maps.yaml", "screenshot_sources.yaml"} {
		if _, err := os.Stat(filepath.Join(dataDir, name)); err != nil {
			t.Errorf("expected %s to exist after apply: %v", name, err)
		}
	}

	// Manifest reflects the applied tag.
	m, err := LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}
	if m.AppliedReleaseTag != "1.2.3" {
		t.Errorf("manifest.AppliedReleaseTag: got %q, want 1.2.3", m.AppliedReleaseTag)
	}

	// Parser swapped — Phoenix is now a recognised DPS.
	if got := parser.HeroRole("Phoenix"); got != "dps" {
		t.Errorf("after apply, parser.HeroRole(Phoenix) = %q, want dps", got)
	}
}

func TestApplyDataUpdate_TagMismatchSentinel(t *testing.T) {
	_, err := (&App{}).ApplyDataUpdate("")
	if !errors.Is(err, ErrDataUpdateTagMismatch) {
		t.Errorf("got %v, want ErrDataUpdateTagMismatch", err)
	}
}

func TestApplyDataUpdate_SHAMismatchRejects_NoFilesWritten(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	releaseSrv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v1.2.3","html_url":"https://example/v1.2.3"}`)
	withReleasesURL(t, releaseSrv.URL)

	// Asset server that returns a wrong-hash sidecar — verifySha256
	// rejects.
	mux := http.NewServeMux()
	heroes := []byte("tank:\n  - Reinhardt\n")
	for _, name := range []string{"heroes.yaml", "maps.yaml", "screenshot_sources.yaml"} {
		nameCopy := name
		mux.HandleFunc("/"+nameCopy, func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write(heroes)
		})
		mux.HandleFunc("/"+nameCopy+".sha256", func(w http.ResponseWriter, _ *http.Request) {
			// 64 zeros — guaranteed mismatch
			_, _ = w.Write([]byte("0000000000000000000000000000000000000000000000000000000000000000  file\n"))
		})
	}
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	withReleaseAssetURL(t, func(_, name string) string { return srv.URL + "/" + name })

	_, err := (&App{}).ApplyDataUpdate("1.2.3")
	if !errors.Is(err, ErrDataUpdateChecksum) {
		t.Fatalf("got %v, want ErrDataUpdateChecksum", err)
	}

	// No files written to <RECALL_DATA_DIR>/data/.
	dataDir := filepath.Join(appBaseDir(), "data")
	for _, name := range []string{"heroes.yaml", "maps.yaml", "screenshot_sources.yaml"} {
		if _, err := os.Stat(filepath.Join(dataDir, name)); err == nil {
			t.Errorf("expected %s NOT to exist after SHA-mismatch failure", name)
		}
	}
}

func TestApplyDataUpdate_ReleaseRaceReturnsConflict(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	// FE passes tag 1.2.3 but GitHub now reports 1.2.4 — release
	// moved between check and apply.
	releaseSrv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v1.2.4","html_url":"https://example/v1.2.4"}`)
	withReleasesURL(t, releaseSrv.URL)

	_, err := (&App{}).ApplyDataUpdate("1.2.3")
	if !errors.Is(err, ErrDataUpdateReleaseMoved) {
		t.Fatalf("got %v, want ErrDataUpdateReleaseMoved", err)
	}
}

func TestApplyDataUpdate_PartialRenameFailure_RestoresOriginal(t *testing.T) {
	baseDir := t.TempDir()
	t.Setenv("RECALL_DATA_DIR", baseDir)
	dataDir := filepath.Join(baseDir, "data")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		t.Fatal(err)
	}
	// Pre-existing heroes.yaml the apply will try to replace —
	// rollback must restore this exact content.
	original := []byte("tank:\n  - OriginalTank\n")
	if err := os.WriteFile(filepath.Join(dataDir, "heroes.yaml"), original, 0o600); err != nil {
		t.Fatal(err)
	}

	releaseSrv := fakeReleasesServer(t, http.StatusOK,
		`{"tag_name":"v1.2.3","html_url":"https://example/v1.2.3"}`)
	withReleasesURL(t, releaseSrv.URL)

	heroes := []byte("tank:\n  - Reinhardt\n")
	maps := []byte("control:\n  - Ilios\n")
	sources := validSourcesYAML()
	assetSrv := fakeAssetServer(t, heroes, maps, sources)
	withReleaseAssetURL(t, func(_, name string) string { return assetSrv.URL + "/" + name })

	// Force the second rename to fail — heroes.yaml gets renamed in
	// (good), then maps.yaml.tmp → maps.yaml fails. Rollback must
	// restore heroes.yaml from snapshot AND remove leftover .tmp.
	callCount := 0
	withRenameFunc(t, func(oldpath, newpath string) error {
		callCount++
		if callCount == 2 {
			return errors.New("simulated rename failure")
		}
		return os.Rename(oldpath, newpath)
	})

	_, err := (&App{}).ApplyDataUpdate("1.2.3")
	if !errors.Is(err, ErrDataUpdateIO) {
		t.Fatalf("got %v, want ErrDataUpdateIO", err)
	}

	// heroes.yaml must be restored to the pre-apply content.
	got, err := os.ReadFile(filepath.Join(dataDir, "heroes.yaml"))
	if err != nil {
		t.Fatalf("read heroes.yaml after rollback: %v", err)
	}
	if string(got) != string(original) {
		t.Errorf("heroes.yaml after rollback:\ngot:  %q\nwant: %q", got, original)
	}

	// Leftover .tmp files cleared.
	for _, name := range []string{"heroes.yaml.tmp", "maps.yaml.tmp", "screenshot_sources.yaml.tmp"} {
		if _, err := os.Stat(filepath.Join(dataDir, name)); err == nil {
			t.Errorf("expected %s removed after rollback, but it exists", name)
		}
	}

	// Manifest must NOT reflect a failed apply.
	m, _ := LoadManifest()
	if m.AppliedReleaseTag == "1.2.3" {
		t.Errorf("manifest written despite failure: AppliedReleaseTag=%q", m.AppliedReleaseTag)
	}
}
