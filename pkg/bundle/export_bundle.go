package bundle

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

// exportSchemaV1 is the original data.json wire schema: OCR parent rows
// only. Bundles from builds ≤0.22.x carry it; the import path still
// accepts it (their user-layer sections read as empty).
const exportSchemaV1 = "recall-export/v1"

// exportSchemaV2 adds the user layer — inline edits + manual matches
// (user_match_data with children), annotations, review / queue /
// play-mode state, and the hidden + pinned flags — so an export→import
// round trip preserves every hand-entered correction, and a shared
// bundle carries the sharer's notes and manual entries.
//
// Every user-layer field is `omitempty`, so a section added after this
// constant was minted (pinned, coach_notes) is simply absent from older
// bundles and reads back as "none" — which is why the schema string, and
// BundleSchemaV1 with it, stay put when the layer grows.
const exportSchemaV2 = "recall-export/v2"

// exportSchemaV3 marks a bundle whose rank rows can distinguish "the screenshot
// did not report this" from a real reading of 0.
//
// The version exists because db.RankRow carries no json tags, so a v1/v2 bundle
// serialized the Go field names with plain ints: every rank row wrote
// "RankProgress":0,"ChangePercent":0, including the ones that stored 0 only
// because the caption was never read. Deserializing that into the pointers
// those fields are now would turn each fabricated zero into a confident
// measurement — precisely the carry-forward the store refuses to open an old
// database to prevent. An importer cannot tell the two apart in a v1/v2
// payload, so it drops both to nil; this version is how it knows to.
const exportSchemaV3 = "recall-export/v3"

// BundleSchemaV1 is the wire-schema identifier the bundle's
// manifest carries. Bumping the constant is a breaking change to
// the bundle layout; the inner `data.json` keeps `exportSchemaV1`
// because it IS the existing v1 JSON export shape — the bundle
// just wraps a sanitized variant alongside the screenshot bytes.
// Exported so cmd/bug-finder can validate by-version.
const BundleSchemaV1 = "recall-bundle/v1"

// ManifestV1 is the on-disk shape of the bundle's
// `manifest.json`. Captures provenance + the screenshot ↔ match_key
// mapping for sanity-checking after restore. Exported so
// cmd/bug-finder can deserialize without redefining the schema.
//
// Player is present only on a bundle shared for coaching (see
// PlayerIdentity); it lives on the envelope, not in data.json, so the
// row payload a merge import consumes is identical either way. Added
// under `omitempty` after BundleSchemaV1 was minted — the same
// no-bump precedent as data.json's user-layer sections — so older
// bundles read back with a nil Player.
type ManifestV1 struct {
	Schema          string            `json:"schema"`
	ExportedAt      string            `json:"exported_at"`
	RecallVersion   string            `json:"recall_version"`
	MatchCount      int               `json:"match_count"`
	ScreenshotCount int               `json:"screenshot_count"`
	IncludeUnknown  bool              `json:"include_unknown"`
	IncludeHidden   bool              `json:"include_hidden"`
	Screenshots     map[string]string `json:"screenshots"`
	Player          *PlayerIdentity   `json:"player,omitempty"`
}

// DataV2 is the on-disk shape of the bundle's `data.json`. The five
// OCR row tables plus the user layer (v2 additions); it DOES NOT carry
// the screenshots_dirs map — those paths leak the user's filesystem. On
// restore via `POST /api/v1/imports`, the rows' `ScreenshotsDirID`
// references remap to 0 (use configured dir) because no entries in the
// screenshots_dirs envelope mean an empty remap table.
//
// A v1 payload unmarshals into this struct with empty user-layer
// sections — the OCR field names are unchanged — so the import path
// handles both schemas through one type.
type DataV2 struct {
	Schema        string           `json:"schema"`
	ExportedAt    string           `json:"exported_at"`
	RecallVersion string           `json:"recall_version"`
	Summaries     []db.SummaryRow  `json:"summaries"`
	Teams         []db.TeamsRow    `json:"teams"`
	Personals     []db.PersonalRow `json:"personals"`
	Ranks         []db.RankRow     `json:"ranks"`
	Unknowns      []db.UnknownRow  `json:"unknowns"`
	// User layer — schema v2. Slices sort by match_key so the emitted
	// JSON is deterministic; maps key by match_key (Go marshals map
	// keys sorted). A manual match is a UserMatchData entry whose key
	// has no row in any OCR table above.
	UserMatchData []db.UserMatchData          `json:"user_match_data,omitempty"`
	Annotations   []db.Annotation             `json:"annotations,omitempty"`
	Reviews       map[string]db.ReviewState   `json:"reviews,omitempty"`
	Queues        map[string]db.QueueState    `json:"queues,omitempty"`
	PlayModes     map[string]db.PlayModeState `json:"play_modes,omitempty"`
	Hidden        []string                    `json:"hidden,omitempty"`
	Pinned        []string                    `json:"pinned,omitempty"`
	// CoachNotes is the coach-RECEIVED layer — blocks another coach wrote
	// that this user accepted onto their own matches. Sorted by
	// (match_key, note_id).
	CoachNotes []db.MatchCoachNote `json:"coach_notes,omitempty"`
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
	// IncludeUnknown adds every record whose `data.map` is empty. That
	// is a SUPERSET of the Unknown tab's count, which also excludes
	// ambiguous records — an unattributed screenshot with no map rides
	// in on this toggle. Additive only: a real match whose map OCR
	// failed still exports when this is off, provided it's in MatchKeys.
	IncludeUnknown bool
	// IncludeHidden adds every record currently in `hidden_matches`.
	IncludeHidden bool
	// Player switches the export to share mode: the identity is validated
	// and written into the manifest so a coach opening the bundle sees who
	// it is about, and Import refuses to merge it. nil is a plain export.
	Player *PlayerIdentity
}

// ExportBundle produces a `.zip` payload containing:
//
//   - manifest.json   — `recall-bundle/v1` envelope with the
//     screenshot → match_key mapping for
//     sanity-checking restore.
//   - data.json       — the `recall-export/v2` shape: OCR rows + the
//     user layer, restricted to the included
//     matches. The bundle restores via the existing
//     `POST /api/v1/imports` path.
//   - screenshots/*   — every source file referenced by an included
//     row. A missing-on-disk file is silently
//     skipped (the row still ships in data.json
//     so the restore can re-parse later).
//
// The bundle never streams to disk — it's built in-memory and
// returned. The HTTP server uses the bytes as the response body;
// Wails mode threads them into a SaveFileDialog → os.WriteFile.
//
// With opts.Player set the export is a "share with a coach" bundle:
// the identity is validated (ErrPlayerIdentityInvalid) and written
// into the manifest, and Import refuses to merge the result.
func Export(store db.Store, opts ExportBundleOptions, recs []match.Record, screenshotsDir, version string) ([]byte, error) {
	opts, err := normalizeShareOptions(opts)
	if err != nil {
		return nil, err
	}
	// recs come from the shell's GetMatchResults() — the same
	// aggregator the Matches view consumes, so "hidden" means exactly
	// what the UI means by it (see IncludeUnknown for why the unknown
	// bucket is wider than the tab of the same name).
	include := bundleIncludeSet(opts, recs)

	snap, err := store.LoadAll()
	if err != nil {
		return nil, fmt.Errorf("export bundle: load: %w", err)
	}
	rows := filterBundleRows(snap, include)
	screenshots := bundleScreenshotMap(rows)
	user, err := loadBundleUserLayer(store, include)
	if err != nil {
		return nil, err
	}

	// Capture one `now` for every embedded entry so manifest's
	// `exported_at`, data.json's `exported_at`, and every ZIP
	// local-file-header mtime agree to the second.
	now := time.Now().UTC()
	exportedAt := now.Format(time.RFC3339)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	if err := writeBundleData(zw, rows, user, exportedAt, version, now); err != nil {
		return nil, err
	}
	// copyBundleScreenshots prunes the screenshots map to what actually
	// landed on disk, so the manifest (built next) stays consistent.
	if err := copyBundleScreenshots(zw, rows, snap, screenshots, screenshotsDir, now); err != nil {
		return nil, err
	}
	if err := writeBundleManifest(zw, opts, include, screenshots, exportedAt, version, now); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("export bundle: close zip: %w", err)
	}
	return buf.Bytes(), nil
}

// normalizeShareOptions validates a share-mode identity and returns the
// options carrying the trimmed copy Export writes into the manifest; a
// plain export (no Player) passes through untouched. Runs before any store
// read so a bad identity fails fast.
func normalizeShareOptions(opts ExportBundleOptions) (ExportBundleOptions, error) {
	if opts.Player == nil {
		return opts, nil
	}
	player, err := normalizePlayerIdentity(*opts.Player)
	if err != nil {
		return ExportBundleOptions{}, err
	}
	opts.Player = &player
	return opts, nil
}

// bundleIncludeSet builds the set of match_keys the bundle covers: the
// explicit keys plus (when toggled) every unknown / hidden match.
func bundleIncludeSet(opts ExportBundleOptions, recs []match.Record) map[string]struct{} {
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

// writeBundleData writes data.json — a `recall-export/v2` payload
// restricted to the included matches, WITHOUT the screenshots_dirs path
// map. Stripping the map keeps the bundle free of the user's local
// filesystem path; restore via POST /api/v1/imports remaps every row's
// ScreenshotsDirID to 0 (use configured dir).
func writeBundleData(zw *zip.Writer, t parentTables, user bundleUserLayer, exportedAt, version string, now time.Time) error {
	dataDoc := DataV2{
		Schema:        exportSchemaV3,
		ExportedAt:    exportedAt,
		RecallVersion: version,
		Summaries:     t.summaries,
		Teams:         t.teams,
		Personals:     t.personals,
		Ranks:         t.ranks,
		Unknowns:      t.unknowns,
		UserMatchData: user.userData,
		Annotations:   user.annotations,
		Reviews:       user.reviews,
		Queues:        user.queues,
		PlayModes:     user.playModes,
		Hidden:        user.hidden,
		Pinned:        user.pinned,
		CoachNotes:    user.coachNotes,
	}
	if err := bundleWriteJSON(zw, "data.json", dataDoc, now); err != nil {
		return fmt.Errorf("export bundle: write data.json: %w", err)
	}
	return nil
}

// copyBundleScreenshots writes screenshots/<filename> raw bytes off disk.
// Missing files are silently skipped and pruned from the `screenshots`
// map so the manifest stays consistent with what the ZIP contains.
func copyBundleScreenshots(zw *zip.Writer, t parentTables, snap db.Screenshots, screenshots map[string]string, screenshotsDir string, now time.Time) error {
	for _, batch := range [][]fileDir{
		toFilesDirs(t.summaries, func(r db.SummaryRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(t.teams, func(r db.TeamsRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(t.personals, func(r db.PersonalRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(t.ranks, func(r db.RankRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
		toFilesDirs(t.unknowns, func(r db.UnknownRow) (string, int64) { return r.Filename, r.ScreenshotsDirID }),
	} {
		for _, f := range batch {
			dir := bundleDirForRow(snap, screenshotsDir, f.DirID)
			if err := copyBundleScreenshot(zw, dir, f.Filename, screenshots, now); err != nil {
				return err
			}
		}
	}
	return nil
}

// bundleDirForRow resolves a row's screenshots_dirs id to an on-disk
// path; dir-id 0 / unknown ids fall back to the live screenshots folder
// (same rule the screenshot handler uses for unparsed-watch files).
func bundleDirForRow(snap db.Screenshots, screenshotsDir string, dirID int64) string {
	if dirID > 0 {
		if p, ok := snap.ScreenshotsDirs[dirID]; ok && p != "" {
			return p
		}
	}
	return screenshotsDir
}

// copyBundleScreenshot writes one screenshot's raw bytes into the ZIP,
// pruning the manifest's `screenshots` entry when the dir is unknown or
// the file has vanished from disk.
func copyBundleScreenshot(zw *zip.Writer, dir, filename string, screenshots map[string]string, now time.Time) error {
	if dir == "" {
		delete(screenshots, filename)
		return nil
	}
	// #nosec G304 -- filename comes from the per-screenshot
	// rows the parser inserted; the validator on the
	// screenshots-folder setter (validateScreenshotsDir) caps
	// the dir to a sandboxed user path, and the basename was
	// produced by the parser, not user input.
	body, err := os.ReadFile(filepath.Join(dir, filename))
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			delete(screenshots, filename)
			return nil
		}
		return fmt.Errorf("export bundle: read %s: %w", filename, err)
	}
	if err := bundleWriteRaw(zw, "screenshots/"+filename, body, now); err != nil {
		return fmt.Errorf("export bundle: write screenshot: %w", err)
	}
	return nil
}

// writeBundleManifest writes manifest.json — assembled AFTER the
// screenshots copy so its `screenshots` map reflects what actually landed
// in the ZIP.
func writeBundleManifest(zw *zip.Writer, opts ExportBundleOptions, include map[string]struct{}, screenshots map[string]string, exportedAt, version string, now time.Time) error {
	mf := ManifestV1{
		Schema:          BundleSchemaV1,
		ExportedAt:      exportedAt,
		RecallVersion:   version,
		MatchCount:      len(include),
		ScreenshotCount: len(screenshots),
		IncludeUnknown:  opts.IncludeUnknown,
		IncludeHidden:   opts.IncludeHidden,
		Screenshots:     screenshots,
		Player:          opts.Player,
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

// fileDir is one screenshot's (filename, dir-id) pair as consumed by the
// bundle's screenshot-copy loop.
type fileDir struct {
	Filename string
	DirID    int64
}

// toFilesDirs collapses a typed parent-row slice into the
// per-screenshot (filename, dir-id) pairs the bundle's screenshot-
// copy loop consumes. Stable order — sorted by filename — so the
// in-memory bundle bytes are deterministic across runs.
func toFilesDirs[T any](rows []T, get func(T) (string, int64)) []fileDir {
	out := make([]fileDir, 0, len(rows))
	for _, r := range rows {
		name, dirID := get(r)
		if name == "" {
			continue
		}
		out = append(out, fileDir{name, dirID})
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

// supportedExportSchema reports whether this build can read a data.json of that
// vintage. One list, so the validator and the reader can never disagree about
// what is importable.
func supportedExportSchema(schema string) bool {
	switch schema {
	case exportSchemaV1, exportSchemaV2, exportSchemaV3:
		return true
	default:
		return false
	}
}

// dropPreV3RankReadings clears the rank readings a pre-v3 bundle cannot express
// honestly. Those payloads wrote 0 both for "the meter did not move" and for
// "the caption never read", so every value is suspect; nil says the bundle did
// not report it, which is the only true statement available. Re-parsing the
// screenshots is what recovers the real numbers.
func dropPreV3RankReadings(schema string, ranks []db.RankRow) []db.RankRow {
	if schema == exportSchemaV3 {
		return ranks
	}
	out := make([]db.RankRow, len(ranks))
	copy(out, ranks)
	for i := range out {
		out[i].RankProgress = nil
		out[i].ChangePercent = nil
	}
	return out
}
