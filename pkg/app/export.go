package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"recall/pkg/db"
)

// ErrImportMalformed wraps payload-level parse failures (not JSON or
// ZIP, JSON decode errors, ZIP-open failures). Handler maps to 400.
// Semantic-validation failures (unsupported schema, missing required
// field, write failures) are not wrapped and map to the default 409.
var ErrImportMalformed = errors.New("import: malformed payload")

// DataLocation surfaces the on-disk paths Recall uses for state.
// Shown in SettingsView's Directories section and returned by
// GET /api/v1/system/data-location.
type DataLocation struct {
	BaseDir        string `json:"base_dir"`        // <appDataDir>
	SettingsPath   string `json:"settings_path"`   // <baseDir>/settings.json
	DatabasePath   string `json:"database_path"`   // <baseDir>/db/recall.db
	ScreenshotsDir string `json:"screenshots_dir"` // currently-configured screenshots folder (may be "")
}

// GetDataLocation returns the on-disk paths the running app reads and
// writes. The base directory is the active profile's data dir
// (<RECALL_DATA_DIR>/profiles/<active>/); RECALL_DATA_DIR still drives
// the install root so the value the user sees in Settings matches
// what `bash scripts/db/db-where.sh` would inspect.
func (a *App) GetDataLocation() DataLocation {
	base := a.dataDir()
	return DataLocation{
		BaseDir:        base,
		SettingsPath:   a.settingsPath(),
		DatabasePath:   dbPath(base),
		ScreenshotsDir: a.settings.ScreenshotsDir,
	}
}

// dbPath mirrors the path NewSQLStore opens. Kept here so Settings can
// surface it without poking at internal app wiring.
func dbPath(base string) string {
	return base + "/db/recall.db"
}

// ────────────────────────────────────────────────────────────────────
// Export / import — local backup format. The wire shape is opaque to
// users (they download it as a .json blob and feed it back in later);
// versioned via the `schema` field so we can evolve the format
// without breaking older exports.
// ────────────────────────────────────────────────────────────────────

const exportSchemaV1 = "recall-export/v1"

// exportV1 is the wire format for `GET /api/v1/exports` and the Wails save
// dialog. Mirrors db.Screenshots with a metadata envelope; the
// screenshots_dirs map renders ids→paths so the import side can
// remap auto-increment ids without forcing the source DB's IDs onto
// the destination.
type exportV1 struct {
	Schema         string            `json:"schema"`
	ExportedAt     string            `json:"exported_at"`
	RecallVersion  string            `json:"recall_version"`
	ScreenshotsDir map[string]string `json:"screenshots_dirs"`
	Summaries      []db.SummaryRow   `json:"summaries"`
	Teams          []db.TeamsRow     `json:"teams"`
	Personals      []db.PersonalRow  `json:"personals"`
	Ranks          []db.RankRow      `json:"ranks"`
	Unknowns       []db.UnknownRow   `json:"unknowns"`
	// User-override + sidecar layer. Manual matches and inline edits live in
	// user_match_data, not the OCR parent tables; annotations, hidden flags, and
	// queue / play-mode overrides live in their own tables too. All must be
	// carried or a backup silently drops every hand-entered match + every edit.
	UserMatchData map[string]db.UserMatchData `json:"user_match_data,omitempty"`
	Annotations   map[string]db.Annotation    `json:"annotations,omitempty"`
	Hidden        []string                    `json:"hidden,omitempty"`
	Queues        map[string]string           `json:"queues,omitempty"`
	PlayModes     map[string]string           `json:"play_modes,omitempty"`
}

// ExportData snapshots the current store and returns the export
// payload as bytes. The Wails layer hands these bytes to a native
// save dialog; the HTTP layer streams them as a download.
func (a *App) ExportData() ([]byte, error) {
	snap, err := a.store.LoadAll()
	if err != nil {
		return nil, fmt.Errorf("export: load: %w", err)
	}
	ul, err := a.snapshotUserLayer()
	if err != nil {
		return nil, err
	}
	dirs := make(map[string]string, len(snap.ScreenshotsDirs))
	for id, path := range snap.ScreenshotsDirs {
		dirs[strconv.FormatInt(id, 10)] = path
	}
	doc := exportV1{
		Schema:         exportSchemaV1,
		ExportedAt:     time.Now().UTC().Format(time.RFC3339),
		RecallVersion:  Version,
		ScreenshotsDir: dirs,
		Summaries:      snap.Summaries,
		Teams:          snap.Teams,
		Personals:      snap.Personals,
		Ranks:          snap.Ranks,
		Unknowns:       snap.Unknowns,
		UserMatchData:  ul.userData,
		Annotations:    ul.annots,
		Hidden:         ul.hidden,
		Queues:         ul.queues,
		PlayModes:      ul.playModes,
	}
	return json.MarshalIndent(doc, "", "  ")
}

// userLayerExport bundles the override + sidecar tables for the export payload.
type userLayerExport struct {
	userData  map[string]db.UserMatchData
	annots    map[string]db.Annotation
	hidden    []string
	queues    map[string]string
	playModes map[string]string
}

// snapshotUserLayer loads the user-override + sidecar tables for export.
func (a *App) snapshotUserLayer() (userLayerExport, error) {
	userData, err := a.store.LoadAllUserMatchData()
	if err != nil {
		return userLayerExport{}, fmt.Errorf("export: load user data: %w", err)
	}
	annots, err := a.store.LoadAnnotations()
	if err != nil {
		return userLayerExport{}, fmt.Errorf("export: load annotations: %w", err)
	}
	hidden, err := a.store.LoadHiddenKeys()
	if err != nil {
		return userLayerExport{}, fmt.Errorf("export: load hidden: %w", err)
	}
	queues, err := a.store.LoadMatchQueues()
	if err != nil {
		return userLayerExport{}, fmt.Errorf("export: load queues: %w", err)
	}
	playModes, err := a.store.LoadMatchPlayModes()
	if err != nil {
		return userLayerExport{}, fmt.Errorf("export: load play modes: %w", err)
	}
	out := userLayerExport{
		userData:  userData,
		annots:    annots,
		hidden:    make([]string, 0, len(hidden)),
		queues:    make(map[string]string, len(queues)),
		playModes: make(map[string]string, len(playModes)),
	}
	for k := range hidden {
		out.hidden = append(out.hidden, k)
	}
	sort.Strings(out.hidden) // deterministic export ordering
	for k, q := range queues {
		out.queues[k] = q.QueueType
	}
	for k, pm := range playModes {
		out.playModes[k] = pm.PlayMode
	}
	return out, nil
}

// applyUserLayer writes the override + sidecar tables from an import payload.
// Runs after the parent rows + after the Clear in clearAndRemapDirs, so the
// destination starts empty.
func (a *App) applyUserLayer(doc exportV1) error {
	for _, d := range doc.UserMatchData {
		if err := a.store.UpsertUserMatchData(d); err != nil {
			return fmt.Errorf("import: user data %q: %w", d.MatchKey, err)
		}
	}
	for _, ann := range doc.Annotations {
		if err := a.store.SetAnnotation(ann); err != nil {
			return fmt.Errorf("import: annotation: %w", err)
		}
	}
	for _, k := range doc.Hidden {
		if err := a.store.HideMatch(k); err != nil {
			return fmt.Errorf("import: hidden %q: %w", k, err)
		}
	}
	for k, qt := range doc.Queues {
		if qt == "" {
			continue
		}
		if err := a.store.SetMatchQueue(k, qt); err != nil {
			return fmt.Errorf("import: queue %q: %w", k, err)
		}
	}
	for k, pm := range doc.PlayModes {
		if pm == "" {
			continue
		}
		if err := a.store.SetMatchPlayMode(k, pm); err != nil {
			return fmt.Errorf("import: play mode %q: %w", k, err)
		}
	}
	return nil
}

// ImportData replaces the entire local database with the contents of
// a previously-exported payload. Validates the schema version, runs
// every row write inside a fresh transaction-equivalent (Clear +
// re-Upsert), and remaps screenshots_dirs FKs so the destination DB's
// auto-increment ids don't collide with the source's.
//
// Accepts BOTH container formats:
//   - JSON envelope (single document — `recall-export/v1`)
//   - ZIP-of-CSVs (manifest.json + per-table .csv files inside)
//
// The format is detected from the payload's magic bytes (`{` vs
// `PK\x03\x04`); the caller doesn't need to pre-select.
//
// The operation is REPLACE, not MERGE — anything currently in the
// store is dropped before the import lands. The caller is expected to
// surface a confirmation step before invoking this.
func (a *App) ImportData(payload []byte) error {
	payload = stripBOM(payload)
	if looksLikeZIP(payload) {
		return a.importDataCSV(payload)
	}
	if !looksLikeJSON(payload) {
		return fmt.Errorf("%w: neither JSON nor a ZIP archive", ErrImportMalformed)
	}
	// Peek at just the schema field before committing to a full decode
	// so future versions can route through their own typed unmarshaller
	// instead of all converging on exportV1.
	var head struct {
		Schema string `json:"schema"`
	}
	if err := json.Unmarshal(payload, &head); err != nil {
		return fmt.Errorf("%w: decode: %v", ErrImportMalformed, err)
	}
	switch head.Schema {
	case exportSchemaV1:
		return a.importJSONv1(payload)
	default:
		return fmt.Errorf("import: unsupported schema %q (this build expects %q)", head.Schema, exportSchemaV1)
	}
}

// importJSONv1 decodes and applies a `recall-export/v1` payload. When a
// v2 ships, the dispatch in ImportData adds a sibling case + helper;
// each version stays decoupled and the v1 reader keeps loading the
// frozen v1 shape forever.
func (a *App) importJSONv1(payload []byte) error {
	var doc exportV1
	if err := json.Unmarshal(payload, &doc); err != nil {
		// Per-field type mismatches (out-of-int64 numbers, wrong
		// type on a struct field) are semantic validation failures
		// — the envelope decoded but a row didn't fit. Treat as
		// 409, not 400. Only the top-level schema-peek decode
		// (above) wraps `ErrImportMalformed`.
		return fmt.Errorf("import: decode: %w", err)
	}
	if err := validateImportFilenames(doc); err != nil {
		return err
	}
	remapID, err := a.clearAndRemapDirs("import", doc.ScreenshotsDir)
	if err != nil {
		return err
	}
	if err := importAllParentTables(a.store, "import", parentTables{
		summaries: doc.Summaries,
		teams:     doc.Teams,
		personals: doc.Personals,
		ranks:     doc.Ranks,
		unknowns:  doc.Unknowns,
	}, remapID); err != nil {
		return err
	}
	return a.applyUserLayer(doc)
}

// requireFilenames fails if any row has an empty filename — the UNIQUE
// upsert key on every parent table. Catches two real shapes of bad
// import: a hand-edited payload with a deleted filename, and a JSON
// `null` array entry (Go decodes `[null]` into `[zero-value struct]` for
// `[]Row`, a schema-violating shape schemathesis v4's
// negative_data_rejection catches). `table` is the plural array name for
// the error message.
func requireFilenames[T any](rows []T, table string, filename func(T) string) error {
	for i, r := range rows {
		if filename(r) == "" {
			return fmt.Errorf("import: %s[%d] missing required filename", table, i)
		}
	}
	return nil
}

func validateImportFilenames(doc exportV1) error {
	if err := requireFilenames(doc.Summaries, "summaries", func(r db.SummaryRow) string { return r.Filename }); err != nil {
		return err
	}
	if err := requireFilenames(doc.Teams, "teams", func(r db.TeamsRow) string { return r.Filename }); err != nil {
		return err
	}
	if err := requireFilenames(doc.Personals, "personals", func(r db.PersonalRow) string { return r.Filename }); err != nil {
		return err
	}
	if err := requireFilenames(doc.Ranks, "ranks", func(r db.RankRow) string { return r.Filename }); err != nil {
		return err
	}
	return requireFilenames(doc.Unknowns, "unknowns", func(r db.UnknownRow) string { return r.Filename })
}

// clearAndRemapDirs wipes the store and returns a source-id →
// destination-id remap for screenshots_dirs FKs. The pre-Clear pass
// validates every id string + registers the dirs so a malformed id fails
// BEFORE the destructive Clear; the post-Clear pass rebuilds the remap
// against the fresh (auto-increment-reset) destination ids. prefix
// ("import" / "import csv") namespaces the error messages so the JSON and
// CSV restore paths share one implementation.
func (a *App) clearAndRemapDirs(prefix string, dirs map[string]string) (func(int64) int64, error) {
	// Pre-Clear validation pass: parse each id + ensure the dir so a bad
	// id or registration failure aborts without wiping the store. The
	// ids registered here are wiped by Clear and rebuilt below.
	for srcIDStr, path := range dirs {
		if _, err := strconv.ParseInt(srcIDStr, 10, 64); err != nil {
			return nil, fmt.Errorf("%s: invalid screenshots_dir id %q: %w", prefix, srcIDStr, err)
		}
		if _, err := a.store.EnsureScreenshotsDir(path); err != nil {
			return nil, fmt.Errorf("%s: register dir %q: %w", prefix, path, err)
		}
	}

	if err := a.store.Clear(); err != nil {
		return nil, fmt.Errorf("%s: clear: %w", prefix, err)
	}

	// Re-register dirs after Clear (Clear wipes screenshots_dirs too)
	// and rebuild the remap from the post-clear ids. Source ids might
	// now map to a different destination set since auto-increment
	// resets aren't guaranteed.
	remap := make(map[int64]int64, len(dirs))
	for srcIDStr, path := range dirs {
		srcID, _ := strconv.ParseInt(srcIDStr, 10, 64)
		dstID, err := a.store.EnsureScreenshotsDir(path)
		if err != nil {
			return nil, fmt.Errorf("%s: re-register dir %q: %w", prefix, path, err)
		}
		remap[srcID] = dstID
	}

	return func(srcID int64) int64 {
		if srcID == 0 {
			return db.SentinelScreenshotsDirID
		}
		if dstID, ok := remap[srcID]; ok {
			return dstID
		}
		// Unknown source id (orphan FK in the export) — point at the
		// sentinel row rather than fail the whole import. The
		// `screenshots_dir_id` column is `NOT NULL` so we can't drop
		// it; the sentinel is the documented "unset" target.
		return db.SentinelScreenshotsDirID
	}, nil
}

// importParentRows upserts each row with a fresh primary key (ID=0) and a
// remapped screenshots_dir id. `prefix` ("import" / "import csv") + the
// singular `table` name form the error message — shared by both the JSON
// and the CSV import paths.
func importParentRows[T any](rows []T, prefix, table string, filename func(T) string, prep func(*T), upsert func(T) error) error {
	for i := range rows {
		r := rows[i]
		prep(&r)
		if err := upsert(r); err != nil {
			return fmt.Errorf("%s: %s %q: %w", prefix, table, filename(r), err)
		}
	}
	return nil
}

// importAllParentTables upserts every parent table from the decoded
// payload, remapping screenshots_dir ids. Shared by importJSONv1 and
// importDataCSV via the per-table slices; `prefix` keeps each path's error
// wording.
func importAllParentTables(store db.Store, prefix string, t parentTables, remapID func(int64) int64) error {
	if err := importParentRows(t.summaries, prefix, "summary",
		func(r db.SummaryRow) string { return r.Filename },
		func(r *db.SummaryRow) { r.ID = 0; r.ScreenshotsDirID = remapID(r.ScreenshotsDirID) },
		store.UpsertSummary); err != nil {
		return err
	}
	if err := importParentRows(t.teams, prefix, "teams",
		func(r db.TeamsRow) string { return r.Filename },
		func(r *db.TeamsRow) { r.ID = 0; r.ScreenshotsDirID = remapID(r.ScreenshotsDirID) },
		store.UpsertTeams); err != nil {
		return err
	}
	if err := importParentRows(t.personals, prefix, "personal",
		func(r db.PersonalRow) string { return r.Filename },
		func(r *db.PersonalRow) { r.ID = 0; r.ScreenshotsDirID = remapID(r.ScreenshotsDirID) },
		store.UpsertPersonal); err != nil {
		return err
	}
	if err := importParentRows(t.ranks, prefix, "rank",
		func(r db.RankRow) string { return r.Filename },
		func(r *db.RankRow) { r.ID = 0; r.ScreenshotsDirID = remapID(r.ScreenshotsDirID) },
		store.UpsertRank); err != nil {
		return err
	}
	return importParentRows(t.unknowns, prefix, "unknown",
		func(r db.UnknownRow) string { return r.Filename },
		func(r *db.UnknownRow) { r.ID = 0; r.ScreenshotsDirID = remapID(r.ScreenshotsDirID) },
		store.UpsertUnknown)
}

// parentTables bundles the five parent-row slices both import paths upsert.
type parentTables struct {
	summaries []db.SummaryRow
	teams     []db.TeamsRow
	personals []db.PersonalRow
	ranks     []db.RankRow
	unknowns  []db.UnknownRow
}
