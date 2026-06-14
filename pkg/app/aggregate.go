package app

import (
	"sort"

	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// aggregateAll bulk-reads every screenshot row, groups by match_key,
// folds each group into one MatchRecord via mergeMatchResult, and runs
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
// rosters, and promotes any newly-recognised rows to canonical.
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
func (a *App) reAggregateUnknowns() (int, error) {
	return a.store.ReAggregateUnknowns(parser.FirstKnownHeroIn, parser.FirstKnownMapIn)
}

func (a *App) aggregateAll() ([]MatchRecord, error) {
	snap, err := a.store.LoadAll()
	if err != nil {
		return nil, err
	}
	annos, err := a.store.LoadAnnotations()
	if err != nil {
		return nil, err
	}
	hidden, err := a.store.LoadHiddenKeys()
	if err != nil {
		return nil, err
	}
	reviews, err := a.store.LoadReviews()
	if err != nil {
		return nil, err
	}
	queues, err := a.store.LoadMatchQueues()
	if err != nil {
		return nil, err
	}
	playModes, err := a.store.LoadMatchPlayModes()
	if err != nil {
		return nil, err
	}
	recs := aggregateScreenshots(snap)
	attachAnnotations(recs, annos)
	attachHidden(recs, hidden)
	attachReviews(recs, reviews)
	attachQueues(recs, queues)
	attachPlayModes(recs, playModes)
	attachAmbiguity(recs, snap.AmbiguousCandidates)
	return recs, nil
}

func aggregateMatchKey(key string, snap db.Screenshots, annos map[string]db.Annotation, hidden map[string]bool, reviews map[string]db.ReviewState) (MatchRecord, bool) {
	vs := collectViewsForKey(snap, key)
	if len(vs) == 0 {
		return MatchRecord{}, false
	}
	rec := foldGroup(key, vs, snap.ScreenshotsDirs)
	inferSoleHeroPercent(&rec.Data)
	inferResultFromRank(&rec.Data)
	attachMatchSidecars(&rec, key, snap, annos, hidden, reviews)
	return rec, true
}

// collectViewsForKey gathers every screenshotView across the five parent
// tables whose match_key equals key.
func collectViewsForKey(snap db.Screenshots, key string) []screenshotView {
	vs := make([]screenshotView, 0, 8)
	for _, r := range snap.Summaries {
		if r.MatchKey == key {
			vs = append(vs, summaryToView(r))
		}
	}
	for _, r := range snap.Teams {
		if r.MatchKey == key {
			vs = append(vs, teamsToView(r))
		}
	}
	for _, r := range snap.Personals {
		if r.MatchKey == key {
			vs = append(vs, personalToView(r))
		}
	}
	for _, r := range snap.Ranks {
		if r.MatchKey == key {
			vs = append(vs, rankToView(r))
		}
	}
	for _, r := range snap.Unknowns {
		if r.MatchKey == key {
			vs = append(vs, unknownToView(r))
		}
	}
	return vs
}

// attachMatchSidecars decorates rec with the per-key annotation, hidden
// flag, review state, and ambiguous-attribution candidates.
func attachMatchSidecars(rec *MatchRecord, key string, snap db.Screenshots, annos map[string]db.Annotation, hidden map[string]bool, reviews map[string]db.ReviewState) {
	if a, ok := annos[key]; ok {
		rec.Annotation = &MatchAnnotation{
			Leaver:      a.Leaver,
			Note:        a.Note,
			ReplayCode:  a.ReplayCode,
			Members:     a.Members,
			Tags:        a.Tags,
			AnnotatedAt: a.AnnotatedAt,
		}
	}
	if hidden[key] {
		rec.Hidden = true
	}
	if st, ok := reviews[key]; ok {
		rec.ReviewedBy = st.ReviewedBy
		rec.ReviewedAt = st.ReviewedAt
	}
	if mk, err := match.ParseMatchKey(key); err == nil && mk.IsAmbiguous() {
		rec.Ambiguous = true
		if cs, ok := snap.AmbiguousCandidates[mk.Filename()]; ok {
			rec.Candidates = make([]AmbiguousAttribution, 0, len(cs))
			for _, c := range cs {
				rec.Candidates = append(rec.Candidates, AmbiguousAttribution{
					MatchKey:        c.MatchKey,
					DistanceSeconds: c.DistanceSeconds,
				})
			}
		}
	}
}

func aggregateScreenshots(snap db.Screenshots) []MatchRecord {
	views := make([]screenshotView, 0,
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

	groups := map[string][]screenshotView{}
	for _, v := range views {
		groups[v.matchKey] = append(groups[v.matchKey], v)
	}

	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]MatchRecord, 0, len(keys))
	for _, k := range keys {
		out = append(out, foldGroup(k, groups[k], snap.ScreenshotsDirs))
	}
	return out
}

func foldGroup(key string, vs []screenshotView, dirs map[int64]string) MatchRecord {
	// Fold order: filename-timestamp asc, then parsed_at asc. This
	// matches the pre-refactor ordering, where mergeByTimestamp folded
	// earliest-first inside each window.
	sort.Slice(vs, func(i, j int) bool {
		ti, oki := parseFilenameTimestamp(vs[i].filename)
		tj, okj := parseFilenameTimestamp(vs[j].filename)
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

	var data parser.MatchResult
	sources := make([]string, 0, len(vs))
	types := make(map[string]string, len(vs))
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
		mergeMatchResult(&data, &v.data)
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
	// Derived fields — never stored in the DB.
	if data.Hero != "" {
		data.Role = firstNonEmpty(data.Role, parser.HeroRole(data.Hero))
	}
	if data.Map != "" {
		data.GameMode = firstNonEmpty(data.GameMode, parser.MapGameMode(data.Map))
	}

	// Surface the parser-detected queue format as the top-level
	// QueueType (a user match_queue annotation overrides it in
	// attachQueues — "manual wins"). Lift it off the nested Data so the
	// effective value appears exactly once on the wire.
	detectedQueue := data.QueueType
	data.QueueType = ""

	rec := MatchRecord{
		MatchKey:       key,
		SourceFiles:    unionSortedStrings(sources, nil),
		SourceTypes:    types,
		SourceParsedAt: parsedAtPerFile,
		ParsedAt:       matchParsedAt,
		Data:           data,
		QueueType:      detectedQueue,
	}
	if len(dirIDsPerFile) > 0 {
		rec.SourceDirIDs = dirIDsPerFile
	}
	return rec
}
