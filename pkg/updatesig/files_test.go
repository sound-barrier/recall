package updatesig_test

import (
	"encoding/base64"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"recall/pkg/updatesig"
)

func TestWritePrivateKeyFile_WritesSeedOwnerOnly(t *testing.T) {
	_, priv := newKeyPair(t)
	path := filepath.Join(t.TempDir(), "update-signing.key")

	if err := updatesig.WritePrivateKeyFile(path, priv); err != nil {
		t.Fatalf("WritePrivateKeyFile: %v", err)
	}

	written, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read written file: %v", err)
	}
	if strings.ContainsAny(string(written), "\r\n") {
		t.Errorf("file holds more than the one key line: %q", written)
	}
	seed, err := base64.StdEncoding.DecodeString(string(written))
	if err != nil {
		t.Fatalf("file is not standard base64: %v", err)
	}
	if string(seed) != string(priv.Seed()) {
		t.Error("file does not decode to the private key's seed")
	}
	// Windows ACLs make a POSIX mode non-authoritative; unix CI covers it.
	if os.PathSeparator == '/' {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat written file: %v", err)
		}
		if mode := info.Mode().Perm(); mode != 0o600 {
			t.Errorf("file mode = %o, want 600", mode)
		}
	}
}

func TestWritePrivateKeyFile_RefusesToOverwrite(t *testing.T) {
	_, priv := newKeyPair(t)
	path := filepath.Join(t.TempDir(), "update-signing.key")
	const escrowed = "the key already escrowed"
	if err := os.WriteFile(path, []byte(escrowed), 0o600); err != nil {
		t.Fatalf("seed existing file: %v", err)
	}

	err := updatesig.WritePrivateKeyFile(path, priv)
	if !errors.Is(err, fs.ErrExist) {
		t.Fatalf("WritePrivateKeyFile over an existing file = %v, want fs.ErrExist", err)
	}
	kept, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatalf("read existing file: %v", readErr)
	}
	if string(kept) != escrowed {
		t.Errorf("existing file changed to %q", kept)
	}
}

// keygenLayout is a scratch filesystem holding a git work tree, a directory
// outside it to run from, and an escrow directory outside both.
type keygenLayout struct {
	repo, workDir, escrow string
}

func newKeygenLayout(t *testing.T) keygenLayout {
	t.Helper()
	root := t.TempDir()
	layout := keygenLayout{
		repo:    filepath.Join(root, "repo"),
		workDir: filepath.Join(root, "work"),
		escrow:  filepath.Join(root, "escrow"),
	}
	for _, dir := range []string{
		filepath.Join(layout.repo, ".git"),
		filepath.Join(layout.repo, "pkg", "updatesig"),
		filepath.Join(layout.workDir, "sub"),
		layout.escrow,
	} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatalf("mkdir %s: %v", dir, err)
		}
	}
	return layout
}

func TestKeyOutputPath_AcceptsPathOutsideEveryWorkTree(t *testing.T) {
	layout := newKeygenLayout(t)
	out := filepath.Join(layout.escrow, "update-signing.key")

	got, err := updatesig.KeyOutputPath(out, layout.workDir)
	if err != nil {
		t.Fatalf("KeyOutputPath(%s) = %v, want accepted", out, err)
	}
	if !filepath.IsAbs(got) || filepath.Base(got) != "update-signing.key" {
		t.Errorf("KeyOutputPath returned %q, want an absolute path to update-signing.key", got)
	}
	if !sameDir(t, filepath.Dir(got), layout.escrow) {
		t.Errorf("KeyOutputPath returned %q, which is not in %s", got, layout.escrow)
	}
}

func TestKeyOutputPath_RefusesPathsThatLandInAWorkTree(t *testing.T) {
	layout := newKeygenLayout(t)
	cases := map[string]string{
		"inside the git work tree":        filepath.Join(layout.repo, "pkg", "updatesig", "update-signing.key"),
		"at the git work tree root":       filepath.Join(layout.repo, "update-signing.key"),
		"inside the working directory":    filepath.Join(layout.workDir, "sub", "update-signing.key"),
		"relative to the working dir":     "update-signing.key",
		"climbing back into the git tree": filepath.Join(layout.escrow, "..", "repo", "update-signing.key"),
	}
	for name, out := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := updatesig.KeyOutputPath(out, layout.workDir); !errors.Is(err, updatesig.ErrKeyPathInWorkTree) {
				t.Errorf("KeyOutputPath(%s) = %v, want ErrKeyPathInWorkTree", out, err)
			}
		})
	}
}

// A linked worktree or a submodule marks its root with a .git FILE.
func TestKeyOutputPath_RefusesLinkedWorktree(t *testing.T) {
	layout := newKeygenLayout(t)
	linked := filepath.Join(filepath.Dir(layout.repo), "linked")
	if err := os.MkdirAll(linked, 0o700); err != nil {
		t.Fatalf("mkdir linked worktree: %v", err)
	}
	if err := os.WriteFile(filepath.Join(linked, ".git"), []byte("gitdir: ../repo/.git/worktrees/linked\n"), 0o600); err != nil {
		t.Fatalf("write .git file: %v", err)
	}

	out := filepath.Join(linked, "update-signing.key")
	if _, err := updatesig.KeyOutputPath(out, layout.workDir); !errors.Is(err, updatesig.ErrKeyPathInWorkTree) {
		t.Errorf("KeyOutputPath(%s) = %v, want ErrKeyPathInWorkTree", out, err)
	}
}

func TestKeyOutputPath_RefusesSymlinkIntoAWorkTree(t *testing.T) {
	layout := newKeygenLayout(t)
	link := filepath.Join(layout.escrow, "looks-outside")
	if err := os.Symlink(filepath.Join(layout.repo, "pkg"), link); err != nil {
		t.Skipf("symlinks unavailable here: %v", err)
	}

	out := filepath.Join(link, "update-signing.key")
	if _, err := updatesig.KeyOutputPath(out, layout.workDir); !errors.Is(err, updatesig.ErrKeyPathInWorkTree) {
		t.Errorf("KeyOutputPath(%s) = %v, want ErrKeyPathInWorkTree", out, err)
	}
}

// macOS volumes are case-insensitive by default, so a differently cased
// spelling of the working directory is still the working directory.
func TestKeyOutputPath_RefusesCaseVariantOfWorkingDirectory(t *testing.T) {
	layout := newKeygenLayout(t)
	variant := filepath.Join(filepath.Dir(layout.workDir), strings.ToUpper(filepath.Base(layout.workDir)))
	if _, err := os.Stat(variant); err != nil {
		t.Skip("case-sensitive filesystem: the variant is a different directory")
	}

	out := filepath.Join(variant, "update-signing.key")
	if _, err := updatesig.KeyOutputPath(out, layout.workDir); !errors.Is(err, updatesig.ErrKeyPathInWorkTree) {
		t.Errorf("KeyOutputPath(%s) = %v, want ErrKeyPathInWorkTree", out, err)
	}
}

// A path whose directory cannot be resolved cannot be proven outside a work
// tree, so it is refused rather than created somewhere unchecked.
func TestKeyOutputPath_RefusesMissingDirectory(t *testing.T) {
	layout := newKeygenLayout(t)
	out := filepath.Join(layout.escrow, "not-created-yet", "update-signing.key")

	if _, err := updatesig.KeyOutputPath(out, layout.workDir); !errors.Is(err, fs.ErrNotExist) {
		t.Errorf("KeyOutputPath(%s) = %v, want fs.ErrNotExist", out, err)
	}
}

func sameDir(t *testing.T, a, b string) bool {
	t.Helper()
	infoA, errA := os.Stat(a)
	infoB, errB := os.Stat(b)
	if errA != nil || errB != nil {
		t.Fatalf("stat %s / %s: %v / %v", a, b, errA, errB)
	}
	return os.SameFile(infoA, infoB)
}
