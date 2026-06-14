package app

import (
	"recall/pkg/db"
	"recall/pkg/parser"
)

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

// aggregateMatchKey produces a single match.MatchRecord for the given
// match_key, reading just its rows out of snap. Returns
// (record, true) when at least one row matched; (_, false) when
// nothing in snap references the key.
//
// Same precedence rules as aggregateScreenshots — this is the
// per-key extract for the live-streaming "match-updated" event.
// Inference helpers (inferSoleHeroPercent, inferResultFromRank)
// are applied so the streamed shape matches GetMatchResults output.
// unknownToView builds the screenshotView for an unknown row. The other
// four row types have their own *ToView helpers; this matches them so the
// inline literal doesn't get duplicated across the aggregators.
func unknownToView(r db.UnknownRow) screenshotView {
	return screenshotView{
		filename: r.Filename, typeName: "unknown",
		matchKey: r.MatchKey, parsedAt: r.ParsedAt, dirID: r.ScreenshotsDirID,
	}
}

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
