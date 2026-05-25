package app

import (
	"fmt"
	"sort"
	"time"

	"recall/pkg/parser"
)

// ParseProgressEvent is emitted on the "parse-progress" channel/event
// after each screenshot finishes OCR. Error is non-empty when the file
// failed to parse — the loop continues regardless, so the frontend can
// render a per-file warning without the batch aborting.
type ParseProgressEvent struct {
	Done     int                 `json:"done"`
	Total    int                 `json:"total"`
	Filename string              `json:"filename"`
	Type     string              `json:"screenshot_type"`
	Data     *parser.MatchResult `json:"data,omitempty"`
	Error    string              `json:"error,omitempty"`
}

// screenshotType infers the screenshot category from the fields that were
// populated by the parser: rank fields → "rank", summary fields → "summary",
// E/A/D combat stats → "scoreboard", per-hero stats → "personal", otherwise
// "unknown".
//
// ORDERING INVARIANT (load-bearing — do not reorder):
// A SCOREBOARD parse populates *both* the E/A/D combat row and the
// right-side panel's hero stats (HeroesPlayed[*].Stats), while a PERSONAL
// parse only populates hero stats. The E/A/D check therefore MUST run
// before the hero-stats check — flipping the two would mis-classify
// every scoreboard with a populated panel as "personal".
//
// Locked by TestScreenshotType "Scoreboard with E/A/D AND panel hero
// stats → scoreboard (NOT personal)" in merge_test.go.
func screenshotType(r *parser.MatchResult) string {
	if r == nil {
		return "unknown"
	}
	if r.Rank != "" {
		return "rank"
	}
	if r.Result != "" || r.Date != "" || r.GameLength != "" {
		return "summary"
	}
	if r.Eliminations > 0 || r.Assists > 0 || r.Deaths > 0 || r.Damage > 0 {
		return "scoreboard"
	}
	for _, hp := range r.HeroesPlayed {
		if len(hp.Stats) > 0 {
			return "personal"
		}
	}
	return "unknown"
}

// ParseScreenshots OCRs every image in screenshots/ and merges results from
// screenshots taken close together (within mergeWindow) into one DB row.
// SUMMARY, TEAMS, and PERSONAL screenshots populate disjoint subsets of
// fields; the user typically takes them within a few seconds by cycling the
// post-match tabs, so the filename timestamp is the most reliable correlation
// signal — PERSONAL has no E/A/D, so a stats-based key wouldn't catch it.
func (a *App) ParseScreenshots() error {
	// Bail out early if the screenshots directory isn't usable. The
	// frontend disables the Parse button until one is configured, but
	// the HTTP /api/parse endpoint can be hit by any client — including
	// a fresh install where SetScreenshotsDir hasn't been called yet,
	// or one where the previously-saved directory has since been
	// deleted/moved.
	screenshotsDir, err := validateScreenshotsDir(a.settings.ScreenshotsDir)
	if err != nil {
		return err
	}
	// Bail out early if Tesseract isn't usable. The frontend already
	// shows a blocking System Alert when this is the case and disables
	// the Parse button — this guard catches the rare case where the
	// binary disappeared (uninstall, move) after launch.
	if !a.tessStatus.Found {
		// Refresh once in case the user fixed the install in another
		// window without clicking through the UI to re-check.
		a.tessStatus = checkTesseract(a.settings.TesseractPath)
		if !a.tessStatus.Found {
			return fmt.Errorf("tesseract is not available: %s", a.tessStatus.Error)
		}
	}
	// Serialize parses: the watcher might fire one while the user has
	// just clicked Parse, and overlapping Tesseract calls + DB upserts
	// would race on the parsed-files set.
	a.parseMu.Lock()
	defer a.parseMu.Unlock()

	// Skip files already in some DB row's source_files. OCR is slow (~seconds
	// per image), and we only need to re-process newly added screenshots.
	parsed, err := a.store.LoadSourceFilenames()
	if err != nil {
		return err
	}
	results, err := parser.ParseScreenshotsDir(screenshotsDir, parsed, func(done, total int, filename string, result *parser.MatchResult, parseErr error) {
		ev := ParseProgressEvent{
			Done:     done,
			Total:    total,
			Filename: filename,
			Type:     screenshotType(result),
			Data:     result,
		}
		if parseErr != nil {
			ev.Error = parseErr.Error()
		}
		a.emitParseProgress(ev)
	})
	if err != nil {
		return err
	}
	if len(results) == 0 {
		return nil
	}

	// Stamp every just-OCR'd file with the current UTC time. These
	// flow through the merge into mergedRow.ParsedAt and ultimately
	// into the DB's source_parsed_at column. Existing files (already
	// in the DB) keep their original stamps when folded — see
	// mergeTypeMaps semantics (a wins over b).
	now := time.Now().UTC().Format(time.RFC3339)
	stamps := make(map[string]string, len(results))
	for f := range results {
		stamps[f] = now
	}

	// Two-pass merge across the NEW parses: first by filename timestamp
	// (catches sequential SUMMARY/TEAMS/PERSONAL clicks of one match), then
	// by (E, A, D) signature (catches a mid-match scoreboard screenshot
	// paired with the post-match summary taken minutes or hours later).
	newRows := mergeByTimestamp(results, stamps)
	newRows = mergeByStatsSignature(newRows)

	// Fold each new row into an existing DB row when one matches — by E/A/D
	// or by filename timestamp window with no conflicting metadata. This
	// keeps incremental re-parses idempotent: adding the rank screenshot to
	// a Lucio match already in the DB updates that row instead of creating
	// a new one.
	existing, err := a.loadExistingMergedRows()
	if err != nil {
		return err
	}
	for _, nr := range newRows {
		if idx := findMergeIntoExisting(nr, existing); idx >= 0 {
			targetKey := existing[idx].Key
			mergeMatchResult(&existing[idx].Data, &nr.Data)
			existing[idx].Sources = unionSortedStrings(existing[idx].Sources, nr.Sources)
			existing[idx].Types = mergeTypeMaps(existing[idx].Types, nr.Types)
			// ParsedAt: existing entries win (their first-insert stamps
			// are authoritative). New files in nr.ParsedAt fill in.
			existing[idx].ParsedAt = mergeTypeMaps(existing[idx].ParsedAt, nr.ParsedAt)
			existing[idx].Key = targetKey
			if err := a.upsertMergedRow(existing[idx]); err != nil {
				return err
			}
		} else {
			// All modes (competitive, quickplay, unranked, …) land in
			// SQLite — the Wails UI shows everything and lets the user
			// filter via the Mode dropdown. The Prometheus collector
			// applies its own competitive-only filter at scrape time
			// (see pkg/metrics/metrics.go) so the Grafana side
			// keeps its win-rate / KDA series clean.
			if err := a.upsertMergedRow(nr); err != nil {
				return err
			}
		}
	}
	return nil
}

// loadExistingMergedRows reads every row back into the mergedRow shape so
// new parses can be folded into them.
func (a *App) loadExistingMergedRows() ([]mergedRow, error) {
	records, err := a.readAllRecords()
	if err != nil {
		return nil, err
	}
	rows := make([]mergedRow, 0, len(records))
	for _, rec := range records {
		rows = append(rows, mergedRow{
			Key:      rec.MatchKey,
			Sources:  rec.SourceFiles,
			Types:    rec.SourceTypes,
			ParsedAt: rec.SourceParsedAt,
			Data:     rec.Data,
		})
	}
	return rows, nil
}

// findMergeIntoExisting returns the index of an existing row that nr should
// fold into, or -1. A row qualifies via either:
//   - statsRowsMergeable (E/A/D agreement plus no field conflicts), or
//   - any source filename in nr is within mergeWindow of any source in the
//     existing row AND no signature field conflicts (map / date / finish
//     time / hero / E/A/D).
func findMergeIntoExisting(nr mergedRow, existing []mergedRow) int {
	for i, er := range existing {
		if statsRowsMergeable(nr, er) {
			return i
		}
		if timestampWindowOverlap(nr.Sources, er.Sources) && !rowsConflict(nr, er) {
			return i
		}
	}
	return -1
}

func timestampWindowOverlap(a, b []string) bool {
	for _, fa := range a {
		ta, ok := parseFilenameTimestamp(fa)
		if !ok {
			continue
		}
		for _, fb := range b {
			tb, ok := parseFilenameTimestamp(fb)
			if !ok {
				continue
			}
			d := ta.Sub(tb)
			if d < 0 {
				d = -d
			}
			if d <= mergeWindow {
				return true
			}
		}
	}
	return false
}

func rowsConflict(a, b mergedRow) bool {
	if stringsConflict(a.Data.Map, b.Data.Map) ||
		stringsConflict(a.Data.Date, b.Data.Date) ||
		stringsConflict(a.Data.FinishedAt, b.Data.FinishedAt) ||
		stringsConflict(a.Data.Hero, b.Data.Hero) {
		return true
	}
	if intsConflict(a.Data.Eliminations, b.Data.Eliminations) ||
		intsConflict(a.Data.Assists, b.Data.Assists) ||
		intsConflict(a.Data.Deaths, b.Data.Deaths) {
		return true
	}
	return false
}

func unionSortedStrings(a, b []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(a)+len(b))
	for _, s := range a {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	for _, s := range b {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}
