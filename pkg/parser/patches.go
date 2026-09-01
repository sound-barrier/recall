package parser

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"gopkg.in/yaml.v3"
)

// Patch is a moment the game changed under the player.
//
// Deliberately an INSTANT rather than a window: patches are contiguous, so the
// window between two of them is derivable and storing both ends would give
// two places for the same fact to be wrong.
type Patch struct {
	Name string
	At   time.Time
	Note string
}

// patchYAML decodes `at` as a string so time.Parse owns the format, exactly as
// seasonYAML does — YAML's own timestamp tag is looser than RFC 3339.
type patchYAML struct {
	Name string `yaml:"name"`
	At   string `yaml:"at"`
	Note string `yaml:"note"`
}

type patchesFile struct {
	Patches []patchYAML `yaml:"patches"`
}

// unmarshalPatches is the loadInto hook for patches.yaml.
func unmarshalPatches(ds *owDataset, b []byte) error {
	out, err := parsePatches(b)
	if err != nil {
		return err
	}
	if len(out) == 0 {
		return errors.New("no patches in YAML")
	}
	ds.patches = out
	return nil
}

// parsePatches decodes patches.yaml, oldest first.
//
// Sorted on read rather than trusted from the file: the split helpers walk
// forward through the list, and a hand-edited file with an out-of-order entry
// would otherwise put a match in the wrong window with nothing to notice it.
func parsePatches(raw []byte) ([]Patch, error) {
	var f patchesFile
	if err := yaml.Unmarshal(raw, &f); err != nil {
		return nil, fmt.Errorf("parse patches.yaml: %w", err)
	}
	out := make([]Patch, 0, len(f.Patches))
	for _, p := range f.Patches {
		at, err := time.Parse(time.RFC3339, p.At)
		if err != nil {
			return nil, fmt.Errorf("patch %q: at %q is not RFC 3339: %w", p.Name, p.At, err)
		}
		out = append(out, Patch{Name: p.Name, At: at, Note: p.Note})
	}
	slices.SortStableFunc(out, func(a, b Patch) int { return a.At.Compare(b.At) })
	return out, nil
}
