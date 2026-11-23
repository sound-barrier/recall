package glyphs

import (
	"bytes"
	"embed"
	"fmt"
	"image"
	"image/png"
	"io/fs"
	"path"
	"strconv"
	"strings"
	"sync"
)

//go:embed refs
var refsFS embed.FS

// Load builds References from a tree laid out as refs/README.md describes:
// digit/<digit>/<name>.png. Files
// without a .png extension are skipped; a .png anywhere else is an error, so
// a mislabeled cut fails loudly instead of quietly matching nothing.
func Load(fsys fs.FS) (*References, error) {
	var refs References
	err := fs.WalkDir(fsys, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || path.Ext(name) != ".png" {
			return nil
		}
		return refs.addFile(fsys, name)
	})
	if err != nil {
		return nil, err
	}
	return &refs, nil
}

func (r *References) addFile(fsys fs.FS, name string) error {
	add, err := r.adderFor(name)
	if err != nil {
		return err
	}
	img, err := decodePNG(fsys, name)
	if err != nil {
		return err
	}
	if err := add(img); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

// adderFor reads a reference's kind and label off its path.
func (r *References) adderFor(name string) (func(image.Image) error, error) {
	parts := strings.Split(name, "/")
	if len(parts) != 3 || parts[0] != "digit" {
		return nil, fmt.Errorf("%s: want digit/<digit>/<name>.png", name)
	}
	digit, err := strconv.Atoi(parts[1])
	if err != nil {
		return nil, fmt.Errorf("%s: %q is not a digit", name, parts[1])
	}
	return func(img image.Image) error { return r.AddDigit(digit, img) }, nil
}

func decodePNG(fsys fs.FS, name string) (image.Image, error) {
	data, err := fs.ReadFile(fsys, name)
	if err != nil {
		return nil, err
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return img, nil
}

func loadEmbedded() (*References, error) {
	sub, err := fs.Sub(refsFS, "refs")
	if err != nil {
		return nil, err
	}
	return Load(sub)
}

// embedded loads once, on first read. A refs/ tree that fails to load is
// caught by the package's tests; at run time it reads as an empty set, the
// same "no match" a missing reference gives, because the cross-check must
// never stop a parse.
var embedded = sync.OnceValues(loadEmbedded)

// ReadNumber is (*References).ReadNumber against the references embedded in
// the binary.
func ReadNumber(img image.Image, rect image.Rectangle) (NumberReading, bool) {
	refs, err := embedded()
	if err != nil {
		return NumberReading{}, false
	}
	return refs.ReadNumber(img, rect)
}
