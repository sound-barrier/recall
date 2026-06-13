package app

import (
	"archive/zip"
	"strconv"
	"strings"

	"recall/pkg/db"
)

func readDirsCSV(zr *zip.Reader) (map[string]string, error) {
	out := map[string]string{}
	// Older CSV exports might not have a screenshots_dirs.csv; treat
	// "not found" as an empty map. Any other error is fatal.
	records, err := readCSV(zr, "screenshots_dirs.csv")
	if err != nil {
		if strings.Contains(err.Error(), "not found in archive") {
			return out, nil
		}
		return nil, err
	}
	for _, rec := range records {
		if len(rec) < 2 {
			continue
		}
		out[rec[0]] = rec[1]
	}
	return out, nil
}

func readSummariesCSV(zr *zip.Reader) ([]db.SummaryRow, error) {
	rows, err := readCSV(zr, "summaries.csv")
	if err != nil {
		return nil, err
	}
	parents := make(map[int64]*db.SummaryRow, len(rows))
	out := make([]db.SummaryRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(summaryHeader) {
			continue
		}
		r := db.SummaryRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3],
			Map: rec[5], Playlist: rec[6], Hero: rec[7], Result: rec[8], FinalScore: rec[9],
			Date: rec[10], FinishedAt: rec[11], GameLength: rec[12],
		}
		srcID, _ := strconv.ParseInt(rec[0], 10, 64)
		r.ID = srcID
		dirID, _ := strconv.ParseInt(rec[4], 10, 64)
		r.ScreenshotsDirID = dirID
		r.PerfElimTotal, _ = strconv.Atoi(rec[13])
		r.PerfElimAvgPer10Min, _ = strconv.ParseFloat(rec[14], 64)
		r.PerfAssistsTotal, _ = strconv.Atoi(rec[15])
		r.PerfAssistsAvgPer10Min, _ = strconv.ParseFloat(rec[16], 64)
		r.PerfDeathsTotal, _ = strconv.Atoi(rec[17])
		r.PerfDeathsAvgPer10Min, _ = strconv.ParseFloat(rec[18], 64)
		out = append(out, r)
		parents[srcID] = &out[len(out)-1]
	}
	// Attach children.
	heroRows, _ := readCSV(zr, "summary_heroes_played.csv")
	for _, rec := range heroRows {
		if len(rec) < 4 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		p, ok := parents[pid]
		if !ok {
			continue
		}
		pct, _ := strconv.Atoi(rec[2])
		p.HeroesPlayed = append(p.HeroesPlayed, db.SummaryHeroPlayed{
			Hero: rec[1], PercentPlayed: pct, PlayTime: rec[3],
		})
	}
	return out, nil
}

func readTeamsCSV(zr *zip.Reader) ([]db.TeamsRow, error) {
	rows, err := readCSV(zr, "teams.csv")
	if err != nil {
		return nil, err
	}
	parents := make(map[int64]*db.TeamsRow, len(rows))
	out := make([]db.TeamsRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(teamsHeader) {
			continue
		}
		r := db.TeamsRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3],
		}
		r.ID, _ = strconv.ParseInt(rec[0], 10, 64)
		r.ScreenshotsDirID, _ = strconv.ParseInt(rec[4], 10, 64)
		r.Eliminations, _ = strconv.Atoi(rec[5])
		r.Assists, _ = strconv.Atoi(rec[6])
		r.Deaths, _ = strconv.Atoi(rec[7])
		r.Damage, _ = strconv.Atoi(rec[8])
		r.Healing, _ = strconv.Atoi(rec[9])
		r.Mitigation, _ = strconv.Atoi(rec[10])
		r.QueueType = rec[11]
		out = append(out, r)
		parents[r.ID] = &out[len(out)-1]
	}
	statRows, _ := readCSV(zr, "teams_hero_stats.csv")
	for _, rec := range statRows {
		if len(rec) < 4 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		p, ok := parents[pid]
		if !ok {
			continue
		}
		v, _ := strconv.Atoi(rec[3])
		p.HeroStats = append(p.HeroStats, db.HeroStat{Hero: rec[1], StatKey: rec[2], StatValue: v})
	}
	return out, nil
}

func readPersonalsCSV(zr *zip.Reader) ([]db.PersonalRow, error) {
	rows, err := readCSV(zr, "personals.csv")
	if err != nil {
		return nil, err
	}
	parents := make(map[int64]*db.PersonalRow, len(rows))
	out := make([]db.PersonalRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(personalHeader) {
			continue
		}
		r := db.PersonalRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3], Hero: rec[5],
		}
		r.ID, _ = strconv.ParseInt(rec[0], 10, 64)
		r.ScreenshotsDirID, _ = strconv.ParseInt(rec[4], 10, 64)
		out = append(out, r)
		parents[r.ID] = &out[len(out)-1]
	}
	statRows, _ := readCSV(zr, "personal_hero_stats.csv")
	for _, rec := range statRows {
		if len(rec) < 4 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		p, ok := parents[pid]
		if !ok {
			continue
		}
		v, _ := strconv.Atoi(rec[3])
		p.HeroStats = append(p.HeroStats, db.HeroStat{Hero: rec[1], StatKey: rec[2], StatValue: v})
	}
	return out, nil
}

func readRanksCSV(zr *zip.Reader) ([]db.RankRow, error) {
	rows, err := readCSV(zr, "ranks.csv")
	if err != nil {
		return nil, err
	}
	parents := make(map[int64]*db.RankRow, len(rows))
	out := make([]db.RankRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(rankHeader) {
			continue
		}
		r := db.RankRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3],
			Rank: rec[5], Result: rec[9],
		}
		r.ID, _ = strconv.ParseInt(rec[0], 10, 64)
		r.ScreenshotsDirID, _ = strconv.ParseInt(rec[4], 10, 64)
		r.Level, _ = strconv.Atoi(rec[6])
		r.RankProgress, _ = strconv.Atoi(rec[7])
		r.ChangePercent, _ = strconv.Atoi(rec[8])
		out = append(out, r)
		parents[r.ID] = &out[len(out)-1]
	}
	modRows, _ := readCSV(zr, "rank_modifiers.csv")
	for _, rec := range modRows {
		if len(rec) < 2 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		if p, ok := parents[pid]; ok {
			p.Modifiers = append(p.Modifiers, rec[1])
		}
	}
	srRows, _ := readCSV(zr, "rank_sr.csv")
	for _, rec := range srRows {
		if len(rec) < 4 {
			continue
		}
		pid, _ := strconv.ParseInt(rec[0], 10, 64)
		p, ok := parents[pid]
		if !ok {
			continue
		}
		sr, _ := strconv.Atoi(rec[2])
		ch, _ := strconv.Atoi(rec[3])
		p.SR = append(p.SR, db.HeroSR{Hero: rec[1], SR: sr, Change: ch})
	}
	return out, nil
}

func readUnknownsCSV(zr *zip.Reader) ([]db.UnknownRow, error) {
	rows, err := readCSV(zr, "unknowns.csv")
	if err != nil {
		return nil, err
	}
	out := make([]db.UnknownRow, 0, len(rows))
	for _, rec := range rows {
		if len(rec) < len(unknownHeader) {
			continue
		}
		r := db.UnknownRow{
			Filename: rec[1], MatchKey: rec[2], ParsedAt: rec[3],
		}
		r.ID, _ = strconv.ParseInt(rec[0], 10, 64)
		r.ScreenshotsDirID, _ = strconv.ParseInt(rec[4], 10, 64)
		out = append(out, r)
	}
	return out, nil
}
