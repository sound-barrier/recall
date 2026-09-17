package updatesig

import (
	"crypto/ed25519"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
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
	return writeNewFile(path, []byte(EncodePrivateKey(priv)))
}

// SignFile writes the signature of the asset at path to path+SignatureSuffix,
// a file it creates with mode 0600 and never replaces. It signs the asset's
// base name, so the pair verifies wherever it is moved together. A priv whose
// public half is not trusted, the pinned key, is refused with ErrKeyMismatch
// before anything is written, since no installed copy of Recall would accept
// its signatures.
func SignFile(path string, priv ed25519.PrivateKey, trusted ed25519.PublicKey) error {
	if !trusted.Equal(priv.Public()) {
		return ErrKeyMismatch
	}
	digest, err := fileDigest(path)
	if err != nil {
		return err
	}
	return writeNewFile(path+SignatureSuffix, Sign(priv, filepath.Base(path), digest))
}

// VerifyFile checks the asset at path against the signature file beside it,
// returning ErrMissingSignature, which also wraps fs.ErrNotExist, when there
// is none and ErrBadSignature when trusted did not sign this asset.
func VerifyFile(path string, trusted ed25519.PublicKey) error {
	sigPath := path + SignatureSuffix
	// #nosec G304 -- path is an asset the maintainer or the release job names
	// to check; the tool reads it and never runs on anyone else's input.
	sig, err := os.ReadFile(sigPath)
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return fmt.Errorf("%w: %w", ErrMissingSignature, err)
	case err != nil:
		return err
	}
	digest, err := fileDigest(path)
	if err != nil {
		return err
	}
	return Verify(trusted, filepath.Base(path), digest, sig)
}

// fileDigest streams the file at path through SHA-256, since an updater exe
// runs to tens of megabytes.
func fileDigest(path string) ([sha256.Size]byte, error) {
	// #nosec G304 -- path is an asset the maintainer or the release job names
	// to sign or check; this tool never runs on anyone else's input.
	f, err := os.Open(path)
	if err != nil {
		return [sha256.Size]byte{}, err
	}
	defer func() { _ = f.Close() }()
	hash := sha256.New()
	if _, err := io.Copy(hash, f); err != nil {
		return [sha256.Size]byte{}, fmt.Errorf("read %s: %w", path, err)
	}
	return [sha256.Size]byte(hash.Sum(nil)), nil
}

// writeNewFile creates path holding data, readable and writable by its owner
// only. It never replaces an existing file, which may be the only copy of a
// key already in use or a signature already published.
func writeNewFile(path string, data []byte) error {
	// #nosec G304 -- path is the maintainer's own keygen -out argument, already
	// checked by KeyOutputPath, or a signature beside an asset the maintainer
	// or the release job names; this tool never runs on anyone else's input.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		// A truncated file left behind would pass for a complete one: a key
		// escrowed as the real key, or a signature that blocks re-signing.
		_ = os.Remove(path)
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}
