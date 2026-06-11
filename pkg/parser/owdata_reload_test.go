package parser

import (
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
)

// swapDataDir points parserDataDirFunc at `dir` for the duration of
// the test, then restores the prior func + reloads back to embedded
// so other tests see a clean global dataset.
func swapDataDir(t *testing.T, dir string) {
	t.Helper()
	prev := parserDataDirFunc
	parserDataDirFunc = func() string { return dir }
	t.Cleanup(func() {
		parserDataDirFunc = prev
		_ = Reload()
	})
}

func TestReload_FilePresent_SwapsInUserData(t *testing.T) {
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "heroes.yaml"),
		[]byte("tank:\n  - TestNewTank\nsupport: []\ndps: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	swapDataDir(t, tmp)

	if err := Reload(); err != nil {
		t.Fatalf("Reload returned err: %v", err)
	}

	if got := HeroRole("TestNewTank"); got != "tank" {
		t.Errorf("HeroRole(TestNewTank) = %q, want tank", got)
	}
	// Override fully replaces embedded — Lúcio should NOT be present
	// after a complete user heroes.yaml is loaded.
	if got := HeroRole("Lúcio"); got != "" {
		t.Errorf("HeroRole(Lúcio) = %q, want \"\" (user file replaces embedded)", got)
	}
}

func TestReload_MissingFile_FallsBackToEmbedded(t *testing.T) {
	tmp := t.TempDir()
	swapDataDir(t, tmp)

	if err := Reload(); err != nil {
		t.Fatalf("Reload returned err: %v", err)
	}

	// Embedded heroes.yaml has Lúcio listed under "support".
	if got := HeroRole("Lúcio"); got != "support" {
		t.Errorf("HeroRole(Lúcio) = %q, want support (embedded fallback expected)", got)
	}
}

func TestReload_CorruptUserFile_FallsBackToEmbedded(t *testing.T) {
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "heroes.yaml"),
		[]byte("@@@ not: valid: yaml: at: all"), 0o600); err != nil {
		t.Fatal(err)
	}
	swapDataDir(t, tmp)

	if err := Reload(); err == nil {
		t.Fatal("Reload: expected error for corrupt user file, got nil")
	}
	// Despite the error, embedded data must still be available — a
	// corrupt user file MUST NOT brick the parser.
	if got := HeroRole("Lúcio"); got != "support" {
		t.Errorf("HeroRole(Lúcio) = %q, want support (embedded fallback expected)", got)
	}
}

func TestReload_ScreenshotSourcesAlsoSwaps(t *testing.T) {
	tmp := t.TempDir()
	override := `sources:
  - name: testtool
    prefix: "TestTool_"
    regex: '^TestTool_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.png$'
    year_offset: 0
    example: "TestTool_2026-06-08_14-32-11.png"
`
	if err := os.WriteFile(filepath.Join(tmp, "screenshot_sources.yaml"),
		[]byte(override), 0o600); err != nil {
		t.Fatal(err)
	}
	swapDataDir(t, tmp)

	if err := Reload(); err != nil {
		t.Fatalf("Reload returned err: %v", err)
	}

	found := false
	for _, s := range Sources() {
		if s.Name == "testtool" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("Sources() does not contain 'testtool' after reload")
	}
}

// TestReload_ConcurrentReadsAndSwaps drives many readers against
// repeated Reload() calls — atomic.Pointer semantics must guarantee no
// reader sees a partially-constructed dataset. Failure mode: a panic
// from a half-built map, or a wedged read.
func TestReload_ConcurrentReadsAndSwaps(t *testing.T) {
	tmp := t.TempDir()
	swapDataDir(t, tmp)

	var wg sync.WaitGroup
	var panicked atomic.Bool

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					panicked.Store(true)
				}
			}()
			for j := 0; j < 100; j++ {
				_ = HeroRole("Lúcio")
				_ = MapGameMode("Hollywood")
				_ = Sources()
			}
		}()
	}

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					panicked.Store(true)
				}
			}()
			for j := 0; j < 20; j++ {
				_ = Reload()
			}
		}()
	}

	wg.Wait()
	if panicked.Load() {
		t.Fatal("concurrent reads/reloads triggered a panic")
	}
}
