package app

import (
	"strconv"

	"recall/pkg/db"
)

var (
	summaryHeader = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id",
		"map", "playlist", "hero", "result", "final_score",
		"date", "finished_at", "game_length",
		"perf_elim_total", "perf_elim_avg_per_10min",
		"perf_assists_total", "perf_assists_avg_per_10min",
		"perf_deaths_total", "perf_deaths_avg_per_10min",
	}
	summaryHeroPlayedHeader = []string{"summary_screenshot_id", "hero", "percent_played", "play_time"}
	teamsHeader             = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id",
		"eliminations", "assists", "deaths", "damage", "healing", "mitigation",
		"queue_type",
	}
	heroStatHeader = []string{"parent_id", "hero", "stat_key", "stat_value"}
	personalHeader = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id", "hero",
	}
	rankHeader = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id",
		"rank", "level", "rank_progress", "change_percent", "result",
	}
	unknownHeader = []string{
		"id", "filename", "match_key", "parsed_at", "screenshots_dir_id",
	}
)

func mapToRows(m map[int64]string) [][]string {
	out := make([][]string, 0, len(m))
	for id, path := range m {
		out = append(out, []string{strconv.FormatInt(id, 10), path})
	}
	return out
}

func summariesToRows(rows []db.SummaryRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
			r.Map, r.Playlist, r.Hero, r.Result, r.FinalScore,
			r.Date, r.FinishedAt, r.GameLength,
			strconv.Itoa(r.PerfElimTotal),
			strconv.FormatFloat(r.PerfElimAvgPer10Min, 'f', -1, 64),
			strconv.Itoa(r.PerfAssistsTotal),
			strconv.FormatFloat(r.PerfAssistsAvgPer10Min, 'f', -1, 64),
			strconv.Itoa(r.PerfDeathsTotal),
			strconv.FormatFloat(r.PerfDeathsAvgPer10Min, 'f', -1, 64),
		})
	}
	return out
}

func summaryHeroesPlayedToRows(rows []db.SummaryRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, h := range r.HeroesPlayed {
			out = append(out, []string{
				strconv.FormatInt(r.ID, 10),
				h.Hero,
				strconv.Itoa(h.PercentPlayed),
				h.PlayTime,
			})
		}
	}
	return out
}

func teamsToRows(rows []db.TeamsRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
			strconv.Itoa(r.Eliminations), strconv.Itoa(r.Assists), strconv.Itoa(r.Deaths),
			strconv.Itoa(r.Damage), strconv.Itoa(r.Healing), strconv.Itoa(r.Mitigation),
			r.QueueType,
		})
	}
	return out
}

func teamsStatsToRows(rows []db.TeamsRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, s := range r.HeroStats {
			out = append(out, []string{
				strconv.FormatInt(r.ID, 10),
				s.Hero, s.StatKey, strconv.Itoa(s.StatValue),
			})
		}
	}
	return out
}

func personalsToRows(rows []db.PersonalRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
			r.Hero,
		})
	}
	return out
}

func personalStatsToRows(rows []db.PersonalRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, s := range r.HeroStats {
			out = append(out, []string{
				strconv.FormatInt(r.ID, 10),
				s.Hero, s.StatKey, strconv.Itoa(s.StatValue),
			})
		}
	}
	return out
}

func ranksToRows(rows []db.RankRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
			r.Rank,
			strconv.Itoa(r.Level), strconv.Itoa(r.RankProgress), strconv.Itoa(r.ChangePercent),
			r.Result,
		})
	}
	return out
}

func rankModifiersToRows(rows []db.RankRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, m := range r.Modifiers {
			out = append(out, []string{strconv.FormatInt(r.ID, 10), m})
		}
	}
	return out
}

func rankSRToRows(rows []db.RankRow) [][]string {
	var out [][]string
	for _, r := range rows {
		for _, sr := range r.SR {
			out = append(out, []string{
				strconv.FormatInt(r.ID, 10),
				sr.Hero, strconv.Itoa(sr.SR), strconv.Itoa(sr.Change),
			})
		}
	}
	return out
}

func unknownsToRows(rows []db.UnknownRow) [][]string {
	out := make([][]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, []string{
			strconv.FormatInt(r.ID, 10),
			r.Filename, r.MatchKey, r.ParsedAt,
			strconv.FormatInt(r.ScreenshotsDirID, 10),
		})
	}
	return out
}
