package updatesig

import (
	"crypto/ed25519"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// ErrKeyPathInWorkTree marks a key output path that lands inside the working
// directory or inside a git work tree, where one careless `git add` publishes
// the private key.
var ErrKeyPathInWorkTree = errors.New("key output path is inside a work tree")

// KeyOutputPath resolves out, taking a relative path against workDir, to the
// absolute path keygen may create. It refuses with ErrKeyPathInWorkTree a path
// inside workDir or inside any git work tree. Symbolic links in the path are
// resolved and directories are compared by identity rather than by spelling,
// so neither a symbolic link nor a case-insensitive filesystem carries the key
// into a repository. Mount points are not seen through: EvalSymlinks has left
// a Windows junction unresolved since Go 1.23, and a bind mount has no link to
// resolve, so a directory mounted from inside a repository is not caught. The
// key's directory must already exist; one that does not is refused, because
// it cannot be checked.
func KeyOutputPath(out, workDir string) (string, error) {
	if !filepath.IsAbs(out) {
		out = filepath.Join(workDir, out)
	}
	out = filepath.Clean(out)
	dir, err := filepath.EvalSymlinks(filepath.Dir(out))
	if err != nil {
		return "", fmt.Errorf("resolve the key's directory, which must already exist: %w", err)
	}
	work, err := os.Stat(workDir)
	if err != nil {
		return "", fmt.Errorf("stat the working directory: %w", err)
	}
	if err := refuseWorkTreeAncestor(dir, work); err != nil {
		return "", err
	}
	return filepath.Join(dir, filepath.Base(out)), nil
}

// refuseWorkTreeAncestor walks from dir, which must have no symlinks left in
// it, up to the filesystem root.
func refuseWorkTreeAncestor(dir string, work fs.FileInfo) error {
	for ancestor := dir; ; ancestor = filepath.Dir(ancestor) {
		info, err := os.Stat(ancestor)
		if err != nil {
			return fmt.Errorf("stat %s: %w", ancestor, err)
		}
		if os.SameFile(info, work) {
			return fmt.Errorf("%w: %s is inside the working directory", ErrKeyPathInWorkTree, dir)
		}
		_, err = os.Lstat(filepath.Join(ancestor, ".git"))
		switch {
		case err == nil:
			return fmt.Errorf("%w: %s is inside the git work tree %s", ErrKeyPathInWorkTree, dir, ancestor)
		case !errors.Is(err, fs.ErrNotExist):
			return fmt.Errorf("look for a git work tree at %s: %w", ancestor, err)
		}
		if filepath.Dir(ancestor) == ancestor {
			return nil
		}
	}
}

// WritePrivateKeyFile creates path holding EncodePrivateKey(priv) and nothing
// else, readable and writable by its owner only. It never replaces an existing
// file, which may be the only copy of a key already in use.
func WritePrivateKeyFile(path string, priv ed25519.PrivateKey) error {
	// #nosec G304 -- path is the maintainer's own keygen -out argument, already
	// checked by KeyOutputPath; this tool never runs on anyone else's input.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := f.WriteString(EncodePrivateKey(priv))
	closeErr := f.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		// A truncated key file left behind could be escrowed as the real key.
		_ = os.Remove(path)
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}
