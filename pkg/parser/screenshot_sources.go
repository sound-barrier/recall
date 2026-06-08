package parser

import (
	_ "embed"
	"fmt"
	"log"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// screenshot_sources.yaml describes the per-capture-tool filename
// formats parseFilenameTimestamp walks in pkg/app/correlation.go.
// Adding a new tool is a YAML edit; the loader rejects un-anchored
// regexes at init so a malformed pattern can't silently absorb
// unrelated screenshot files from the watched folder.

//go:embed screenshot_sources.yaml
var screenshotSourcesYAML []byte

// ScreenshotSource is one capture tool's filename grammar.
// Consumers (pkg/app/correlation.go) read the fields directly.
type ScreenshotSource struct {
	Name       string         // stable id (nvidia / prntscn / snip / …)
	Prefix     string         // fast strings.HasPrefix gate
	Regex      *regexp.Regexp // anchored — six capture groups: y, m, d, H, M, S
	YearOffset int            // added to the captured year (2-digit YAML → 2000)
}

// ScreenshotSources is the in-memory registry the correlation
// layer iterates. Populated at init() from screenshot_sources.yaml.
// Order matches the YAML file.
var ScreenshotSources []ScreenshotSource

// ScreenshotSourcesLoadError holds the error from the YAML parse +
// validation pass. nil means every entry loaded cleanly; non-nil
// means parseFilenameTimestamp will fall through every filename it
// receives, which is the safe failure mode (everything lands as
// `unmatched-<filename>` instead of being mis-attributed).
var ScreenshotSourcesLoadError error

type screenshotSourceYAML struct {
	Name       string `yaml:"name"`
	Prefix     string `yaml:"prefix"`
	Regex      string `yaml:"regex"`
	YearOffset int    `yaml:"year_offset"`
}

type screenshotSourcesFile struct {
	Sources []screenshotSourceYAML `yaml:"sources"`
}

func init() {
	if err := loadScreenshotSourcesYAML(); err != nil {
		log.Printf("parser: screenshot_sources.yaml load failed: %v — every screenshot will fall back to unmatched-<filename>", err)
		ScreenshotSourcesLoadError = err
	}
}

func loadScreenshotSourcesYAML() error {
	var raw screenshotSourcesFile
	if err := yaml.Unmarshal(screenshotSourcesYAML, &raw); err != nil {
		return fmt.Errorf("unmarshal: %w", err)
	}
	if len(raw.Sources) == 0 {
		return fmt.Errorf("no sources in YAML")
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
		re, err := regexp.Compile(s.Regex)
		if err != nil {
			return fmt.Errorf("source[%d] %q: compile regex: %w", i, s.Name, err)
		}
		out = append(out, ScreenshotSource{
			Name:       s.Name,
			Prefix:     s.Prefix,
			Regex:      re,
			YearOffset: s.YearOffset,
		})
	}
	ScreenshotSources = out
	return nil
}
