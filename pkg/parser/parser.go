// SPDX-License-Identifier: Apache-2.0

// Package parser turns Overwatch screenshot images into typed MatchResult
// values via Tesseract OCR.
//
// The package is intentionally split into per-concern files instead of one
// monolith:
//
//   - types.go            — MatchResult, HeroSR, HeroPlay, Performance,
//     PerformanceStat
//   - heroes.go           — heroRoles, HeroRole, extractHeroes,
//     heroNamesByLength
//   - maps.go             — knownMaps, snapToKnownMap, bestKnownMapInText,
//     levenshtein
//   - tesseract.go        — tessPath, SetTesseractPath, runTesseract,
//     ocrInverted, ocrRaw, runTesseractFunc seam
//   - imageutil.go        — crop, upscale, preprocessInverted
//   - text.go             — extractHeader, extractGameMode, extractInts,
//     digitize, normalizeDate, trimShortBoundaryWords,
//     labelToKey
//   - parse_rank.go       — isRankScreenshot + parseRank + extractRank /
//     extractModifiers / extractSR
//   - parse_summary.go    — isSummaryScreenshot + parseSummary +
//     parseHeroesPlayed / parsePerformance / parseRightCard
//   - parse_personal.go   — isPersonalScreenshot + parsePersonal +
//     parsePersonalHeroCell / parsePersonalStatCell
//   - parse_teams.go — parseTeams + parsePanelStats +
//     findHighlightedRowY / ocrRowCells / findRowXExtent /
//     findStatColumns
//   - parser.go (this file) — the ParseScreenshot dispatcher,
//     ParseScreenshotsDir entry point, ProgressFunc, parseSingleFunc seam
//   - exec_other.go / exec_windows.go — HideWindow build-tag pair for
//     console suppression on Windows
//
// All symbols stay in the same `parser` package. The split is a navigation
// aid, not a coupling boundary.
package parser

import (
	"context"
	"fmt"
	"image"
	_ "image/jpeg" // image.Decode JPEG support
	_ "image/png"  // image.Decode PNG support
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func ParseScreenshot(imagePath string) (*MatchResult, error) {
	tp := getTesseractPath()
	if _, err := exec.LookPath(tp); err != nil {
		return nil, fmt.Errorf("tesseract not available at %q — configure the binary in Settings → Engine (%w)", tp, err)
	}
	// #nosec G304 -- imagePath comes from ParseScreenshotsDir which builds
	// it via filepath.Join(screenshotsDir, fileInfo.Name()); screenshotsDir
	// passed validateScreenshotsDir at the boundary (safePathChars regex +
	// filepath.Clean equality), and fileInfo.Name() is just a basename.
	f, err := os.Open(imagePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	img, _, err := image.Decode(f)
	if err != nil {
		return nil, fmt.Errorf("decoding image: %w", err)
	}

	work := os.Getenv("RECALL_DEBUG_DIR")
	if work == "" {
		work, err = os.MkdirTemp("", "recall-*")
		if err != nil {
			return nil, err
		}
		defer os.RemoveAll(work)
	} else {
		// #nosec G703 -- RECALL_DEBUG_DIR is an opt-in developer env
		// var (documented in CLAUDE.md as "set to a fixed path to
		// inspect Tesseract work files after a parse run"). Not a
		// production attack surface.
		_ = os.MkdirAll(work, 0o700)
	}

	if isRankScreenshot(img, work) {
		return parseRank(img, work)
	}
	if isSummaryScreenshot(img, work) {
		return parseSummary(img, work)
	}
	if isPersonalScreenshot(img, work) {
		return parsePersonal(img, work)
	}
	return parseTeams(img, work)
}

// parseSingleFunc is the indirection ParseScreenshotsDir routes each file
// through. Production points at ParseScreenshot; tests swap it (with
// t.Cleanup) to return canned results / errors so the loop's resilience
// to per-file failures is testable without real images or Tesseract.
var parseSingleFunc = ParseScreenshot

// ProgressFunc is called after each screenshot finishes OCR. done is the
// number of files processed so far (1-based, including this one); total is
// the count of files to process this run. result is the parsed match data
// for the current file (nil when the file failed); err is non-nil iff the
// parse failed. The app layer surfaces a warning when err != nil but the
// loop continues — a single corrupted screenshot must not abandon every
// healthy file after it.
type ProgressFunc func(done, total int, filename string, result *MatchResult, err error)

// ParseScreenshotsDir OCRs every supported image in dir except those in skip
// (a set of filenames already parsed and stored). The skip set lets the app
// avoid re-running Tesseract on files that already belong to a DB row — OCR
// is by far the slowest part of the pipeline. progress is called (if non-nil)
// after each file completes, including failures.
//
// Per-file parse errors are non-fatal: the loop continues and the failing
// file is reported through the progress callback. Only a directory-level
// failure (ReadDir error) propagates as the function's error return.
//
// Cancellation: ctx is checked between files. When ctx is cancelled the loop
// returns the partial map gathered so far + ctx.Err() so the caller can
// distinguish "ran clean" from "user aborted". Tesseract itself is shelled
// out per file and not context-aware — cancellation lands at the next
// between-files boundary, not mid-OCR. Pass context.Background() to opt out.
func ParseScreenshotsDir(ctx context.Context, dir string, skip map[string]bool, progress ProgressFunc) (map[string]*MatchResult, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	// Collect files first so we know the total before the loop starts.
	var toProcess []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
			continue
		}
		if !skip[e.Name()] {
			toProcess = append(toProcess, e.Name())
		}
	}
	out := map[string]*MatchResult{}
	for i, name := range toProcess {
		// Honour cancellation BEFORE starting the next (potentially
		// multi-second) OCR shell-out. Files already completed stay
		// in `out`; the partial map gets a chance to flush downstream.
		if err := ctx.Err(); err != nil {
			return out, err
		}
		r, parseErr := parseSingleFunc(filepath.Join(dir, name))
		if parseErr != nil {
			// Per-file failure: log a warning, surface it through the
			// progress callback so the UI can flag the file, and keep
			// going. The whole batch must not abort because one
			// screenshot is corrupted, unreadable, or a non-OW PNG.
			//
			// `%q` (not `%s`/`%v`) on both args — `name` is the
			// filename from the user's screenshots directory, and
			// `parseErr` typically wraps tesseract's stderr which can
			// include the user-set tesseract path. Either could in
			// theory carry a control character (`\n`) that forges a
			// new log line ("log-injection"). %q runs each through
			// Go's quoting rules, escaping every control char into
			// its literal `\n` / `\t` / `\x07` form. CodeQL's
			// go/log-injection query recognises %q as a sanitizer.
			log.Printf("parse: %q: %q (skipping; continuing with remaining files)", name, parseErr)
		} else {
			out[name] = r
		}
		if progress != nil {
			progress(i+1, len(toProcess), name, r, parseErr)
		}
	}
	return out, nil
}
