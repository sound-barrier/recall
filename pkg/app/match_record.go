package app

import (
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
	// SourceDirs maps a source filename to the screenshots-folder
	// path it was ingested from. Populated from the screenshots_dirs
	// FK on each per-type parent row, so when the user changes their
	// screenshots folder mid-history we still know where each old
	// screenshot was originally captured. Empty / missing when the
	// dir was unset at parse time.
	SourceDirs map[string]string  `json:"source_dirs,omitempty"`
	ParsedAt   string             `json:"parsed_at,omitempty"`
	Data       parser.MatchResult `json:"data"`
	// User-curated annotation. Currently only `leaver` is surfaced in
	// the UI ("self" | "team" | "enemy"); empty string means no
	// annotation. Note is reserved for future per-match commentary.
	Annotation *MatchAnnotation `json:"annotation,omitempty"`
	// True iff the user soft-deleted this match. Omitted from the JSON
	// when false (the common case). Hidden matches are filtered out of
	// GetMatchResults by default — the frontend opts back in via the
	// FilterRail "Hidden · N" toggle so the user can unhide.
	Hidden bool `json:"hidden,omitempty"`

	// Ambiguous + Candidates are populated when match_key starts with
	// "ambiguous:" — the resolver found multiple plausible matches
	// for the screenshot and is asking the user to pick the right
	// one. The frontend surfaces these in the Unknown tab's "Needs
	// your review" subsection.
	Ambiguous  bool                   `json:"ambiguous,omitempty"`
	Candidates []AmbiguousAttribution `json:"candidates,omitempty"`
}

// AmbiguousAttribution is one candidate match the user can pick to
// resolve the ambiguity. Mirrors db.AmbiguousCandidate but exposes the
// JSON wire shape so the App package owns the contract.
type AmbiguousAttribution struct {
	MatchKey        string `json:"match_key"`
	DistanceSeconds int    `json:"distance_seconds"`
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

// ClearDatabase deletes every row across every per-type table.
func (a *App) ClearDatabase() error { return a.store.Clear() }
