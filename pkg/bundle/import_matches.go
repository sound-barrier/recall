package bundle

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
func Import(store db.Store, payload []byte) (ImportSummary, error) {
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

	existing, err := existingMatchKeys(store)
	if err != nil {
		return ImportSummary{}, err
	}
	fresh := partitionByMatchKey(incoming, existing)

	toSentinel := func(int64) int64 { return db.SentinelScreenshotsDirID }
	if err := importAllParentTables(store, "import", fresh, toSentinel); err != nil {
		return ImportSummary{}, err
	}
	if err := importUserLayer(store, data, existing); err != nil {
		return ImportSummary{}, err
	}
	return summarizeImport(data, existing), nil
}

// summarizeImport counts every distinct match_key the bundle carries — parent
// rows AND user-layer-only (manual) keys — against what the database already
// had. Counting the key set rather than the rows written is what keeps the two
// counters symmetric: a manual match lands in exactly one of them, so
// re-importing a bundle of hand-entered matches reports them as skipped instead
// of vanishing from both totals.
func summarizeImport(data DataV2, existing map[string]struct{}) ImportSummary {
	var summary ImportSummary
	for key := range dataMatchKeys(data) {
		if _, ok := existing[key]; ok {
			summary.Skipped++
			continue
		}
		summary.Imported++
	}
	return summary
}

// importUserLayer writes the v2 user-layer sections for keys not already
// present locally (the same skip-existing rule the parent rows follow).
func importUserLayer(store db.Store, data DataV2, existing map[string]struct{}) error {
	if err := importUserMatchData(store, data.UserMatchData, existing); err != nil {
		return err
	}
	if err := importAnnotations(store, data.Annotations, existing); err != nil {
		return err
	}
	if err := importKeyedSection(data.Reviews, existing, "review",
		func(r db.ReviewState) string { return r.ReviewedBy }, store.SetReview); err != nil {
		return err
	}
	if err := importKeyedSection(data.Queues, existing, "queue",
		func(q db.QueueState) string { return q.QueueType }, store.SetMatchQueue); err != nil {
		return err
	}
	if err := importKeyedSection(data.PlayModes, existing, "play mode",
		func(pm db.PlayModeState) string { return pm.PlayMode }, store.SetMatchPlayMode); err != nil {
		return err
	}
	return importHidden(store, data.Hidden, existing)
}

// importUserMatchData upserts the incoming user-data rows whose keys are new.
func importUserMatchData(store db.Store, rows []db.UserMatchData, existing map[string]struct{}) error {
	for _, ud := range rows {
		if _, ok := existing[ud.MatchKey]; ok {
			continue
		}
		if err := store.UpsertUserMatchData(ud); err != nil {
			return fmt.Errorf("import: user data for %q: %w", ud.MatchKey, err)
		}
	}
	return nil
}

// importAnnotations writes the incoming annotations whose keys are new.
func importAnnotations(store db.Store, annotations []db.Annotation, existing map[string]struct{}) error {
	for _, ann := range annotations {
		if _, ok := existing[ann.MatchKey]; ok {
			continue
		}
		if err := store.SetAnnotation(ann); err != nil {
			return fmt.Errorf("import: annotation for %q: %w", ann.MatchKey, err)
		}
	}
	return nil
}

// importKeyedSection writes one map-shaped user-layer section (reviews /
// queues / play modes), skipping existing keys and entries whose value
// is empty. `section` names the section in the error message.
func importKeyedSection[T any](m map[string]T, existing map[string]struct{}, section string, value func(T) string, set func(key, val string) error) error {
	for k, v := range m {
		if _, ok := existing[k]; ok {
			continue
		}
		val := value(v)
		if val == "" {
			continue
		}
		if err := set(k, val); err != nil {
			return fmt.Errorf("import: %s for %q: %w", section, k, err)
		}
	}
	return nil
}

// importHidden hides the incoming soft-deleted keys that are new.
func importHidden(store db.Store, hidden []string, existing map[string]struct{}) error {
	for _, k := range hidden {
		if _, ok := existing[k]; ok {
			continue
		}
		if err := store.HideMatch(k); err != nil {
			return fmt.Errorf("import: hidden flag for %q: %w", k, err)
		}
	}
	return nil
}

// readBundleData extracts and validates the data.json out of a bundle ZIP. A
// payload that isn't a readable bundle wraps ErrImportMalformed (→ 400); a
// readable-but-wrong-schema bundle is a plain error (→ 409).
func readBundleData(payload []byte) (DataV2, error) {
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return DataV2{}, fmt.Errorf("%w: open zip: %w", ErrImportMalformed, err)
	}
	manifestBytes, err := readZipFile(zr, "manifest.json")
	if err != nil {
		return DataV2{}, fmt.Errorf("%w: missing manifest.json: %w", ErrImportMalformed, err)
	}
	var mf struct {
		Schema string `json:"schema"`
	}
	if err := json.Unmarshal(manifestBytes, &mf); err != nil {
		return DataV2{}, fmt.Errorf("%w: manifest decode: %w", ErrImportMalformed, err)
	}
	if mf.Schema != BundleSchemaV1 {
		return DataV2{}, fmt.Errorf("import: unsupported bundle schema %q (this build expects %q)", mf.Schema, BundleSchemaV1)
	}
	dataBytes, err := readZipFile(zr, "data.json")
	if err != nil {
		return DataV2{}, fmt.Errorf("%w: missing data.json: %w", ErrImportMalformed, err)
	}
	var data DataV2
	if err := json.Unmarshal(dataBytes, &data); err != nil {
		return DataV2{}, fmt.Errorf("%w: data.json decode: %w", ErrImportMalformed, err)
	}
	if data.Schema != exportSchemaV1 && data.Schema != exportSchemaV2 {
		return DataV2{}, fmt.Errorf("import: unsupported data schema %q (this build accepts %q and %q)", data.Schema, exportSchemaV1, exportSchemaV2)
	}
	return data, nil
}

// existingMatchKeys collects every match_key already present — across the five
// OCR parent tables and the user-data layer (manual matches live only there) —
// so the merge can skip collisions.
func existingMatchKeys(store db.Store) (map[string]struct{}, error) {
	snap, err := store.LoadAll()
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
	userData, err := store.LoadAllUserMatchData()
	if err != nil {
		return nil, fmt.Errorf("import: load user data: %w", err)
	}
	for k := range userData {
		keys[k] = struct{}{}
	}
	return keys, nil
}

// partitionByMatchKey keeps the incoming parent rows whose match_key is new and
// drops the ones the database already holds — a merge never overwrites. The
// counts the caller reports come from summarizeImport, which sees the
// user-layer-only keys these row tables can't.
func partitionByMatchKey(t parentTables, existing map[string]struct{}) parentTables {
	keep := func(matchKey string) bool {
		_, ok := existing[matchKey]
		return !ok
	}
	return parentTables{
		summaries: filterRows(t.summaries, keep, func(r db.SummaryRow) string { return r.MatchKey }),
		teams:     filterRows(t.teams, keep, func(r db.TeamsRow) string { return r.MatchKey }),
		personals: filterRows(t.personals, keep, func(r db.PersonalRow) string { return r.MatchKey }),
		ranks:     filterRows(t.ranks, keep, func(r db.RankRow) string { return r.MatchKey }),
		unknowns:  filterRows(t.unknowns, keep, func(r db.UnknownRow) string { return r.MatchKey }),
	}
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
