package rosterwatch

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Run is everything the command does, so the command itself stays a shell over
// it — the shape cmd/bug-finder uses, and the reason its logic is testable.

// Options are the run's inputs. Every one is explicit so a test can drive the
// whole thing without a clock, a network or a working directory.
type Options struct {
	// RepoRoot is where the roster YAMLs live (<root>/pkg/parser).
	RepoRoot string
	// AcceptedPath is the accepted-differences file. Missing is not an error —
	// an empty list is a valid state.
	AcceptedPath string
	// LocalRosterCommit is the SHA of the last commit touching a roster file.
	// Empty skips the published-channel check rather than failing the run: not
	// every caller is inside a git checkout.
	LocalRosterCommit string
	// Season labels a written entry ("Season 5 (2026-09-03)").
	Season string
	// Apply writes the proposed YAML edits. Default is report-only.
	Apply bool
	Now   time.Time
	Out   io.Writer
}

// Result is what the caller turns into an exit code.
type Result struct {
	Report  Report
	Written []string
}

// Run compares, optionally writes, and prints the report.
//
// It returns ErrSourceUnreadable (wrapped) when an upstream could not be read.
// That is deliberately NOT folded into the report: "the game moved" and "we
// could not tell whether the game moved" are different answers, and a caller
// that cannot distinguish them will eventually report the second as the first.
func Run(opts Options) (Result, error) {
	client := NewClient()

	heroes, err := FetchHeroes(client)
	if err != nil {
		return Result{}, err
	}
	maps, err := FetchMaps(client)
	if err != nil {
		return Result{}, err
	}
	patches, err := FetchPatchDates(client)
	if err != nil {
		return Result{}, err
	}

	accepted, err := loadAccepted(opts.AcceptedPath)
	if err != nil {
		return Result{}, err
	}

	shipped := ShippedFromParser()
	report := Compare(shipped, Upstream{Heroes: heroes, Maps: maps, PatchDates: patches}, opts.Now, accepted)

	// The channel check is separate: it has no upstream to compare against and
	// no bearing on whether the roster is current, only on whether what is
	// already merged actually reached anybody.
	if opts.LocalRosterCommit != "" {
		f, err := ChannelFinding(client, opts.LocalRosterCommit)
		if err != nil {
			return Result{}, err
		}
		if f != nil {
			report.Findings = append(report.Findings, *f)
		}
	}

	res := Result{Report: report}
	if opts.Apply {
		written, err := applyFindings(opts, report)
		if err != nil {
			return res, err
		}
		res.Written = written
	}
	writeReport(opts.Out, res)
	return res, nil
}

func loadAccepted(path string) (Accepted, error) {
	if path == "" {
		return Accepted{}, nil
	}
	f, err := os.Open(path) //nolint:gosec // maintainer-supplied path, not user input
	if errors.Is(err, os.ErrNotExist) {
		return Accepted{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("rosterwatch: open accepted list: %w", err)
	}
	defer func() { _ = f.Close() }()
	return ParseAccepted(f)
}

// applyFindings writes the edits it is confident in. A finding it cannot write
// — a hero with no role, a patch instant nobody published — stays in the report
// as something the maintainer does by hand.
func applyFindings(opts Options, report Report) ([]string, error) {
	var written []string
	for _, f := range report.Findings {
		var (
			file string
			edit func([]byte) ([]byte, error)
		)
		switch f.Kind {
		case KindHeroMissing:
			file = "heroes.yaml"
			edit = func(b []byte) ([]byte, error) { return ApplyHero(b, Hero{Name: f.Name, Role: f.Group}, opts.Season) }
		case KindMapMissing:
			file = "maps.yaml"
			edit = func(b []byte) ([]byte, error) { return ApplyMap(b, Map{Name: f.Name, GameMode: f.Group}, opts.Season) }
		default:
			continue
		}
		path := filepath.Join(opts.RepoRoot, "pkg", "parser", file)
		before, err := os.ReadFile(path) //nolint:gosec // path is derived from RepoRoot, not from upstream
		if err != nil {
			return written, fmt.Errorf("rosterwatch: read %s: %w", file, err)
		}
		after, err := edit(before)
		if err != nil {
			// A refusal to write is not a failure of the run — it is the
			// writer declining to guess, and the finding still stands.
			_, _ = fmt.Fprintf(opts.Out, "  not written: %v\n", err)
			continue
		}
		if err := os.WriteFile(path, after, 0o600); err != nil {
			return written, fmt.Errorf("rosterwatch: write %s: %w", file, err)
		}
		written = append(written, file+": "+f.Name)
	}
	return written, nil
}

// writeReport prints the findings as Markdown — the report is read in a pull
// request body more often than in a terminal.
//
// Write errors are dropped on purpose (the blank-assign idiom): the sink is
// stdout or a buffer, and a run that found real drift must not report failure
// because a pipe closed while it was describing what it found.
func writeReport(w io.Writer, res Result) {
	if w == nil {
		return
	}
	if !res.Report.Drifted() {
		_, _ = fmt.Fprintln(w, "The shipped roster matches the game.")
		return
	}
	byKind := map[string][]Finding{}
	order := []string{}
	for _, f := range res.Report.Findings {
		if _, seen := byKind[f.Kind]; !seen {
			order = append(order, f.Kind)
		}
		byKind[f.Kind] = append(byKind[f.Kind], f)
	}
	for _, kind := range order {
		_, _ = fmt.Fprintf(w, "\n### %s\n\n", headingFor(kind))
		for _, f := range byKind[kind] {
			_, _ = fmt.Fprintf(w, "- [ ] %s\n", f.Detail)
		}
	}
	if len(res.Written) > 0 {
		_, _ = fmt.Fprintf(w, "\n### Written\n\n")
		for _, w2 := range res.Written {
			_, _ = fmt.Fprintf(w, "- %s\n", w2)
		}
		_, _ = fmt.Fprintf(w, "\nEvery entry above is marked unconfirmed. Confirm each spelling against a\n"+
			"real scoreboard, add its guard test, and run the golden corpus before merging.\n")
	}
}

func headingFor(kind string) string {
	switch kind {
	case KindHeroMissing:
		return "Heroes the game has and the roster does not"
	case KindHeroSpelling:
		return "Heroes spelled differently upstream"
	case KindMapMissing:
		return "Maps the game has and the roster does not"
	case KindMapSpelling:
		return "Maps spelled differently upstream"
	case KindPatchMissing:
		return "Patches newer than the newest boundary"
	case KindSeasonExpired:
		return "Season window expired"
	case KindChannelStale:
		return "Published data channel"
	case KindAcceptedStale:
		return "Accepted differences that match nothing"
	}
	return strings.ToUpper(kind[:1]) + kind[1:]
}

// UnreadableSource reports whether err means an upstream could not be read, so
// the caller can give it its own exit code.
func UnreadableSource(err error) bool { return errors.Is(err, ErrSourceUnreadable) }
