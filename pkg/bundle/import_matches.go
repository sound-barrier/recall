package bundle

import (
	"errors"
	"fmt"

	"recall/pkg/db"
)

// ErrImportMalformed wraps payload-level parse failures (not a ZIP, zip-open
// failure, missing/undecodable manifest or data.json). The HTTP handler maps
// it to 400. Semantic-validation failures (unsupported schema, write failures)
// are not wrapped and map to the default 409.
var ErrImportMalformed = errors.New("import: malformed payload")

// ErrCoachBundle reports a bundle a player shared for coaching (its manifest
// names the player) handed to the merge import. A coach who mis-clicks
// Import… must not end up with the player's matches in their own history;
// the bundle opens as a coaching session instead. Readable but refused →
// the default 409.
var ErrCoachBundle = errors.New("import: this bundle was shared for coaching — open it as a coaching session instead of importing it")

// ImportSummary reports the outcome of a merge import: how many matches were
// added and how many were skipped because their match_key already existed.
type ImportSummary struct {
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
}

// Import merges a `recall-bundle/v1` ZIP into the existing database
// WITHOUT clearing it. It reads the bundle's data.json (ignoring the embedded
// screenshot bytes — data-only), skips any incoming match whose match_key
// already exists locally, and upserts the rest. Every imported row's
// screenshots-dir reference collapses to the sentinel, mirroring the way the
// bundle export strips filesystem paths.
//
// A v2 data.json also carries the user layer — inline edits, manual matches,
// annotations, review / queue / play-mode state, hidden + pinned flags,
// accepted coach notes — which imports under the same skip-existing rule: an
// incoming key you already have is skipped wholesale, so a merge can never
// clobber local edits. v1 bundles (builds ≤0.22.x) simply have no user layer
// to import. A bundle shared for coaching is refused with ErrCoachBundle
// before the store is touched.
func Import(store db.Store, payload []byte) (ImportSummary, error) {
	contents, err := Read(payload)
	if err != nil {
		return ImportSummary{}, err
	}
	if contents.Manifest.Player != nil {
		return ImportSummary{}, ErrCoachBundle
	}
	data := contents.Data
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
	if err := requireCoachNoteIDs(data.CoachNotes); err != nil {
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
func summarizeImport(data DataV2, existing map[string]bool) ImportSummary {
	var summary ImportSummary
	for key := range dataMatchKeys(data) {
		if existing[key] {
			summary.Skipped++
			continue
		}
		summary.Imported++
	}
	return summary
}

// importUserLayer writes the v2 user-layer sections for keys not already
// present locally (the same skip-existing rule the parent rows follow).
func importUserLayer(store db.Store, data DataV2, existing map[string]bool) error {
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
	if err := importFlagKeys(data.Hidden, existing, "hidden", store.HideMatch); err != nil {
		return err
	}
	if err := importFlagKeys(data.Pinned, existing, "pinned", store.PinMatch); err != nil {
		return err
	}
	return importCoachNotes(store, data.CoachNotes, existing)
}

// importCoachNotes writes the accepted coach blocks whose keys are new, with
// the exporting machine's row id dropped so the store mints its own. The
// store re-stamps accepted_at on first accept — the block's original accept
// instant does not survive the trip.
func importCoachNotes(store db.Store, notes []db.MatchCoachNote, existing map[string]bool) error {
	for _, n := range notes {
		if existing[n.MatchKey] {
			continue
		}
		n.ID = 0
		if _, err := store.UpsertMatchCoachNote(n); err != nil {
			return fmt.Errorf("import: coach note for %q: %w", n.MatchKey, err)
		}
	}
	return nil
}

// requireCoachNoteIDs fails if any incoming coach block lacks its note_id —
// the identity the store keys on. Named table AND index, before anything is
// written, so a bad block cannot half-import the bundle.
func requireCoachNoteIDs(notes []db.MatchCoachNote) error {
	for i, n := range notes {
		if n.NoteID == "" {
			return fmt.Errorf("import: coach_notes[%d] missing required note_id", i)
		}
	}
	return nil
}

// importUserMatchData upserts the incoming user-data rows whose keys are new.
func importUserMatchData(store db.Store, rows []db.UserMatchData, existing map[string]bool) error {
	for _, ud := range rows {
		if existing[ud.MatchKey] {
			continue
		}
		if err := store.UpsertUserMatchData(ud); err != nil {
			return fmt.Errorf("import: user data for %q: %w", ud.MatchKey, err)
		}
	}
	return nil
}

// importAnnotations writes the incoming annotations whose keys are new.
func importAnnotations(store db.Store, annotations []db.Annotation, existing map[string]bool) error {
	for _, ann := range annotations {
		if existing[ann.MatchKey] {
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
func importKeyedSection[T any](m map[string]T, existing map[string]bool, section string, value func(T) string, set func(key, val string) error) error {
	for k, v := range m {
		if existing[k] {
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

// importFlagKeys writes one presence-is-state sidecar section — a bare list of
// match keys (hidden, pinned) — skipping the keys already present locally.
// `flag` names the section in the error message.
func importFlagKeys(keys []string, existing map[string]bool, flag string, set func(string) error) error {
	for _, k := range keys {
		if existing[k] {
			continue
		}
		if err := set(k); err != nil {
			return fmt.Errorf("import: %s flag for %q: %w", flag, k, err)
		}
	}
	return nil
}

// existingMatchKeys collects every match_key already present — the five OCR
// parent tables and the user-data layer (manual matches live only there) —
// so the merge can skip collisions.
func existingMatchKeys(store db.Store) (map[string]bool, error) {
	keys, err := store.LoadMatchKeys()
	if err != nil {
		return nil, fmt.Errorf("import: load existing: %w", err)
	}
	return keys, nil
}

// partitionByMatchKey keeps the incoming parent rows whose match_key is new and
// drops the ones the database already holds — a merge never overwrites. The
// counts the caller reports come from summarizeImport, which sees the
// user-layer-only keys these row tables can't.
func partitionByMatchKey(t parentTables, existing map[string]bool) parentTables {
	keep := func(matchKey string) bool { return !existing[matchKey] }
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
