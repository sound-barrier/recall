package app_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"recall/pkg/app"
	"recall/pkg/parser"
)

// withRenameFunc swaps *app.RenameFunc for a deterministic test wrapper
// and restores the prior func on cleanup.
func withRenameFunc(t *testing.T, fn func(oldpath, newpath string) error) {
	t.Helper()
	prev := *app.RenameFunc
	*app.RenameFunc = fn
	t.Cleanup(func() { *app.RenameFunc = prev })
}

// applyMainTestSetup wires up the Pages-published main channel
// (version.json + the three asset URLs + their .sha256 sidecars) and
// the RECALL_DATA_DIR env override that ApplyGameDataUpdate writes
// into. Returns the main-channel base URL so caller-side overrides
// can layer on.
//
// Registers a cleanup that re-Reloads the parser back to embedded
// after t.Setenv has cleared RECALL_DATA_DIR — without this, the
// minimal heroes/maps the test writes into the temp dir would leak
// into other tests in the package as the global atomic-pointer
// dataset.
func applyMainTestSetup(t *testing.T, commit string, heroes, maps, sources []byte) string {
	t.Helper()
	// Register the parser.Reload cleanup BEFORE t.Setenv so its LIFO
	// firing puts the Reload AFTER the env restore — by which point
	// RECALL_DATA_DIR points back at the pre-test value and Reload
	// finds no override files → embedded fallback.
	t.Cleanup(func() { _ = parser.Reload() })
	t.Setenv("RECALL_DATA_DIR", t.TempDir())

	srv := fakeMainServer(t, commit, heroes, maps, sources)
	withMainURLs(t, srv.URL)
	return srv.URL
}

func TestApplyGameDataUpdate_HappyPath_WritesFilesAndManifest(t *testing.T) {
	heroes := []byte("tank:\n  - Reinhardt\nsupport: []\ndps:\n  - Phoenix\n")
	maps := []byte("control:\n  - Ilios\n")
	sources := validSourcesYAML()
	applyMainTestSetup(t, "abc1234567890def", heroes, maps, sources)

	got, err := (&app.App{}).ApplyGameDataUpdate()
	if err != nil {
		t.Fatalf("ApplyGameDataUpdate: %v", err)
	}
	if got.AppliedCommit != "abc1234" {
		t.Errorf("AppliedCommit: want 'abc1234', got %q", got.AppliedCommit)
	}

	// Files written to <RECALL_DATA_DIR>/data/.
	dataDir := filepath.Join(app.AppBaseDir(), "data")
	for _, name := range []string{"heroes.yaml", "maps.yaml", "screenshot_sources.yaml"} {
		if _, err := os.Stat(filepath.Join(dataDir, name)); err != nil {
			t.Errorf("expected %s to exist after apply: %v", name, err)
		}
	}

	// Manifest reflects main source + commit.
	m, err := app.LoadManifest()
	if err != nil {
		t.Fatalf("LoadManifest: %v", err)
	}
	if m.AppliedSource != "main" {
		t.Errorf("manifest.AppliedSource: want 'main', got %q", m.AppliedSource)
	}
	if m.AppliedMainCommit != "abc1234" {
		t.Errorf("manifest.AppliedMainCommit: want 'abc1234', got %q", m.AppliedMainCommit)
	}

	// Parser swapped — Phoenix is now recognised.
	if r := parser.HeroRole("Phoenix"); r != "dps" {
		t.Errorf("after apply, parser.HeroRole(Phoenix) = %q, want dps", r)
	}
}

func TestApplyGameDataUpdate_PagesUnreachable_ReturnsSentinel(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	t.Cleanup(func() { _ = parser.Reload() })

	// Pages closed — every fetch fails with a connection error.
	withMainURLs(t, closedServerURL(t))

	_, err := (&app.App{}).ApplyGameDataUpdate()
	if !errors.Is(err, app.ErrDataUpdateMainFetchFailed) {
		t.Errorf("got %v, want ErrDataUpdateMainFetchFailed", err)
	}
}

func TestApplyGameDataUpdate_SHAMismatch_RejectsWithoutWriting(t *testing.T) {
	t.Setenv("RECALL_DATA_DIR", t.TempDir())
	t.Cleanup(func() { _ = parser.Reload() })

	heroes := []byte("tank:\n  - Reinhardt\n")
	// Hand-craft a server with a deliberately-wrong sidecar for heroes.
	mux := http.NewServeMux()
	mux.HandleFunc("/version.json", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"commit_sha":"abc1234567890def","committed_at":"2026-06-09T00:00:00Z"}`))
	})
	mux.HandleFunc("/heroes.yaml", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(heroes) })
	mux.HandleFunc("/heroes.yaml.sha256", func(w http.ResponseWriter, _ *http.Request) {
		// 64 zeros = guaranteed mismatch
		_, _ = w.Write([]byte("0000000000000000000000000000000000000000000000000000000000000000  heroes.yaml\n"))
	})
	mux.HandleFunc("/maps.yaml", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(heroes) })
	mux.HandleFunc("/maps.yaml.sha256", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("0000000000000000000000000000000000000000000000000000000000000000  maps.yaml\n"))
	})
	mux.HandleFunc("/screenshot_sources.yaml", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(validSourcesYAML()) })
	mux.HandleFunc("/screenshot_sources.yaml.sha256", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("0000000000000000000000000000000000000000000000000000000000000000  screenshot_sources.yaml\n"))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	withMainURLs(t, srv.URL)

	_, err := (&app.App{}).ApplyGameDataUpdate()
	if !errors.Is(err, app.ErrDataUpdateChecksum) {
		t.Errorf("got %v, want ErrDataUpdateChecksum", err)
	}

	// No files written under <data dir>.
	for _, name := range []string{"heroes.yaml", "maps.yaml", "screenshot_sources.yaml"} {
		path := filepath.Join(app.AppBaseDir(), "data", name)
		if _, err := os.Stat(path); err == nil {
			t.Errorf("expected %s NOT written after SHA mismatch", name)
		}
	}
}

// Partial-rename failure rolls back to the pre-apply snapshot. The
// scenario: heroes.yaml renamed (ok), maps.yaml.tmp → maps.yaml
// fails — snapshot must restore heroes.yaml + remove any leftover
// .tmp files, and the manifest must NOT reflect a partial apply.
func TestApplyGameDataUpdate_PartialRenameFailure_RestoresOriginal(t *testing.T) {
	// Register parser.Reload cleanup BEFORE t.Setenv so LIFO cleanup
	// puts the Reload AFTER the env restore — otherwise Reload would
	// see the test's heroes.yaml in the temp dir and load it as the
	// global dataset, leaking into the next test.
	t.Cleanup(func() { _ = parser.Reload() })
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

	heroes := []byte("tank:\n  - Reinhardt\n")
	maps := []byte("control:\n  - Ilios\n")
	sources := validSourcesYAML()
	srv := fakeMainServer(t, "abc1234567890def", heroes, maps, sources)
	withMainURLs(t, srv.URL)

	// Force the second rename to fail.
	callCount := 0
	withRenameFunc(t, func(oldpath, newpath string) error {
		callCount++
		if callCount == 2 {
			return errors.New("simulated rename failure")
		}
		return os.Rename(oldpath, newpath)
	})

	_, err := (&app.App{}).ApplyGameDataUpdate()
	if !errors.Is(err, app.ErrDataUpdateIO) {
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
	m, _ := app.LoadManifest()
	if m.AppliedMainCommit == "abc1234" {
		t.Errorf("manifest written despite failure: AppliedMainCommit=%q", m.AppliedMainCommit)
	}
}
