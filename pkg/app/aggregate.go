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
// match that was scoreboard-only).
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
	recs := aggregateScreenshots(snap)
	attachAnnotations(recs, annos)
	attachHidden(recs, hidden)
	return recs, nil
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
func aggregateMatchKey(key string, snap db.Screenshots, annos map[string]db.Annotation, hidden map[string]bool) (MatchRecord, bool) {
	vs := make([]screenshotView, 0, 8)
	for _, r := range snap.Summaries {
		if r.MatchKey == key {
			vs = append(vs, summaryToView(r))
		}
	}
	for _, r := range snap.Scoreboards {
		if r.MatchKey == key {
			vs = append(vs, scoreboardToView(r))
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
	return rec, true
}

func aggregateScreenshots(snap db.Screenshots) []MatchRecord {
	views := make([]screenshotView, 0,
		len(snap.Summaries)+len(snap.Scoreboards)+len(snap.Personals)+len(snap.Ranks)+len(snap.Unknowns))
	for _, r := range snap.Summaries {
		views = append(views, summaryToView(r))
	}
	for _, r := range snap.Scoreboards {
		views = append(views, scoreboardToView(r))
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
	dirsPerFile := map[string]string{}
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
			if path, ok := dirs[v.dirID]; ok {
				dirsPerFile[v.filename] = path
			}
		}
	}
	// Derived fields — never stored in the DB.
	if data.Hero != "" {
		data.Role = firstNonEmpty(data.Role, parser.HeroRole(data.Hero))
	}
	if data.Map != "" {
		data.Type = firstNonEmpty(data.Type, parser.MapType(data.Map))
	}

	rec := MatchRecord{
		MatchKey:       key,
		SourceFiles:    unionSortedStrings(sources, nil),
		SourceTypes:    types,
		SourceParsedAt: parsedAtPerFile,
		ParsedAt:       matchParsedAt,
		Data:           data,
	}
	if len(dirsPerFile) > 0 {
		rec.SourceDirs = dirsPerFile
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
			Map: r.Map, Mode: r.Mode, Hero: r.Hero,
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

func scoreboardToView(r db.ScoreboardRow) screenshotView {
	view := screenshotView{
		filename: r.Filename, typeName: "scoreboard",
		matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
		data: parser.MatchResult{
			Map: r.Map, Mode: r.Mode, Hero: r.Hero,
			Eliminations: r.Eliminations, Assists: r.Assists, Deaths: r.Deaths,
			Damage: r.Damage, Healing: r.Healing, Mitigation: r.Mitigation,
		},
	}
	attachHeroStats(&view.data, r.HeroStats)
	return view
}

func personalToView(r db.PersonalRow) screenshotView {
	view := screenshotView{
		filename: r.Filename, typeName: "personal",
		matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
		data: parser.MatchResult{Hero: r.Hero},
	}
	attachHeroStats(&view.data, r.HeroStats)
	return view
}

func rankToView(r db.RankRow) screenshotView {
	view := screenshotView{
		filename: r.Filename, typeName: "rank",
		matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
		data: parser.MatchResult{
			Mode: "competitive", // rank screens are always competitive
			Rank: r.Rank, Level: r.Level,
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
