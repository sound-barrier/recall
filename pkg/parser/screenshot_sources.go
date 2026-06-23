package parser

import (
	"errors"
	"fmt"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// screenshot_sources.yaml describes the per-capture-tool filename
// formats parseFilenameTimestamp walks in pkg/app/correlation.go.
// Adding a new tool is a YAML edit; the loader rejects un-anchored
// regexes at init so a malformed pattern can't silently absorb
// unrelated screenshot files from the watched folder.
//
// The embedded bytes + parserDataDirFunc()-based user override are
// loaded as part of the shared dataset (owdata.go::Reload). Accessor:
// Sources().

// ScreenshotSource is one capture tool's filename grammar.
// Consumers (pkg/app/correlation.go) read the fields directly.
type ScreenshotSource struct {
	Name       string         // stable id (nvidia / prntscn / snip / …)
	Prefix     string         // fast strings.HasPrefix gate
	Regex      *regexp.Regexp // anchored — six capture groups: y, m, d, H, M, S
	YearOffset int            // added to the captured year (2-digit YAML → 2000)
	Example    string         // canonical example filename — surfaced in Settings → Advanced
}

type screenshotSourceYAML struct {
	Name       string `yaml:"name"`
	Prefix     string `yaml:"prefix"`
	Regex      string `yaml:"regex"`
	YearOffset int    `yaml:"year_offset"`
	Example    string `yaml:"example"`
}

type screenshotSourcesFile struct {
	Sources []screenshotSourceYAML `yaml:"sources"`
}

func unmarshalScreenshotSources(ds *owDataset, bytes []byte) error {
	var raw screenshotSourcesFile
	if err := yaml.Unmarshal(bytes, &raw); err != nil {
		return fmt.Errorf("unmarshal: %w", err)
	}
	if len(raw.Sources) == 0 {
		return errors.New("no sources in YAML")
	}
	out := make([]ScreenshotSource, 0, len(raw.Sources))
	for i, s := range raw.Sources {
		if s.Name == "" {
			return fmt.Errorf("source[%d]: empty name", i)
		}
		if s.Prefix == "" {
			return fmt.Errorf("source[%d] %q: empty prefix", i, s.Name)
		}
		if !strings.HasPrefix(s.Regex, "^") {
			// A bad pattern that matches anywhere in the filename could
			// absorb random files; require ^ as a defence-in-depth gate
			// alongside the prefix check.
			return fmt.Errorf("source[%d] %q: regex must start with ^ (got %q)", i, s.Name, s.Regex)
		}
		if s.Example == "" {
			return fmt.Errorf("source[%d] %q: empty example", i, s.Name)
		}
		re, err := regexp.Compile(s.Regex)
		if err != nil {
			return fmt.Errorf("source[%d] %q: compile regex: %w", i, s.Name, err)
		}
		out = append(out, ScreenshotSource{
			Name:       s.Name,
			Prefix:     s.Prefix,
			Regex:      re,
			YearOffset: s.YearOffset,
			Example:    s.Example,
		})
	}
	ds.screenshotSources = out
	return nil
}
