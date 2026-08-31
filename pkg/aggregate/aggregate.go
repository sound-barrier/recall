package aggregate

import (
	"sort"

	"recall/pkg/correlate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// aggregateAll bulk-reads every screenshot row, groups by match_key,
// folds each group into one match.Record via correlate.MergeMatchResult, and runs
// the read-time inference helpers.
//
// Read-time only: never mutates DB rows. The same precedence rules
// the old destructive merge applied at write time now run at read
// time over the typed parent rows; raw per-screenshot data stays
// available for replay (e.g. when a new SUMMARY arrives for an old
// match that was teams-only).
// reAggregateUnknowns walks every per-screenshot row whose canonical
// hero/map is empty but whose raw OCR is preserved, re-runs the
// parser's matchers against the CURRENT heroes.yaml / maps.yaml
// rosters, and promotes any newly-recognized rows to canonical.
//
// Cheap pure-CPU pass — one in-memory matcher invocation per
// unknown row, then one UPDATE per hit. ~2–5 s on a 500-match
// corpus typical. Runs at App.Startup so a YAML release that adds
// a new hero/map retroactively fixes the user's Unknown bucket
// without forcing a Tesseract re-run.
//
// Forward-only: rows written before this feature shipped have
// hero_raw=” / map_raw=” and participate in the walk only as
// no-ops. To recover the older Mei-misattribution backlog,
// Settings → Advanced → Re-parse all screenshots is the only
// path (it re-runs Tesseract, which now correctly rejects the
// short-name fuzzy match).
// Sidecars bundles the user-layer maps that decorate an aggregated
// record — annotation, hidden flag, review state, pinned flag, the
// coach-received note blocks, and the player's own moments. They always
// travel together (the data-clump rule), so they thread as one value
// instead of six parallel parameters.
//
// Every map here has a bulk Attach* sibling in attach.go, and the two
// paths must agree: a sidecar wired into only one of them renders on the
// list read and blanks on the single-match refresh, which is what a
// match-updated event triggers.
type Sidecars struct {
	Annotations map[string]db.Annotation
	Hidden      map[string]bool
	// AckedRefGaps: match keys whose reference-data-gap warning the user
	// dismissed — the streamed match-updated shape must carry the flag or
	// a re-parse would flash the warning card back until the refetch.
	AckedRefGaps map[string]bool
	Reviews      map[string]db.ReviewState
	Pinned       map[string]bool
	CoachNotes   map[string][]db.MatchCoachNote
	Moments      map[string][]db.MatchMoment
	SelfReviews  map[string][]db.SelfReviewNoteOnMatch
	// DuplicateLinks: per match key, the matches it was judged separate
	// from. Already symmetric when it arrives — the store reads each
	// stored row from both ends.
	DuplicateLinks map[string][]string
}

func MatchKey(key string, snap db.Screenshots, sc Sidecars) (match.Record, bool) {
	vs := collectViewsForKey(snap, key)
	if len(vs) == 0 {
		return match.Record{}, false
	}
	rec := FoldGroup(key, vs, snap.ScreenshotsDirs)
	ApplyReadTimeInference(&rec.Data)
	attachMatchSidecars(&rec, key, snap, sc)
	return rec, true
}

// collectViewsForKey gathers every ScreenshotView across the five parent
// tables whose match_key equals key.
func collectViewsForKey(snap db.Screenshots, key string) []ScreenshotView {
	vs := make([]ScreenshotView, 0, 8)
	vs = appendViewsForKey(vs, snap.Summaries, key, func(r db.SummaryRow) string { return r.MatchKey }, summaryToView)
	vs = appendViewsForKey(vs, snap.Teams, key, func(r db.TeamsRow) string { return r.MatchKey }, teamsToView)
	vs = appendViewsForKey(vs, snap.Personals, key, func(r db.PersonalRow) string { return r.MatchKey }, personalToView)
	vs = appendViewsForKey(vs, snap.Ranks, key, func(r db.RankRow) string { return r.MatchKey }, rankToView)
	vs = appendViewsForKey(vs, snap.Unknowns, key, func(r db.UnknownRow) string { return r.MatchKey }, unknownToView)
	return vs
}

// appendViewsForKey appends the view of every row in one parent table
// whose match_key (read via keyOf) equals key.
func appendViewsForKey[T any](vs []ScreenshotView, rows []T, key string, keyOf func(T) string, toView func(T) ScreenshotView) []ScreenshotView {
	for _, r := range rows {
		if keyOf(r) == key {
			vs = append(vs, toView(r))
		}
	}
	return vs
}

// attachMatchSidecars decorates rec with everything stored BESIDE the
// screenshot rows for this key. Split in two by what the fields are, not
// by how many there are: the user's own marks on the match, then the
// writing about it and the links out of it.
//
// Both halves go through the same converters as the bulk Attach* pass, so
// the two read paths cannot disagree.
func attachMatchSidecars(rec *match.Record, key string, snap db.Screenshots, sc Sidecars) {
	attachMatchMarks(rec, key, sc)
	attachMatchWriting(rec, key, sc)
	if of, ok := sc.DuplicateLinks[key]; ok {
		rec.DuplicateOf = of
	}
	attachMatchAmbiguity(rec, key, snap.AmbiguousCandidates)
}

// attachMatchMarks applies what the user said ABOUT the match: their
// annotation, the flags they set, and the review state.
func attachMatchMarks(rec *match.Record, key string, sc Sidecars) {
	if a, ok := sc.Annotations[key]; ok {
		rec.Annotation = annotationFromRow(a)
	}
	if sc.AckedRefGaps[key] {
		rec.ReferenceGapAcknowledged = true
	}
	if sc.Hidden[key] {
		rec.Hidden = true
	}
	if sc.Pinned[key] {
		rec.Pinned = true
	}
	if st, ok := sc.Reviews[key]; ok {
		rec.ReviewedBy = st.ReviewedBy
		rec.ReviewedAt = st.ReviewedAt
	}
}

// attachMatchWriting applies the prose families — a coach's returned
// blocks, the player's own moments, and their review sittings. Kept apart
// from the marks above because these are somebody's words and each has its
// own converter and its own attribution.
func attachMatchWriting(rec *match.Record, key string, sc Sidecars) {
	if rows, ok := sc.CoachNotes[key]; ok {
		rec.CoachNotes = coachNotesFromRows(rows)
	}
	if rows, ok := sc.Moments[key]; ok && len(rows) > 0 {
		rec.Moments = MatchMomentsFromRows(rows)
	}
	if rows, ok := sc.SelfReviews[key]; ok {
		rec.SelfReviewNotes = selfReviewNotesFromRows(rows)
	}
}

// attachMatchAmbiguity flags an ambiguous-sentinel key and attaches its
// candidate list (the single-key sibling of AttachAmbiguity, minus the
// representative-thumbnail enrichment that needs the whole record set).
func attachMatchAmbiguity(rec *match.Record, key string, candidates map[string][]db.AmbiguousCandidate) {
	mk, err := match.ParseKey(key)
	if err != nil || !mk.IsAmbiguous() {
		return
	}
	rec.Ambiguous = true
	cs, ok := candidates[mk.Filename()]
	if !ok {
		return
	}
	rec.Candidates = make([]match.AmbiguousAttribution, 0, len(cs))
	for _, c := range cs {
		rec.Candidates = append(rec.Candidates, match.AmbiguousAttribution{
			MatchKey:        c.MatchKey,
			DistanceSeconds: c.DistanceSeconds,
			Reason:          c.Reason,
		})
	}
}

func Screenshots(snap db.Screenshots) []match.Record {
	views := make([]ScreenshotView, 0,
		len(snap.Summaries)+len(snap.Teams)+len(snap.Personals)+len(snap.Ranks)+len(snap.Unknowns))
	for _, r := range snap.Summaries {
		views = append(views, summaryToView(r))
	}
	for _, r := range snap.Teams {
		views = append(views, teamsToView(r))
	}
	for _, r := range snap.Personals {
		views = append(views, personalToView(r))
	}
	for _, r := range snap.Ranks {
		views = append(views, rankToView(r))
	}
	for _, r := range snap.Unknowns {
		views = append(views, unknownToView(r))
	}

	groups := map[string][]ScreenshotView{}
	for _, v := range views {
		groups[v.matchKey] = append(groups[v.matchKey], v)
	}

	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]match.Record, 0, len(keys))
	for _, k := range keys {
		out = append(out, FoldGroup(k, groups[k], snap.ScreenshotsDirs))
	}
	return out
}

func FoldGroup(key string, vs []ScreenshotView, dirs map[int64]string) match.Record {
	sortViewsForFold(vs)

	var data parser.MatchResult
	sources := make([]string, 0, len(vs))
	types := make(map[string]parser.ScreenshotType, len(vs))
	parsedAtPerFile := make(map[string]string, len(vs))
	// dirIDsPerFile maps each source filename to the screenshots_dirs
	// row id it was ingested from. Frontends build
	// `/_screenshot/<id>/<filename>` URLs from this map; the handler
	// reads the id back out, looks up the path, and serves. Filename
	// entries are only added when the per-row dirID is non-zero AND
	// resolves to a known dir (a stale FK after a `screenshots_dirs`
	// row delete would otherwise yield a broken URL).
	dirIDsPerFile := map[string]int64{}
	matchParsedAt := ""
	for _, v := range vs {
		correlate.MergeMatchResult(&data, &v.data)
		sources = append(sources, v.filename)
		types[v.filename] = v.typeName
		if v.parsedAt != "" {
			parsedAtPerFile[v.filename] = v.parsedAt
			if matchParsedAt == "" || v.parsedAt < matchParsedAt {
				matchParsedAt = v.parsedAt
			}
		}
		if v.dirID != 0 {
			if _, ok := dirs[v.dirID]; ok {
				dirIDsPerFile[v.filename] = v.dirID
			}
		}
	}
	applyDerivedFields(&data)

	// Surface the parser-detected queue format as the top-level
	// QueueType (a user match_queue annotation overrides it in
	// AttachQueues — "manual wins"). Lift it off the nested Data so the
	// effective value appears exactly once on the wire.
	detectedQueue := data.QueueType
	data.QueueType = ""

	rec := match.Record{
		MatchKey:       key,
		SourceFiles:    correlate.UnionSortedStrings(sources, nil),
		SourceTypes:    types,
		SourceParsedAt: parsedAtPerFile,
		ParsedAt:       matchParsedAt,
		Data:           data,
		QueueType:      detectedQueue,
		Source:         match.SourceOCR,
	}
	if len(dirIDsPerFile) > 0 {
		rec.SourceDirIDs = dirIDsPerFile
	}
	return rec
}

// sortViewsForFold orders a match's screenshots filename-timestamp asc, then
// parsed_at asc — the same order mergeByTimestamp folded earliest-first inside
// each window, so "first non-empty wins" keeps the earliest screenshot's value.
func sortViewsForFold(vs []ScreenshotView) {
	sort.Slice(vs, func(i, j int) bool {
		ti, oki := correlate.ParseFilenameTimestamp(vs[i].filename)
		tj, okj := correlate.ParseFilenameTimestamp(vs[j].filename)
		switch {
		case oki && okj && !ti.Equal(tj):
			return ti.Before(tj)
		case oki && !okj:
			return true
		case !oki && okj:
			return false
		}
		return vs[i].parsedAt < vs[j].parsedAt
	})
}

// applyDerivedFields fills Role from Hero and GameMode from Map via the shipped
// reference data. These are derived, never stored — recomputed on every read so
// a roster/map-data update can't strand a stale value.
func applyDerivedFields(data *parser.MatchResult) {
	if data.Hero != "" {
		data.Role = correlate.FirstNonEmpty(data.Role, parser.HeroRole(data.Hero))
	}
	if data.Map != "" {
		data.GameMode = correlate.FirstNonEmpty(data.GameMode, parser.MapGameMode(data.Map))
	}
}

// provenanceForSynthesized reads a shell's provenance off its own key. A
// replay key can only have come from a coach's review, so nothing needs to be
// stored to tell the two apart — the key already says it.
func provenanceForSynthesized(key string) string {
	if k, err := match.ParseKey(key); err == nil && k.IsReplay() {
		return match.SourceReplay
	}
	return match.SourceManual
}

// SynthesizeManualMatches appends an empty match.Record for every user-data key
// with no screenshot-backed record — a hand-entered match, which lives entirely
// in the override layer. AttachUserData fills each shell's Data from the row.
// The result is re-sorted by match_key so manual and OCR matches interleave in
// the same order Screenshots produces.
func SynthesizeManualMatches(recs []match.Record, userData map[string]db.UserMatchData) []match.Record {
	if len(userData) == 0 {
		return recs
	}
	have := make(map[string]bool, len(recs))
	for i := range recs {
		have[recs[i].MatchKey] = true
	}
	added := false
	for k := range userData {
		if have[k] {
			continue
		}
		recs = append(recs, match.Record{
			MatchKey:    k,
			Source:      provenanceForSynthesized(k),
			SourceFiles: []string{},
		})
		added = true
	}
	if added {
		sort.Slice(recs, func(i, j int) bool { return recs[i].MatchKey < recs[j].MatchKey })
	}
	return recs
}
