package app

import (
	"fmt"

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

	// Record the source folder once per batch so every screenshot in
	// this Parse run is FK'd to the same screenshots_dirs row. Resolved
	// up-front because the parser callback below fires per-file during
	// OCR and we don't want to repeat this lookup on every shot.
	dirID, err := a.store.EnsureScreenshotsDir(screenshotsDir)
	if err != nil {
		return err
	}

	// Per-file work runs INSIDE the parser callback so insert + match-
	// updated emit fire as each screenshot finishes OCR. Before this
	// shape, the writes lived in a post-OCR for-loop that only ran
	// after every file had been OCR'd; the UI saw `parse-progress`
	// stream cleanly but `match-updated` arrived in a single
	// last-instant burst, so the Matches tab stayed blank until
	// parse-complete.
	//
	// The parser walks files in os.ReadDir order (alphabetical), which
	// for OW screenshots equals chronological (filenames carry the
	// capture timestamp). resolveMatchKey is order-tolerant — a later
	// scoreboard can still correlate to an earlier summary via the
	// E/A/D + timestamp-window rules — but the alphabetical order
	// keeps the natural case fast.
	var inserts int
	_, err = parser.ParseScreenshotsDir(screenshotsDir, parsed, func(done, total int, filename string, result *parser.MatchResult, parseErr error) {
		t := parser.ScreenshotType(result)

		// Always fire the progress event so the footer counter
		// advances regardless of parse outcome. MatchKey is set
		// later after correlation resolves.
		ev := ParseProgressEvent{
			Done:     done,
			Total:    total,
			Filename: filename,
			Type:     t,
			Data:     result,
		}
		if parseErr != nil {
			ev.Error = parseErr.Error()
		}

		// Skip insert/aggregate on per-file parse failure but still
		// emit the progress event so the user sees the file count
		// for accurate progress.
		if parseErr != nil || result == nil {
			a.emitParseProgress(ev)
			return
		}

		snap, err := a.store.LoadAll()
		if err != nil {
			ev.Error = "load before correlation: " + err.Error()
			a.emitParseProgress(ev)
			return
		}
		key, ambigCands := resolveMatchKey(filename, result, snap)
		ev.MatchKey = key

		if err := a.insertParsed(filename, key, t, dirID, result); err != nil {
			ev.Error = "insert: " + err.Error()
			a.emitParseProgress(ev)
			return
		}
		// ApplyAmbiguity wipes any prior ambiguous record for this
		// filename and re-inserts iff ambigCands is non-empty — a
		// re-parse that newly resolves (or newly surfaces) ambiguity
		// updates the candidates table in lockstep.
		if err := a.store.ApplyAmbiguity(filename, ambigCands); err != nil {
			ev.Error = "ambiguity: " + err.Error()
			a.emitParseProgress(ev)
			return
		}
		inserts++

		snapAfter, err := a.store.LoadAll()
		if err == nil {
			annos, _ := a.store.LoadAnnotations()
			hidden, _ := a.store.LoadHiddenKeys()
			if rec, ok := aggregateMatchKey(key, snapAfter, annos, hidden); ok {
				a.emitMatchUpdated(rec)
			}
		}
		a.emitParseProgress(ev)
	})
	if err != nil {
		return err
	}
	_ = inserts // value is reserved for a future debug log; suppress unused
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
