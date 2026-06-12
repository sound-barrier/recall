package app

import (
	"sort"

	"recall/pkg/db"
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

// attachReviews writes `ReviewedBy` + `ReviewedAt` on every record
// carrying a review-status row. Pure function, called once per
// aggregateAll.
func attachReviews(recs []MatchRecord, reviews map[string]db.ReviewState) {
	if len(reviews) == 0 {
		return
	}
	for i := range recs {
		if st, ok := reviews[recs[i].MatchKey]; ok {
			recs[i].ReviewedBy = st.ReviewedBy
			recs[i].ReviewedAt = st.ReviewedAt
		}
	}
}

// attachQueues writes `QueueType` on every record carrying a
// match_queue row. Pure function, called once per aggregateAll.
func attachQueues(recs []MatchRecord, queues map[string]db.QueueState) {
	if len(queues) == 0 {
		return
	}
	for i := range recs {
		if st, ok := queues[recs[i].MatchKey]; ok {
			recs[i].QueueType = st.QueueType
		}
	}
}

// attachPlayModes writes `PlayMode` on every record carrying a
// match_play_mode row. Pure-override semantics: PlayMode is set ONLY
// from the aux table — no fallback to data.mode, no inference from
// rank-row presence. The earlier "override → data.mode → rank →
// empty" chain made the "Not set" UI chip unreachable on any match
// the parser had captured (which is every seeded match). New
// matches default to "Not set" until the user toggles, matching
// the user's "unless I know otherwise it should be unset" intent.
//
// Pure function, called once per aggregateAll.
func attachPlayModes(recs []MatchRecord, overrides map[string]db.PlayModeState) {
	if len(overrides) == 0 {
		return
	}
	for i := range recs {
		if st, ok := overrides[recs[i].MatchKey]; ok {
			recs[i].PlayMode = st.PlayMode
		}
	}
}

// attachAmbiguity flags every MatchRecord whose match_key starts with
// "ambiguous-" and attaches its candidate match list. The candidates
// map is keyed by the filename embedded in the sentinel — every
// MatchRecord that adopted the same sentinel (via the timestamp-window
// pass) shares one candidates entry.
//
// Each AmbiguousAttribution is enriched with a representative source
// file (the candidate match's earliest SourceFile + its dir id) so
// the Unknown-tab picker can render a thumbnail beside each
// candidate. Built from a one-pass O(N) index over recs.
func attachAmbiguity(recs []MatchRecord, candidates map[string][]db.AmbiguousCandidate) {
	// Index recs by match_key for O(1) candidate lookups. Built only
	// when at least one ambiguous record exists — most aggregate
	// runs skip this entirely.
	var byKey map[string]*MatchRecord
	ensureIndex := func() {
		if byKey != nil {
			return
		}
		byKey = make(map[string]*MatchRecord, len(recs))
		for i := range recs {
			byKey[recs[i].MatchKey] = &recs[i]
		}
	}

	for i := range recs {
		mk, err := ParseMatchKey(recs[i].MatchKey)
		if err != nil || !mk.IsAmbiguous() {
			continue
		}
		recs[i].Ambiguous = true
		cs, ok := candidates[mk.Filename()]
		if !ok {
			continue
		}
		ensureIndex()
		recs[i].Candidates = make([]AmbiguousAttribution, 0, len(cs))
		for _, c := range cs {
			attr := AmbiguousAttribution{
				MatchKey:        c.MatchKey,
				DistanceSeconds: c.DistanceSeconds,
			}
			if cand, ok := byKey[c.MatchKey]; ok && len(cand.SourceFiles) > 0 {
				attr.RepresentativeSourceFile = cand.SourceFiles[0]
				if cand.SourceDirIDs != nil {
					attr.RepresentativeDirID = cand.SourceDirIDs[cand.SourceFiles[0]]
				}
			}
			recs[i].Candidates = append(recs[i].Candidates, attr)
		}
	}
}

// attachHidden flips `Hidden` to true on every record whose match_key
// is in the soft-delete set. Pure function, called once per aggregateAll.
func attachHidden(recs []MatchRecord, hidden map[string]bool) {
	if len(hidden) == 0 {
		return
	}
	for i := range recs {
		if hidden[recs[i].MatchKey] {
			recs[i].Hidden = true
		}
	}
}

// attachAnnotations grafts user-curated leaver/note records onto the
// aggregated MatchRecord slice. Match-key lookup; missing → nil
// (unannotated). Pure function, exported only via aggregateAll +
// the streaming path in app_wails.go / app_server.go's emit.
func attachAnnotations(recs []MatchRecord, annos map[string]db.Annotation) {
	if len(annos) == 0 {
		return
	}
	for i := range recs {
		if a, ok := annos[recs[i].MatchKey]; ok {
			recs[i].Annotation = &MatchAnnotation{
				Leaver:      a.Leaver,
				Note:        a.Note,
				ReplayCode:  a.ReplayCode,
				Members:     a.Members,
				Tags:        a.Tags,
				AnnotatedAt: a.AnnotatedAt,
			}
		}
	}
}

// screenshotView is the per-screenshot row the aggregator folds. The
// five parent row types convert to this shape via toView<X> helpers
// below.
type screenshotView struct {
	filename string
	typeName string
	matchKey string
	parsedAt string
	dirID    int64 // 0 = unset; resolved against snap.ScreenshotsDirs in foldGroup
	data     parser.MatchResult
}

// aggregateMatchKey produces a single MatchRecord for the given
// match_key, reading just its rows out of snap. Returns
// (record, true) when at least one row matched; (_, false) when
// nothing in snap references the key.
//
// Same precedence rules as aggregateScreenshots — this is the
// per-key extract for the live-streaming "match-updated" event.
// Inference helpers (inferSoleHeroPercent, inferResultFromRank)
// are applied so the streamed shape matches GetMatchResults output.
func aggregateMatchKey(key string, snap db.Screenshots, annos map[string]db.Annotation, hidden map[string]bool, reviews map[string]db.ReviewState) (MatchRecord, bool) {
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
			vs = append(vs, screenshotView{
				filename: r.Filename, typeName: "unknown",
				matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
			})
		}
	}
	if len(vs) == 0 {
		return MatchRecord{}, false
	}
	rec := foldGroup(key, vs, snap.ScreenshotsDirs)
	inferSoleHeroPercent(&rec.Data)
	inferResultFromRank(&rec.Data)
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
	if mk, err := ParseMatchKey(key); err == nil && mk.IsAmbiguous() {
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
	return rec, true
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
		views = append(views, screenshotView{
			filename: r.Filename, typeName: "unknown",
			matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
		})
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

// ────────────────────────────────────────────────────────────────
// Per-type row → screenshotView. Each materializes the row's columns
// plus its attached children into a parser.MatchResult.
// ────────────────────────────────────────────────────────────────

func summaryToView(r db.SummaryRow) screenshotView {
	view := screenshotView{
		filename: r.Filename, typeName: "summary",
		matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
		data: parser.MatchResult{
			Map: r.Map, MapRaw: r.MapRaw, Playlist: r.Playlist, Hero: r.Hero, HeroRaw: r.HeroRaw,
			Result: r.Result, FinalScore: r.FinalScore,
			Date: r.Date, FinishedAt: r.FinishedAt, GameLength: r.GameLength,
		},
	}
	if r.PerfElimTotal > 0 || r.PerfAssistsTotal > 0 || r.PerfDeathsTotal > 0 {
		view.data.Performance = &parser.Performance{
			Eliminations: parser.PerformanceStat{
				Total:       r.PerfElimTotal,
				AvgPer10Min: r.PerfElimAvgPer10Min,
			},
			Assists: parser.PerformanceStat{
				Total:       r.PerfAssistsTotal,
				AvgPer10Min: r.PerfAssistsAvgPer10Min,
			},
			Deaths: parser.PerformanceStat{
				Total:       r.PerfDeathsTotal,
				AvgPer10Min: r.PerfDeathsAvgPer10Min,
			},
		}
	}
	for _, h := range r.HeroesPlayed {
		view.data.HeroesPlayed = append(view.data.HeroesPlayed, parser.HeroPlay{
			Hero:          h.Hero,
			PercentPlayed: h.PercentPlayed,
			PlayTime:      h.PlayTime,
		})
	}
	return view
}

func teamsToView(r db.TeamsRow) screenshotView {
	view := screenshotView{
		filename: r.Filename, typeName: "teams",
		matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
		data: parser.MatchResult{
			Eliminations: r.Eliminations, Assists: r.Assists, Deaths: r.Deaths,
			Damage: r.Damage, Healing: r.Healing, Mitigation: r.Mitigation,
			QueueType: r.QueueType,
		},
	}
	attachHeroStats(&view.data, r.HeroStats)
	return view
}

func personalToView(r db.PersonalRow) screenshotView {
	view := screenshotView{
		filename: r.Filename, typeName: "personal",
		matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
		data: parser.MatchResult{Hero: r.Hero, HeroRaw: r.HeroRaw},
	}
	attachHeroStats(&view.data, r.HeroStats)
	return view
}

func rankToView(r db.RankRow) screenshotView {
	view := screenshotView{
		filename: r.Filename, typeName: "rank",
		matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
		data: parser.MatchResult{
			Playlist: "competitive", // rank screens are always competitive
			Rank:     r.Rank, Level: r.Level,
			RankProgress: r.RankProgress, ChangePercent: r.ChangePercent,
			Result:    r.Result,
			Modifiers: append([]string(nil), r.Modifiers...),
		},
	}
	for _, sr := range r.SR {
		view.data.SR = append(view.data.SR, parser.HeroSR{
			Hero: sr.Hero, SR: sr.SR, Change: sr.Change,
		})
	}
	return view
}

// attachHeroStats folds (hero, stat_key, stat_value) rows into the
// HeroesPlayed[*].Stats map shape parser.MatchResult uses.
func attachHeroStats(d *parser.MatchResult, stats []db.HeroStat) {
	if len(stats) == 0 {
		return
	}
	heroIdx := map[string]int{}
	for i, hp := range d.HeroesPlayed {
		heroIdx[hp.Hero] = i
	}
	for _, st := range stats {
		idx, ok := heroIdx[st.Hero]
		if !ok {
			d.HeroesPlayed = append(d.HeroesPlayed, parser.HeroPlay{Hero: st.Hero})
			idx = len(d.HeroesPlayed) - 1
			heroIdx[st.Hero] = idx
		}
		if d.HeroesPlayed[idx].Stats == nil {
			d.HeroesPlayed[idx].Stats = map[string]int{}
		}
		d.HeroesPlayed[idx].Stats[st.StatKey] = st.StatValue
	}
}
