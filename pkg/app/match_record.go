package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"recall/pkg/parser"
)

// MatchRecord is the per-match shape returned by GetMatchResults.
// It's assembled at read time by aggregateAll, which fuses every
// per-type screenshot row that shares a match_key. No `id` field —
// the previous single-table primary key is gone; match_key is identity.
type MatchRecord struct {
	MatchKey       string            `json:"match_key"`
	SourceFiles    []string          `json:"source_files"`
	SourceTypes    map[string]string `json:"source_types,omitempty"`
	SourceParsedAt map[string]string `json:"source_parsed_at,omitempty"`
	// SourceDirIDs maps a source filename to the screenshots_dirs row
	// id it was ingested from. The frontend builds
	// `/_screenshot/<id>/<filename>` URLs from this map so the
	// ScreenshotHandler can serve the right directory even after the
	// user changes their screenshots folder (re-install, move,
	// profile switch). Empty / missing means the dir was unset at
	// parse time; the client sends `0` to fall back to
	// `a.settings.ScreenshotsDir`.
	SourceDirIDs map[string]int64   `json:"source_dir_ids,omitempty"`
	ParsedAt     string             `json:"parsed_at,omitempty"`
	Data         parser.MatchResult `json:"data"`
	// User-curated annotation. Currently only `leaver` is surfaced in
	// the UI ("self" | "team" | "enemy"); empty string means no
	// annotation. Note is reserved for future per-match commentary.
	Annotation *MatchAnnotation `json:"annotation,omitempty"`
	// True iff the user soft-deleted this match. Omitted from the JSON
	// when false (the common case). Hidden matches are filtered out of
	// GetMatchResults by default — the frontend opts back in via the
	// FilterRail "Hidden · N" toggle so the user can unhide.
	Hidden bool `json:"hidden,omitempty"`

	// Review status — "self" (user reviewed the VOD themselves),
	// "coach" (a coach reviewed it), or "" (not reviewed; field
	// omitted from JSON). Drives the 3-state toggle at the top of
	// the detail-panel sidebar.
	ReviewedBy string `json:"reviewed_by,omitempty"`
	// Server-stamped timestamp of when the review row was last
	// upserted. Drives the dossier's "days since last review"
	// widget. Omitted from JSON when the match is unreviewed.
	ReviewedAt string `json:"reviewed_at,omitempty"`

	// Queue type — "role" (5v5 role queue), "open" (6v6 open
	// queue), or "" (not set; field omitted from JSON). Drives the
	// 3-state radiogroup at the very top of the detail-panel
	// sidebar AND the queue chip in the "Narrow this set" filter.
	QueueType string `json:"queue_type,omitempty"`

	// Play mode — "quickplay" or "competitive". Set ONLY from the
	// match_play_mode user-override aux table; parser-written
	// data.mode and rank-row presence do not surface here. New
	// matches default to "Not set" until the user explicitly
	// toggles via the right-panel radiogroup. Drives the 3-state
	// radiogroup directly below the queue chooser AND the
	// play-mode chip in "Narrow this set."
	PlayMode string `json:"play_mode,omitempty"`

	// Ambiguous + Candidates are populated when match_key starts with
	// "ambiguous-" — the resolver found multiple plausible matches
	// for the screenshot and is asking the user to pick the right
	// one. The frontend surfaces these in the Unknown tab's "Needs
	// your review" subsection.
	Ambiguous  bool                   `json:"ambiguous,omitempty"`
	Candidates []AmbiguousAttribution `json:"candidates,omitempty"`
}

// AmbiguousAttribution is one candidate match the user can pick to
// resolve the ambiguity. Mirrors db.AmbiguousCandidate but exposes the
// JSON wire shape so the App package owns the contract.
//
// RepresentativeSourceFile + RepresentativeDirID let the Unknown-tab
// picker render a small thumbnail beside each candidate. The
// thumbnail clicks through to the existing screenshot lightbox so
// the user can resolve ambiguity by sight, not by reading
// metadata. Both fields are populated on read by `attachAmbiguity`
// from the candidate match's own SourceFiles[0]; absent when the
// candidate match isn't in the result set (e.g. hidden when
// show-hidden is off).
type AmbiguousAttribution struct {
	MatchKey                 string `json:"match_key"`
	DistanceSeconds          int    `json:"distance_seconds"`
	RepresentativeSourceFile string `json:"representative_source_file,omitempty"`
	RepresentativeDirID      int64  `json:"representative_dir_id,omitempty"`
}

// MatchAnnotation is the per-match user note returned alongside
// MatchRecord. Mirrors the db.Annotation shape but lives in the App
// package so the JSON contract doesn't leak SQL field names.
//
// All five user-settable fields (leaver / note / replay_code / members
// / tags) are optional; the App-layer policy is "if every field is
// empty, delete the row". `members` and `tags` are omitted from the
// JSON when empty so the wire shape stays compact for the common case.
type MatchAnnotation struct {
	Leaver      string   `json:"leaver"`
	Note        string   `json:"note,omitempty"`
	ReplayCode  string   `json:"replay_code,omitempty"`
	Members     []string `json:"members,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	AnnotatedAt string   `json:"annotated_at,omitempty"`
}

// GetNewScreenshotCount returns the number of image files in the
// configured screenshots directory that haven't been parsed yet.
func (a *App) GetNewScreenshotCount() (int, error) {
	if a.settings.ScreenshotsDir == "" {
		return 0, nil
	}
	parsed, err := a.store.LoadAllFilenames()
	if err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(a.settings.ScreenshotsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	count := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
			continue
		}
		if !parsed[e.Name()] {
			count++
		}
	}
	return count, nil
}

// GetMatchResults returns one MatchRecord per match, aggregated from
// the per-screenshot tables. Read-time inference (inferSoleHeroPercent,
// inferResultFromRank) applies after aggregation; the source DB rows
// are never mutated.
func (a *App) GetMatchResults() ([]MatchRecord, error) {
	recs, err := a.aggregateAll()
	if err != nil {
		return nil, err
	}
	for i := range recs {
		inferSoleHeroPercent(&recs[i].Data)
		inferResultFromRank(&recs[i].Data)
	}
	return recs, nil
}

// ErrMatchNotFound is returned by GetMatchByKey when no match has the
// requested key. HTTP handlers route this to 404 via errors.Is.
var ErrMatchNotFound = errors.New("match not found")

// GetMatchByKey returns a single aggregated MatchRecord. Reuses the
// same aggregateAll pipeline as GetMatchResults (so the inference
// + child-table folding semantics are identical), then filters to
// the requested key. Returns ErrMatchNotFound if no row matches.
//
// The implementation aggregates the full corpus today; a future
// optimization is a per-key aggregator that runs one SELECT per
// table with a `WHERE match_key = ?` filter. Not done yet because
// the current corpus sizes are small and the predictable shape (one
// aggregator) is worth the duplication cost.
func (a *App) GetMatchByKey(matchKey string) (MatchRecord, error) {
	recs, err := a.GetMatchResults()
	if err != nil {
		return MatchRecord{}, err
	}
	for _, r := range recs {
		if r.MatchKey == matchKey {
			return r, nil
		}
	}
	return MatchRecord{}, ErrMatchNotFound
}

// ClearDatabase deletes every row across every per-type table. The
// `keepIgnored` opt-out preserves the Unknown-tab "Delete forever"
// suppress list across the wipe (Store.Clear unconditionally truncates
// `ignored_screenshots` — this method snapshots the list, calls Clear,
// then re-inserts so the suppress list survives without threading an
// option through every Store implementation). Pass `false` for the
// standard "factory reset" semantic; pass `true` when the user
// explicitly opts into keeping their curated ignore list.
func (a *App) ClearDatabase(keepIgnored bool) error {
	if !keepIgnored {
		return a.store.Clear()
	}
	snapshot, err := a.store.LoadIgnoredFilenames()
	if err != nil {
		return fmt.Errorf("snapshot ignored filenames: %w", err)
	}
	if err := a.store.Clear(); err != nil {
		return err
	}
	for filename := range snapshot {
		if err := a.store.AddIgnoredScreenshot(filename); err != nil {
			return fmt.Errorf("restore ignored %s: %w", filename, err)
		}
	}
	return nil
}
