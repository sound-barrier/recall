package app

import (
	"fmt"
	"sort"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// ParseProgressEvent is emitted on the "parse-progress" channel/event
// after each screenshot finishes OCR. Error is non-empty when the file
// failed to parse — the loop continues regardless.
type ParseProgressEvent struct {
	Done     int                 `json:"done"`
	Total    int                 `json:"total"`
	Filename string              `json:"filename"`
	Type     string              `json:"screenshot_type"`
	MatchKey string              `json:"match_key,omitempty"`
	Data     *parser.MatchResult `json:"data,omitempty"`
	Error    string              `json:"error,omitempty"`
}

// ParseScreenshots OCRs every image in screenshots/ and writes each
// result to its per-type table. Correlation (resolveMatchKey) runs per
// screenshot in filename-timestamp order so cross-file deps (e.g. a
// PERSONAL adopting the SUMMARY it shares a match with) see the
// already-inserted siblings.
func (a *App) ParseScreenshots() error {
	screenshotsDir, err := validateScreenshotsDir(a.settings.ScreenshotsDir)
	if err != nil {
		return err
	}
	if !a.tessStatus.Found {
		a.tessStatus = checkTesseract(a.settings.TesseractPath)
		if !a.tessStatus.Found {
			return fmt.Errorf("tesseract is not available: %s", a.tessStatus.Error)
		}
	}
	a.parseMu.Lock()
	defer a.parseMu.Unlock()

	parsed, err := a.store.LoadAllFilenames()
	if err != nil {
		return err
	}
	results, err := parser.ParseScreenshotsDir(screenshotsDir, parsed, func(done, total int, filename string, result *parser.MatchResult, parseErr error) {
		// The progress callback is for UI flicker only; the per-file
		// insert (which emits its own progress event with MatchKey
		// resolved) happens below in the main loop.
		ev := ParseProgressEvent{
			Done:     done,
			Total:    total,
			Filename: filename,
			Type:     parser.ScreenshotType(result),
			Data:     result,
		}
		if parseErr != nil {
			ev.Error = parseErr.Error()
		}
		a.emitParseProgress(ev)
	})
	if err != nil {
		return err
	}
	if len(results) == 0 {
		return nil
	}

	// Order new files by filename-timestamp so correlation against
	// previously-inserted siblings (in the same batch) works.
	order := make([]string, 0, len(results))
	for f := range results {
		order = append(order, f)
	}
	sort.Slice(order, func(i, j int) bool {
		ti, oki := parseFilenameTimestamp(order[i])
		tj, okj := parseFilenameTimestamp(order[j])
		switch {
		case oki && okj && !ti.Equal(tj):
			return ti.Before(tj)
		case oki && !okj:
			return true
		case !oki && okj:
			return false
		}
		return order[i] < order[j]
	})

	// Record the source folder once per batch so every screenshot in
	// this Parse run is FK'd to the same screenshots_dirs row. If the
	// user later changes the screenshots folder, this row preserves
	// the path the file was ingested from.
	dirID, err := a.store.EnsureScreenshotsDir(screenshotsDir)
	if err != nil {
		return err
	}

	for _, filename := range order {
		r := results[filename]
		snap, err := a.store.LoadAll()
		if err != nil {
			return err
		}
		key := resolveMatchKey(filename, r, snap)
		t := parser.ScreenshotType(r)
		if err := a.insertParsed(filename, key, t, dirID, r); err != nil {
			return err
		}
		// Re-read after the insert so the streamed MatchRecord includes
		// the row we just wrote (LoadAll above ran before insertParsed).
		// The next iteration's LoadAll then sees this row too.
		snapAfter, err := a.store.LoadAll()
		if err != nil {
			return err
		}
		if rec, ok := aggregateMatchKey(key, snapAfter); ok {
			a.emitMatchUpdated(rec)
		}
		a.emitParseProgress(ParseProgressEvent{
			Filename: filename,
			Type:     t,
			MatchKey: key,
			Data:     r,
		})
	}
	return nil
}

// insertParsed dispatches a parsed result to the right Upsert method on
// the store, materializing children from the parser's nested types.
// dirID is the screenshots_dirs FK resolved once per batch by the
// caller (0 = unset; the store renders that as SQL NULL).
func (a *App) insertParsed(filename, key, t string, dirID int64, r *parser.MatchResult) error {
	switch t {
	case "summary":
		row := db.SummaryRow{
			Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
			Map: r.Map, Mode: r.Mode, Hero: r.Hero,
			Result: r.Result, FinalScore: r.FinalScore,
			Date: r.Date, FinishedAt: r.FinishedAt, GameLength: r.GameLength,
		}
		if r.Performance != nil {
			row.PerfElimTotal = r.Performance.Eliminations.Total
			row.PerfElimAvgPer10Min = r.Performance.Eliminations.AvgPer10Min
			row.PerfAssistsTotal = r.Performance.Assists.Total
			row.PerfAssistsAvgPer10Min = r.Performance.Assists.AvgPer10Min
			row.PerfDeathsTotal = r.Performance.Deaths.Total
			row.PerfDeathsAvgPer10Min = r.Performance.Deaths.AvgPer10Min
		}
		for _, h := range r.HeroesPlayed {
			row.HeroesPlayed = append(row.HeroesPlayed, db.SummaryHeroPlayed{
				Hero: h.Hero, PercentPlayed: h.PercentPlayed, PlayTime: h.PlayTime,
			})
		}
		return a.store.UpsertSummary(row)

	case "scoreboard":
		row := db.ScoreboardRow{
			Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
			Map: r.Map, Mode: r.Mode, Hero: r.Hero,
			Eliminations: r.Eliminations, Assists: r.Assists, Deaths: r.Deaths,
			Damage: r.Damage, Healing: r.Healing, Mitigation: r.Mitigation,
		}
		row.HeroStats = flattenHeroStats(r.HeroesPlayed)
		return a.store.UpsertScoreboard(row)

	case "personal":
		row := db.PersonalRow{
			Filename: filename, MatchKey: key, ScreenshotsDirID: dirID, Hero: r.Hero,
		}
		row.HeroStats = flattenHeroStats(r.HeroesPlayed)
		return a.store.UpsertPersonal(row)

	case "rank":
		row := db.RankRow{
			Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
			Rank: r.Rank, Level: r.Level,
			RankProgress: r.RankProgress, ChangePercent: r.ChangePercent,
			Result:    r.Result,
			Modifiers: append([]string(nil), r.Modifiers...),
		}
		for _, sr := range r.SR {
			row.SR = append(row.SR, db.HeroSR{Hero: sr.Hero, SR: sr.SR, Change: sr.Change})
		}
		return a.store.UpsertRank(row)

	default: // unknown
		return a.store.UpsertUnknown(db.UnknownRow{
			Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
		})
	}
}

// flattenHeroStats converts HeroesPlayed[*].Stats (map per hero) into
// the long-skinny rows the SQL child tables hold.
func flattenHeroStats(hps []parser.HeroPlay) []db.HeroStat {
	var out []db.HeroStat
	for _, hp := range hps {
		for k, v := range hp.Stats {
			out = append(out, db.HeroStat{Hero: hp.Hero, StatKey: k, StatValue: v})
		}
	}
	return out
}
