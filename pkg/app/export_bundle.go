package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"

	"recall/pkg/db"
)

// BundleSchemaV1 is the wire-schema identifier the bundle's
// manifest carries. Bumping the constant is a breaking change to
// the bundle layout; the inner `data.json` keeps `exportSchemaV1`
// because it IS the existing v1 JSON export shape — the bundle
// just wraps a sanitized variant alongside the screenshot bytes.
// Exported so cmd/bug-finder can validate by-version.
const BundleSchemaV1 = "recall-bundle/v1"

// BundleManifestV1 is the on-disk shape of the bundle's
// `manifest.json`. Captures provenance + the screenshot ↔ match_key
// mapping for sanity-checking after restore. Exported so
// cmd/bug-finder can deserialize without redefining the schema.
type BundleManifestV1 struct {
	Schema          string            `json:"schema"`
	ExportedAt      string            `json:"exported_at"`
	RecallVersion   string            `json:"recall_version"`
	MatchCount      int               `json:"match_count"`
	ScreenshotCount int               `json:"screenshot_count"`
	IncludeUnknown  bool              `json:"include_unknown"`
	IncludeHidden   bool              `json:"include_hidden"`
	Screenshots     map[string]string `json:"screenshots"`
}

// BundleDataV1 is the on-disk shape of the bundle's `data.json`.
// Same row tables as the standalone `recall-export/v1` payload
// (`exportV1`), but DOES NOT carry the screenshots_dirs map —
// those paths leak the user's filesystem and aren't needed for the
// portable-backup / bug-report use cases. On restore via
// `POST /api/v1/imports`, the rows' `ScreenshotsDirID` references
// remap to 0 (use configured dir) because no entries in the
// screenshots_dirs envelope mean an empty remap table.
//
// Exported so cmd/bug-finder can deserialize directly.
type BundleDataV1 struct {
	Schema        string             `json:"schema"`
	ExportedAt    string             `json:"exported_at"`
	RecallVersion string             `json:"recall_version"`
	Summaries     []db.SummaryRow    `json:"summaries"`
	Scoreboards   []db.ScoreboardRow `json:"scoreboards"`
	Personals     []db.PersonalRow   `json:"personals"`
	Ranks         []db.RankRow       `json:"ranks"`
	Unknowns      []db.UnknownRow    `json:"unknowns"`
}

// ExportBundleOptions controls which matches end up in the bundle.
//
// The user-selected match keys (`MatchKeys`) are always included.
// The `IncludeUnknown` / `IncludeHidden` toggles UNION extra match
// keys onto that set so the user can pull in records that aren't
// normally checkbox-selectable from the Matches view.
type ExportBundleOptions struct {
	// MatchKeys is the set of match_keys the user ticked in the
	// Matches list. Empty slice + no toggles produces an empty bundle.
	MatchKeys []string
	// IncludeUnknown adds every record whose `data.map` is empty —
	// the same definition the Matches view's "unknown" filter uses.
	IncludeUnknown bool
	// IncludeHidden adds every record currently in `hidden_matches`.
	IncludeHidden bool
}

// ExportBundle produces a `.zip` payload containing:
//
//   - manifest.json   — `recall-bundle/v1` envelope with the
//     screenshot → match_key mapping for
//     sanity-checking restore.
//   - data.json       — the `recall-export/v1` JSON export shape,
//     restricted to the included matches. The
//     bundle restores via the existing
//     `POST /api/v1/imports` path.
//   - screenshots/*   — every source file referenced by an included
//     row. A missing-on-disk file is silently
//     skipped (the row still ships in data.json
//     so the restore can re-parse later).
//
// The bundle never streams to disk — it's built in-memory and
// returned. The HTTP server uses the bytes as the response body;
// Wails mode threads them into a SaveFileDialog → os.WriteFile.
func (a *App) ExportBundle(opts ExportBundleOptions) ([]byte, error) {
	// 1. Build the include set. GetMatchResults() runs the same
	//    aggregator the Matches view consumes, so the "unknown" and
	//    "hidden" definitions stay in lockstep with the UI.
	recs, err := a.GetMatchResults()
	if err != nil {
		return nil, fmt.Errorf("export bundle: aggregate: %w", err)
	}
	include := make(map[string]struct{}, len(opts.MatchKeys))
	for _, k := range opts.MatchKeys {
		include[k] = struct{}{}
	}
	for _, r := range recs {
		if opts.IncludeUnknown && r.Data.Map == "" {
			include[r.MatchKey] = struct{}{}
		}
		if opts.IncludeHidden && r.Hidden {
			include[r.MatchKey] = struct{}{}
		}
	}

	// 2. Load the per-screenshot rows and filter every parent slice
	//    by the include set. Children flow with their parents (the
	//    db.SummaryRow / etc. structs already embed HeroesPlayed and
	//    friends inline), so we don't have to walk child tables
	//    separately.
	snap, err := a.store.LoadAll()
	if err != nil {
		return nil, fmt.Errorf("export bundle: load: %w", err)
	}
	keep := func(k string) bool {
		_, ok := include[k]
		return ok
	}
	summaries := filterRows(snap.Summaries, keep, func(r db.SummaryRow) string { return r.MatchKey })
	scoreboards := filterRows(snap.Scoreboards, keep, func(r db.ScoreboardRow) string { return r.MatchKey })
	personals := filterRows(snap.Personals, keep, func(r db.PersonalRow) string { return r.MatchKey })
	ranks := filterRows(snap.Ranks, keep, func(r db.RankRow) string { return r.MatchKey })
	unknowns := filterRows(snap.Unknowns, keep, func(r db.UnknownRow) string { return r.MatchKey })

	// 3. Build the screenshot map (filename → match_key) for the
	//    manifest. Walking the filtered rows guarantees we only list
	//    files we actually copy into the bundle.
	screenshots := map[string]string{}
	for _, r := range summaries {
		screenshots[r.Filename] = r.MatchKey
	}
	for _, r := range scoreboards {
		screenshots[r.Filename] = r.MatchKey
	}
	for _, r := range personals {
		screenshots[r.Filename] = r.MatchKey
	}
	for _, r := range ranks {
		screenshots[r.Filename] = r.MatchKey
	}
	for _, r := range unknowns {
		screenshots[r.Filename] = r.MatchKey
	}

	// 4. Build the ZIP in-memory. Capture one `now` for every embedded
	//    entry so manifest's `exported_at`, data.json's `exported_at`,
	//    and every ZIP local-file-header mtime agree to the second.
	now := time.Now().UTC()
	exportedAt := now.Format(time.RFC3339)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	// 4a. data.json — `recall-export/v1` payload restricted to the
	//     included matches, WITHOUT the screenshots_dirs path map.
	//     Stripping the map keeps the bundle free of the user's local
	//     filesystem path; restore via POST /api/v1/imports remaps
	//     every row's ScreenshotsDirID to 0 (use configured dir).
	dataDoc := BundleDataV1{
		Schema:        exportSchemaV1,
		ExportedAt:    exportedAt,
		RecallVersion: Version,
		Summaries:     summaries,
		Scoreboards:   scoreboards,
		Personals:     personals,
		Ranks:         ranks,
		Unknowns:      unknowns,
	}
	if err := bundleWriteJSON(zw, "data.json", dataDoc, now); err != nil {
		return nil, fmt.Errorf("export bundle: write data.json: %w", err)
	}

	// 5b. screenshots/<filename> — copy raw bytes off disk. Missing
	//     files are silently skipped; their entries get pruned from
	//     the in-memory `screenshots` map so the manifest stays
	//     consistent with what the ZIP actually contains.
	dirByRowFn := func(dirID int64) string {
		// dir-id 0 falls back to the live screenshots folder (same
		// rule the screenshot handler uses for unparsed-watch files).
		if dirID > 0 {
			if p, ok := snap.ScreenshotsDirs[dirID]; ok && p != "" {
				return p
			}
		}
		return a.settings.ScreenshotsDir
	}
	for _, batch := range [][]struct {
		Filename string
		DirID    int64
	}{
		toFilesDirs(summaries, func(r db.SummaryRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(scoreboards, func(r db.ScoreboardRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(personals, func(r db.PersonalRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(ranks, func(r db.RankRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(unknowns, func(r db.UnknownRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
	} {
		for _, f := range batch {
			dir := dirByRowFn(f.DirID)
			if dir == "" {
				delete(screenshots, f.Filename)
				continue
			}
			// #nosec G304 -- filename comes from the per-screenshot
			// rows the parser inserted; the validator on the
			// screenshots-folder setter (validateScreenshotsDir) caps
			// the dir to a sandboxed user path, and the basename was
			// produced by the parser, not user input.
			body, err := os.ReadFile(filepath.Join(dir, f.Filename))
			if err != nil {
				if errors.Is(err, fs.ErrNotExist) {
					delete(screenshots, f.Filename)
					continue
				}
				return nil, fmt.Errorf("export bundle: read %s: %w", f.Filename, err)
			}
			if err := bundleWriteRaw(zw, "screenshots/"+f.Filename, body, now); err != nil {
				return nil, fmt.Errorf("export bundle: write screenshot: %w", err)
			}
		}
	}

	// 4c. manifest.json — assembled AFTER the screenshots loop so its
	//     `screenshots` map reflects what actually landed in the ZIP.
	mf := BundleManifestV1{
		Schema:          BundleSchemaV1,
		ExportedAt:      exportedAt,
		RecallVersion:   Version,
		MatchCount:      len(include),
		ScreenshotCount: len(screenshots),
		IncludeUnknown:  opts.IncludeUnknown,
		IncludeHidden:   opts.IncludeHidden,
		Screenshots:     screenshots,
	}
	if err := bundleWriteJSON(zw, "manifest.json", mf, now); err != nil {
		return nil, fmt.Errorf("export bundle: write manifest: %w", err)
	}

	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("export bundle: close zip: %w", err)
	}
	return buf.Bytes(), nil
}

// filterRows keeps every row whose match_key (read via keyOf) is in
// the include map's key set. Slice element type is generic via T.
func filterRows[T any](rows []T, keep func(string) bool, keyOf func(T) string) []T {
	out := make([]T, 0, len(rows))
	for _, r := range rows {
		if keep(keyOf(r)) {
			out = append(out, r)
		}
	}
	return out
}

// toFilesDirs collapses a typed parent-row slice into the
// per-screenshot (filename, dir-id) pairs the bundle's screenshot-
// copy loop consumes. Stable order — sorted by filename — so the
// in-memory bundle bytes are deterministic across runs.
func toFilesDirs[T any](rows []T, get func(T) (string, int64)) []struct {
	Filename string
	DirID    int64
} {
	out := make([]struct {
		Filename string
		DirID    int64
	}, 0, len(rows))
	for _, r := range rows {
		name, dirID := get(r)
		if name == "" {
			continue
		}
		out = append(out, struct {
			Filename string
			DirID    int64
		}{name, dirID})
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Filename < out[j].Filename
	})
	return out
}

// bundleWriteJSON writes `v` as a deflated ZIP entry with the given
// name and modification time. Set `mt` to the bundle's captured
// `now` so every entry agrees on a single timestamp — the existing
// `zipWriteJSON` helper (used by the CSV export) leaves the entry
// at the MS-DOS epoch (1980-01-01), which surfaces as confusing
// "Jan 10 1980" file modification dates after extraction. See the
// reported bug for context.
func bundleWriteJSON(zw *zip.Writer, name string, v any, mt time.Time) error {
	w, err := zw.CreateHeader(&zip.FileHeader{
		Name:     name,
		Method:   zip.Deflate,
		Modified: mt,
	})
	if err != nil {
		return err
	}
	return json.NewEncoder(w).Encode(v)
}

// bundleWriteRaw writes a single file (its raw bytes) into the open
// ZIP writer with the given name + modification time. Same timestamp
// rationale as bundleWriteJSON.
func bundleWriteRaw(zw *zip.Writer, name string, body []byte, mt time.Time) error {
	w, err := zw.CreateHeader(&zip.FileHeader{
		Name:     name,
		Method:   zip.Deflate,
		Modified: mt,
	})
	if err != nil {
		return err
	}
	if _, err := w.Write(body); err != nil {
		return err
	}
	return nil
}
