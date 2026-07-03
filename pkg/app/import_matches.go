package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	"recall/pkg/db"
)

// ErrImportMalformed wraps payload-level parse failures (not a ZIP, zip-open
// failure, missing/undecodable manifest or data.json). The HTTP handler maps
// it to 400. Semantic-validation failures (unsupported schema, write failures)
// are not wrapped and map to the default 409.
var ErrImportMalformed = errors.New("import: malformed payload")

// ImportSummary reports the outcome of a merge import: how many matches were
// added and how many were skipped because their match_key already existed.
type ImportSummary struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
}

// MatchImportResult is the Wails LoadMatchImportFromFile return: the dialog
// path the user picked (empty on cancel) plus the merge counts so the UI can
// report "Added N, skipped M" without a second round-trip.
type MatchImportResult struct {
	Path     string `json:"path"`
	Imported int    `json:"imported"`
	Skipped  int    `json:"skipped"`
}

// ImportMatches merges a `recall-bundle/v1` ZIP into the existing database
// WITHOUT clearing it. It reads the bundle's data.json (ignoring the embedded
// screenshot bytes — data-only), skips any incoming match whose match_key
// already exists locally, and upserts the rest. Every imported row's
// screenshots-dir reference collapses to the sentinel, mirroring the way the
// bundle export strips filesystem paths.
//
// A v2 data.json also carries the user layer — inline edits, manual matches,
// annotations, review / queue / play-mode state, hidden flags — which imports
// under the same skip-existing rule: an incoming key you already have is
// skipped wholesale, so a merge can never clobber local edits. v1 bundles
// (builds ≤0.22.x) simply have no user layer to import.
func (a *App) ImportMatches(payload []byte) (ImportSummary, error) {
	payload = stripBOM(payload)
	if !looksLikeZIP(payload) {
		return ImportSummary{}, fmt.Errorf("%w: expected a Recall bundle (.zip)", ErrImportMalformed)
	}
	data, err := readBundleData(payload)
	if err != nil {
		return ImportSummary{}, err
	}
	incoming := parentTables{
		summaries: data.Summaries,
		teams:     data.Teams,
		personals: data.Personals,
		ranks:     data.Ranks,
		unknowns:  data.Unknowns,
	}
	if err := validateParentFilenames(incoming); err != nil {
		return ImportSummary{}, err
	}

	existing, err := a.existingMatchKeys()
	if err != nil {
		return ImportSummary{}, err
	}
	fresh, imported, skipped := partitionByMatchKey(incoming, existing)

	toSentinel := func(int64) int64 { return db.SentinelScreenshotsDirID }
	if err := importAllParentTables(a.store, "import", fresh, toSentinel); err != nil {
		return ImportSummary{}, err
	}
	manualImported, err := a.importUserLayer(data, existing)
	if err != nil {
		return ImportSummary{}, err
	}
	return ImportSummary{Imported: len(imported) + manualImported, Skipped: len(skipped)}, nil
}

// importUserLayer writes the v2 user-layer sections for keys not already
// present locally (the same skip-existing rule the parent rows follow).
// Returns how many MANUAL matches it imported — keys that exist only in
// the user layer, which the parent-row partition can't count.
func (a *App) importUserLayer(data BundleDataV2, existing map[string]struct{}) (int, error) {
	skip := func(k string) bool {
		_, ok := existing[k]
		return ok
	}
	incomingParents := map[string]struct{}{}
	for k := range dataMatchKeys(BundleDataV2{
		Summaries: data.Summaries, Teams: data.Teams, Personals: data.Personals,
		Ranks: data.Ranks, Unknowns: data.Unknowns,
	}) {
		incomingParents[k] = struct{}{}
	}
	manual := 0
	for _, ud := range data.UserMatchData {
		if skip(ud.MatchKey) {
			continue
		}
		if err := a.store.UpsertUserMatchData(ud); err != nil {
			return 0, fmt.Errorf("import: user data for %q: %w", ud.MatchKey, err)
		}
		if _, hasParents := incomingParents[ud.MatchKey]; !hasParents {
			manual++
		}
	}
	for _, ann := range data.Annotations {
		if skip(ann.MatchKey) {
			continue
		}
		if err := a.store.SetAnnotation(ann); err != nil {
			return 0, fmt.Errorf("import: annotation for %q: %w", ann.MatchKey, err)
		}
	}
	for k, r := range data.Reviews {
		if skip(k) || r.ReviewedBy == "" {
			continue
		}
		if err := a.store.SetReview(k, r.ReviewedBy); err != nil {
			return 0, fmt.Errorf("import: review for %q: %w", k, err)
		}
	}
	for k, q := range data.Queues {
		if skip(k) || q.QueueType == "" {
			continue
		}
		if err := a.store.SetMatchQueue(k, q.QueueType); err != nil {
			return 0, fmt.Errorf("import: queue for %q: %w", k, err)
		}
	}
	for k, pm := range data.PlayModes {
		if skip(k) || pm.PlayMode == "" {
			continue
		}
		if err := a.store.SetMatchPlayMode(k, pm.PlayMode); err != nil {
			return 0, fmt.Errorf("import: play mode for %q: %w", k, err)
		}
	}
	for _, k := range data.Hidden {
		if skip(k) {
			continue
		}
		if err := a.store.HideMatch(k); err != nil {
			return 0, fmt.Errorf("import: hidden flag for %q: %w", k, err)
		}
	}
	return manual, nil
}

// readBundleData extracts and validates the data.json out of a bundle ZIP. A
// payload that isn't a readable bundle wraps ErrImportMalformed (→ 400); a
// readable-but-wrong-schema bundle is a plain error (→ 409).
func readBundleData(payload []byte) (BundleDataV2, error) {
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return BundleDataV2{}, fmt.Errorf("%w: open zip: %w", ErrImportMalformed, err)
	}
	manifestBytes, err := readZipFile(zr, "manifest.json")
	if err != nil {
		return BundleDataV2{}, fmt.Errorf("%w: missing manifest.json: %w", ErrImportMalformed, err)
	}
	var mf struct {
		Schema string `json:"schema"`
	}
	if err := json.Unmarshal(manifestBytes, &mf); err != nil {
		return BundleDataV2{}, fmt.Errorf("%w: manifest decode: %w", ErrImportMalformed, err)
	}
	if mf.Schema != BundleSchemaV1 {
		return BundleDataV2{}, fmt.Errorf("import: unsupported bundle schema %q (this build expects %q)", mf.Schema, BundleSchemaV1)
	}
	dataBytes, err := readZipFile(zr, "data.json")
	if err != nil {
		return BundleDataV2{}, fmt.Errorf("%w: missing data.json: %w", ErrImportMalformed, err)
	}
	var data BundleDataV2
	if err := json.Unmarshal(dataBytes, &data); err != nil {
		return BundleDataV2{}, fmt.Errorf("import: data.json decode: %w", err)
	}
	if data.Schema != exportSchemaV1 && data.Schema != exportSchemaV2 {
		return BundleDataV2{}, fmt.Errorf("import: unsupported data schema %q (this build accepts %q and %q)", data.Schema, exportSchemaV1, exportSchemaV2)
	}
	return data, nil
}

// existingMatchKeys collects every match_key already present — across the five
// OCR parent tables and the user-data layer (manual matches live only there) —
// so the merge can skip collisions.
func (a *App) existingMatchKeys() (map[string]struct{}, error) {
	snap, err := a.store.LoadAll()
	if err != nil {
		return nil, fmt.Errorf("import: load existing: %w", err)
	}
	keys := make(map[string]struct{})
	for _, r := range snap.Summaries {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range snap.Teams {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range snap.Personals {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range snap.Ranks {
		keys[r.MatchKey] = struct{}{}
	}
	for _, r := range snap.Unknowns {
		keys[r.MatchKey] = struct{}{}
	}
	userData, err := a.store.LoadAllUserMatchData()
	if err != nil {
		return nil, fmt.Errorf("import: load user data: %w", err)
	}
	for k := range userData {
		keys[k] = struct{}{}
	}
	return keys, nil
}

// partitionByMatchKey splits incoming parent rows into the subset whose
// match_key is new (kept) versus already-present (dropped), and returns the
// distinct imported / skipped key sets so the caller can report counts.
func partitionByMatchKey(t parentTables, existing map[string]struct{}) (fresh parentTables, imported, skipped map[string]struct{}) {
	imported = make(map[string]struct{})
	skipped = make(map[string]struct{})
	keep := func(matchKey string) bool {
		if _, ok := existing[matchKey]; ok {
			skipped[matchKey] = struct{}{}
			return false
		}
		imported[matchKey] = struct{}{}
		return true
	}
	fresh = parentTables{
		summaries: filterRows(t.summaries, keep, func(r db.SummaryRow) string { return r.MatchKey }),
		teams:     filterRows(t.teams, keep, func(r db.TeamsRow) string { return r.MatchKey }),
		personals: filterRows(t.personals, keep, func(r db.PersonalRow) string { return r.MatchKey }),
		ranks:     filterRows(t.ranks, keep, func(r db.RankRow) string { return r.MatchKey }),
		unknowns:  filterRows(t.unknowns, keep, func(r db.UnknownRow) string { return r.MatchKey }),
	}
	return fresh, imported, skipped
}

// validateParentFilenames fails if any incoming parent row has an empty
// filename — the UNIQUE upsert key every parent table relies on.
func validateParentFilenames(t parentTables) error {
	if err := requireFilenames(t.summaries, "summaries", func(r db.SummaryRow) string { return r.Filename }); err != nil {
		return err
	}
	if err := requireFilenames(t.teams, "teams", func(r db.TeamsRow) string { return r.Filename }); err != nil {
		return err
	}
	if err := requireFilenames(t.personals, "personals", func(r db.PersonalRow) string { return r.Filename }); err != nil {
		return err
	}
	if err := requireFilenames(t.ranks, "ranks", func(r db.RankRow) string { return r.Filename }); err != nil {
		return err
	}
	return requireFilenames(t.unknowns, "unknowns", func(r db.UnknownRow) string { return r.Filename })
}

// requireFilenames fails if any row has an empty filename — the UNIQUE upsert
// key on every parent table. Catches a hand-edited payload with a deleted
// filename and a JSON `null` array entry (Go decodes `[null]` into a
// zero-value struct). `table` is the plural array name for the error message.
func requireFilenames[T any](rows []T, table string, filename func(T) string) error {
	for i, r := range rows {
		if filename(r) == "" {
			return fmt.Errorf("import: %s[%d] missing required filename", table, i)
		}
	}
	return nil
}

// importParentRows upserts each row with a fresh primary key (ID=0) and a
// remapped screenshots_dir id. `prefix` + the singular `table` name form the
// error message.
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

// importAllParentTables upserts every parent table, remapping screenshots_dir
// ids. Shared by the merge import; `prefix` namespaces the error wording.
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

// parentTables bundles the five parent-row slices the import path upserts.
type parentTables struct {
	summaries []db.SummaryRow
	teams     []db.TeamsRow
	personals []db.PersonalRow
	ranks     []db.RankRow
	unknowns  []db.UnknownRow
}
