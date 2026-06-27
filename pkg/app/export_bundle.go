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
	"recall/pkg/match"
)

// exportSchemaV1 is the wire-schema identifier the bundle's inner data.json
// carries. It predates the bundle (it was the standalone JSON export's schema)
// and is kept as the data.json contract the merge import validates against.
const exportSchemaV1 = "recall-export/v1"

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
	Schema        string           `json:"schema"`
	ExportedAt    string           `json:"exported_at"`
	RecallVersion string           `json:"recall_version"`
	Summaries     []db.SummaryRow  `json:"summaries"`
	Teams         []db.TeamsRow    `json:"teams"`
	Personals     []db.PersonalRow `json:"personals"`
	Ranks         []db.RankRow     `json:"ranks"`
	Unknowns      []db.UnknownRow  `json:"unknowns"`
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
	// GetMatchResults() runs the same aggregator the Matches view
	// consumes, so the "unknown" and "hidden" definitions stay in
	// lockstep with the UI.
	recs, err := a.GetMatchResults()
	if err != nil {
		return nil, fmt.Errorf("export bundle: aggregate: %w", err)
	}
	include := bundleIncludeSet(opts, recs)

	snap, err := a.store.LoadAll()
	if err != nil {
		return nil, fmt.Errorf("export bundle: load: %w", err)
	}
	rows := filterBundleRows(snap, include)
	screenshots := bundleScreenshotMap(rows)

	// Capture one `now` for every embedded entry so manifest's
	// `exported_at`, data.json's `exported_at`, and every ZIP
	// local-file-header mtime agree to the second.
	now := time.Now().UTC()
	exportedAt := now.Format(time.RFC3339)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	if err := writeBundleData(zw, rows, exportedAt, now); err != nil {
		return nil, err
	}
	// copyBundleScreenshots prunes the screenshots map to what actually
	// landed on disk, so the manifest (built next) stays consistent.
	if err := a.copyBundleScreenshots(zw, rows, snap, screenshots, now); err != nil {
		return nil, err
	}
	if err := writeBundleManifest(zw, opts, include, screenshots, exportedAt, now); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("export bundle: close zip: %w", err)
	}
	return buf.Bytes(), nil
}

// bundleIncludeSet builds the set of match_keys the bundle covers: the
// explicit keys plus (when toggled) every unknown / hidden match.
func bundleIncludeSet(opts ExportBundleOptions, recs []match.MatchRecord) map[string]struct{} {
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
	return include
}

// filterBundleRows keeps every parent row whose match_key is in the
// include set. Children flow with their parents (the db.SummaryRow / etc.
// structs embed HeroesPlayed and friends inline), so child tables don't
// need a separate walk.
func filterBundleRows(snap db.Screenshots, include map[string]struct{}) parentTables {
	keep := func(k string) bool {
		_, ok := include[k]
		return ok
	}
	return parentTables{
		summaries: filterRows(snap.Summaries, keep, func(r db.SummaryRow) string { return r.MatchKey }),
		teams:     filterRows(snap.Teams, keep, func(r db.TeamsRow) string { return r.MatchKey }),
		personals: filterRows(snap.Personals, keep, func(r db.PersonalRow) string { return r.MatchKey }),
		ranks:     filterRows(snap.Ranks, keep, func(r db.RankRow) string { return r.MatchKey }),
		unknowns:  filterRows(snap.Unknowns, keep, func(r db.UnknownRow) string { return r.MatchKey }),
	}
}

func addBundleScreenshots[T any](m map[string]string, rows []T, get func(T) (filename, key string)) {
	for _, r := range rows {
		f, k := get(r)
		m[f] = k
	}
}

// bundleScreenshotMap maps every included screenshot's filename to its
// match_key. Walking the filtered rows guarantees we only list files we
// actually copy into the bundle.
func bundleScreenshotMap(t parentTables) map[string]string {
	m := map[string]string{}
	addBundleScreenshots(m, t.summaries, func(r db.SummaryRow) (string, string) { return r.Filename, r.MatchKey })
	addBundleScreenshots(m, t.teams, func(r db.TeamsRow) (string, string) { return r.Filename, r.MatchKey })
	addBundleScreenshots(m, t.personals, func(r db.PersonalRow) (string, string) { return r.Filename, r.MatchKey })
	addBundleScreenshots(m, t.ranks, func(r db.RankRow) (string, string) { return r.Filename, r.MatchKey })
	addBundleScreenshots(m, t.unknowns, func(r db.UnknownRow) (string, string) { return r.Filename, r.MatchKey })
	return m
}

// writeBundleData writes data.json — a `recall-export/v1` payload
// restricted to the included matches, WITHOUT the screenshots_dirs path
// map. Stripping the map keeps the bundle free of the user's local
// filesystem path; restore via POST /api/v1/imports remaps every row's
// ScreenshotsDirID to 0 (use configured dir).
func writeBundleData(zw *zip.Writer, t parentTables, exportedAt string, now time.Time) error {
	dataDoc := BundleDataV1{
		Schema:        exportSchemaV1,
		ExportedAt:    exportedAt,
		RecallVersion: Version,
		Summaries:     t.summaries,
		Teams:         t.teams,
		Personals:     t.personals,
		Ranks:         t.ranks,
		Unknowns:      t.unknowns,
	}
	if err := bundleWriteJSON(zw, "data.json", dataDoc, now); err != nil {
		return fmt.Errorf("export bundle: write data.json: %w", err)
	}
	return nil
}

// copyBundleScreenshots writes screenshots/<filename> raw bytes off disk.
// Missing files are silently skipped and pruned from the `screenshots`
// map so the manifest stays consistent with what the ZIP contains.
func (a *App) copyBundleScreenshots(zw *zip.Writer, t parentTables, snap db.Screenshots, screenshots map[string]string, now time.Time) error {
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
		toFilesDirs(t.summaries, func(r db.SummaryRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(t.teams, func(r db.TeamsRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(t.personals, func(r db.PersonalRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(t.ranks, func(r db.RankRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(t.unknowns, func(r db.UnknownRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
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
				return fmt.Errorf("export bundle: read %s: %w", f.Filename, err)
			}
			if err := bundleWriteRaw(zw, "screenshots/"+f.Filename, body, now); err != nil {
				return fmt.Errorf("export bundle: write screenshot: %w", err)
			}
		}
	}
	return nil
}

// writeBundleManifest writes manifest.json — assembled AFTER the
// screenshots copy so its `screenshots` map reflects what actually landed
// in the ZIP.
func writeBundleManifest(zw *zip.Writer, opts ExportBundleOptions, include map[string]struct{}, screenshots map[string]string, exportedAt string, now time.Time) error {
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
		return fmt.Errorf("export bundle: write manifest: %w", err)
	}
	return nil
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
