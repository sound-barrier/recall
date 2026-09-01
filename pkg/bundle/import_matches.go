package bundle

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"recall/pkg/db"
	"recall/pkg/match"
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
	// The frames the incoming moments name. Taken into custody BEFORE the
	// moments themselves, so a moment is never written pointing at bytes this
	// database does not yet hold — content-addressed, so re-importing the same
	// bundle stores nothing twice.
	if err := importMomentImages(store, payload); err != nil {
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
	if err := requireSelfReviewIDs(data.SelfReviews); err != nil {
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
	if err := importReviews(store, data.Reviews, existing); err != nil {
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
	if err := importMatchMoments(store, data.Moments, existing); err != nil {
		return err
	}
	if err := importCoachNotes(store, data.CoachNotes, existing); err != nil {
		return err
	}
	return importSelfReviews(store, data.SelfReviews, existing)
}

// importSelfReviews brings the player's sittings in under their own UUIDs.
// The same rule as every section: a match already in this history keeps
// what it has, so a sitting is narrowed to the keys the import is bringing
// in — members and notes alike — and dropped whole when none survives,
// never left as an orphan block. A sitting whose UUID is already here is
// left alone (a re-import doubles nothing).
func importSelfReviews(store db.Store, reviews []db.SelfReview, existing map[string]bool) error {
	for _, r := range reviews {
		if _, present, err := store.LoadSelfReview(r.ReviewID); err != nil {
			return fmt.Errorf("import: self review %q: %w", r.ReviewID, err)
		} else if present {
			continue
		}
		narrowed := narrowSelfReview(r, func(k string) bool { return !existing[k] })
		if len(narrowed.MatchKeys) == 0 {
			continue
		}
		if err := WriteSelfReview(store, narrowed); err != nil {
			return err
		}
	}
	return nil
}

// WriteSelfReview reproduces one sitting on the store: the parent with its
// identity and instants, then every note with its moments. Exported for the
// profile move, which carries a sitting between profiles the same way an
// import carries it between machines.
func WriteSelfReview(store db.Store, r db.SelfReview) error {
	if _, err := store.CreateSelfReview(r); err != nil {
		return fmt.Errorf("import: self review %q: %w", r.ReviewID, err)
	}
	// What the sitting concluded travels with it. Unlike the notes below,
	// the list is not narrowed to the surviving members: an item is about
	// the player, not about one match.
	// Through the validator, not straight to the store: a hand-edited bundle
	// could otherwise inject blank text or a non-UUID item_id that every
	// later read would serve.
	if err := db.ValidateFocusItems(r.FocusItems); err != nil {
		return fmt.Errorf("import: self review focus items %q: %w", r.ReviewID, err)
	}
	if err := store.SetSelfReviewFocusItems(r.ReviewID, r.FocusItems); err != nil {
		return fmt.Errorf("import: self review focus items %q: %w", r.ReviewID, err)
	}
	for _, k := range r.MatchKeys {
		n, ok := r.Notes[k]
		if !ok {
			continue
		}
		n.ReviewID = r.ReviewID
		if _, err := store.UpsertSelfReviewNote(n); err != nil {
			return fmt.Errorf("import: self review note %q/%q: %w", r.ReviewID, k, err)
		}
		for _, m := range n.Moments {
			if _, err := store.UpsertSelfReviewMoment(db.SelfReviewNoteRef{ReviewID: r.ReviewID, MatchKey: k}, m); err != nil {
				return fmt.Errorf("import: self review moment %q/%q/%q: %w", r.ReviewID, k, m.MomentID, err)
			}
		}
	}
	return nil
}

// importMomentImages takes custody of the frames a bundle carried.
//
// Entry names are NOT trusted: archive/zip does not sanitize them, so anything
// that is not exactly `moment-images/<64 hex>` is skipped, and the bytes are
// then verified to hash to the name they arrived under. A bundle cannot make
// this database disagree with itself about what a digest means.
func importMomentImages(store db.Store, payload []byte) error {
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("%w: open zip: %w", ErrImportMalformed, err)
	}
	for _, entry := range zr.File {
		sha, ok := strings.CutPrefix(entry.Name, bundleMomentImagePrefix)
		if !ok || !bundleDigestPattern.MatchString(sha) {
			continue
		}
		raw, err := ReadZipEntry(zr, entry.Name, maxZipEntryBytes)
		if err != nil {
			return fmt.Errorf("%w: %s: %w", ErrImportMalformed, entry.Name, err)
		}
		if db.MomentImageDigest(raw) != sha {
			return fmt.Errorf("%w: %s does not match its own contents", ErrImportMalformed, entry.Name)
		}
		if _, err := store.PutMomentImage(raw, http.DetectContentType(raw)); err != nil {
			return fmt.Errorf("bundle: store attached frame: %w", err)
		}
	}
	return nil
}

// bundleDigestPattern is the only entry-name shape moment-images/ may carry.
var bundleDigestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// importMatchMoments writes the player's own timestamped moments for keys the
// import is bringing in. Same rule as every section above: a match already in
// this history keeps what it has, so an import never rewrites local work.
func importMatchMoments(store db.Store, moments []db.MatchMoment, existing map[string]bool) error {
	for _, m := range moments {
		if existing[m.MatchKey] {
			continue
		}
		if _, err := store.UpsertMatchMoment(m); err != nil {
			return fmt.Errorf("import: moment for %q: %w", m.MatchKey, err)
		}
	}
	return nil
}

// importCoachNotes writes the accepted coach blocks whose keys are new, with
// the exporting machine's row id dropped so the store mints its own. The
// accept instant travels with the block: a restore brings back WHEN the
// player took each note, not when the archive happened to be imported.
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

// requireSelfReviewIDs is the same guard for the sittings: a review_id is
// the identity the import dedupes on and the store keys on, and a note or
// moment inside carries its own key and id the same way.
func requireSelfReviewIDs(reviews []db.SelfReview) error {
	for i, r := range reviews {
		if r.ReviewID == "" {
			return fmt.Errorf("import: self_reviews[%d] missing required review_id", i)
		}
		for k, n := range r.Notes {
			for j, m := range n.Moments {
				if m.MomentID == "" {
					return fmt.Errorf("import: self_reviews[%d] note %q moments[%d] missing required moment_id", i, k, j)
				}
			}
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

// importAnnotations writes the incoming annotations whose keys are new,
// keeping the annotated_at each carries — a restore replays when the note was
// written, it does not re-date every note to the import.
func importAnnotations(store db.Store, annotations []db.Annotation, existing map[string]bool) error {
	for _, ann := range annotations {
		if existing[ann.MatchKey] {
			continue
		}
		// Canonicalize, never refuse. A bundle from an older build can carry
		// a code today's rule would reject, and failing a whole restore over
		// stale six characters would cost the user their history to enforce a
		// format. An unrepairable code rides through unchanged, exactly as
		// the store's own startup pass leaves it.
		if code, ok := match.NormalizeReplayCode(ann.ReplayCode); ok {
			ann.ReplayCode = code
		}
		if err := store.SetAnnotationAt(ann); err != nil {
			return fmt.Errorf("import: annotation for %q: %w", ann.MatchKey, err)
		}
	}
	return nil
}

// importReviews writes the incoming review rows whose keys are new, keeping
// the reviewed_at each carries. Entries naming no reviewer are skipped, the
// same guard importKeyedSection applies to the queue / play-mode sections.
func importReviews(store db.Store, reviews map[string]db.ReviewState, existing map[string]bool) error {
	for key, review := range reviews {
		if existing[key] || review.ReviewedBy == "" {
			continue
		}
		if err := store.SetReviewAt(key, review.ReviewedBy, review.ReviewedAt); err != nil {
			return fmt.Errorf("import: review for %q: %w", key, err)
		}
	}
	return nil
}

// importKeyedSection writes one map-shaped user-layer section (queues / play
// modes), skipping existing keys and entries whose value is empty. `section`
// names the section in the error message. Reviews have their own writer —
// they carry an instant to replay, which this shape has nowhere to put.
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
	// ONE set across all five, not five sets. A file is exactly one
	// screenshot of exactly one type — DeleteScreenshotSiblings maintains
	// that on every parse — but the import path never called it, so a
	// payload listing the same filename under summaries AND teams imported
	// cleanly and the aggregator then folded one image twice into one match:
	// SourceTypes claimed both, two rows derived from one file were merged,
	// and the Re-parse-All tally double-counted it.
	seen := map[string]string{}
	if err := requireFilenames(t.summaries, "summaries", seen, func(r db.SummaryRow) string { return r.Filename }); err != nil {
		return err
	}
	if err := requireFilenames(t.teams, "teams", seen, func(r db.TeamsRow) string { return r.Filename }); err != nil {
		return err
	}
	if err := requireFilenames(t.personals, "personals", seen, func(r db.PersonalRow) string { return r.Filename }); err != nil {
		return err
	}
	if err := requireFilenames(t.ranks, "ranks", seen, func(r db.RankRow) string { return r.Filename }); err != nil {
		return err
	}
	return requireFilenames(t.unknowns, "unknowns", seen, func(r db.UnknownRow) string { return r.Filename })
}

// requireFilenames fails if any row has an empty filename, or if a filename
// has already been claimed by another parent table. `seen` is shared across
// all five calls and carries the table that claimed each name, so the error
// can say which two disagree. `table` is the plural array name.
func requireFilenames[T any](rows []T, table string, seen map[string]string, filename func(T) string) error {
	for i, r := range rows {
		name := filename(r)
		if name == "" {
			return fmt.Errorf("import: %s[%d] missing required filename", table, i)
		}
		if was, dup := seen[name]; dup {
			return fmt.Errorf("import: %s[%d] lists %q, which %s already claims — "+
				"one file is one screenshot of one type", table, i, name, was)
		}
		seen[name] = table
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
