package app

import (
	"context"
	"errors"
	"fmt"

	"recall/pkg/db"
	"recall/pkg/parser"
)

// ErrNoParseInFlight is returned by CancelParse when no parse is
// running. The HTTP layer maps this to 409 Conflict — the request
// was well-formed, the server's runtime state just doesn't have
// anything to cancel.
var ErrNoParseInFlight = errors.New("no parse in flight")

// CancelParse short-circuits an in-flight ParseScreenshots at the
// next between-files boundary by cancelling the context the parser
// loop is checking. Returns ErrNoParseInFlight when no parse is
// running. Wails-bound so the desktop Stop button drives it via the
// generated bindings; also reachable via DELETE /api/v1/parses/active
// for server mode.
//
// Cancellation IS NOT immediate — the file currently in OCR
// completes (tesseract is a shell-out, not context-aware) before
// the loop unwinds. Empirically OCR is 1-3 s/file so the user
// notices the difference vs the full batch within seconds.
func (a *App) CancelParse() error {
	a.parseCancelMu.Lock()
	defer a.parseCancelMu.Unlock()
	if a.parseCancel == nil {
		return ErrNoParseInFlight
	}
	a.parseCancel()
	return nil
}

// ParseProgressEvent is emitted on the "parse-progress" channel/event
// after each screenshot finishes OCR. Error is non-empty when the file
// failed to parse — the loop continues regardless.
//
// MatchesUpdated / HeroCorrections / MapCorrections are cumulative
// across the run. The first non-zero value surfaces the moment a
// re-aggregate completes with a changed hero/map field; the UI
// reads the latest value, not per-file deltas.
type ParseProgressEvent struct {
	Done     int                 `json:"done"`
	Total    int                 `json:"total"`
	Filename string              `json:"filename"`
	Type     string              `json:"screenshot_type"`
	MatchKey string              `json:"match_key,omitempty"`
	Data     *parser.MatchResult `json:"data,omitempty"`
	Error    string              `json:"error,omitempty"`
	// Cumulative counters since the run started — useful for the
	// re-parse-all surface in Settings → Advanced ("X of Y matches
	// updated · N hero / M map corrected"). Always zero on a
	// regular ParseScreenshots run that doesn't touch the
	// counters, so existing consumers ignore them silently.
	MatchesUpdated  int `json:"matches_updated,omitempty"`
	HeroCorrections int `json:"hero_corrections,omitempty"`
	MapCorrections  int `json:"map_corrections,omitempty"`
}

// ReParseAll re-runs the OCR pipeline against every PNG in the
// watched folder, including ones that are already in the per-type
// tables. The Upsert clauses are idempotent on filename (ON CONFLICT
// UPDATE) so existing rows are rewritten in place — the user's
// match annotations, queue overrides, play-mode overrides, hidden
// flags, and reviews all key on match_key and survive the re-parse.
//
// Use case: after a parser-tightening release lands (e.g. the
// hero-fuzzy-match length-gate that stopped Miyazaki being
// attributed to Mei), the user clicks Settings → Advanced →
// Re-parse all screenshots to retroactively correct the older
// rows. ~1 s per screenshot end-to-end; the progress panel surfaces
// per-file events through the same SSE stream the watcher uses.
func (a *App) ReParseAll() error {
	return a.parseScreenshotsImpl(true)
}

// ParseScreenshots OCRs every image in screenshots/ and writes each
// result to its per-type table. Correlation (resolveMatchKey) runs per
// screenshot in filename-timestamp order so cross-file deps (e.g. a
// PERSONAL adopting the SUMMARY it shares a match with) see the
// already-inserted siblings.
func (a *App) ParseScreenshots() error {
	return a.parseScreenshotsImpl(false)
}

// parseScreenshotsImpl is the shared body for ParseScreenshots /
// ReParseAll. When `force` is true, the already-parsed skip-set is
// ignored and every file in the directory is re-OCR'd.
func (a *App) parseScreenshotsImpl(force bool) error {
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

	// Cancellation seam — see CancelParse(). The cancel func is
	// stashed under a tiny mutex so the HTTP DELETE handler can
	// reach it without blocking on parseMu (which the OCR loop
	// holds for the full run). Cleared on the way out so a
	// follow-up CancelParse returns ErrNoParseInFlight.
	ctx, cancel := context.WithCancel(context.Background())
	a.parseCancelMu.Lock()
	a.parseCancel = cancel
	a.parseCancelMu.Unlock()
	defer func() {
		a.parseCancelMu.Lock()
		a.parseCancel = nil
		a.parseCancelMu.Unlock()
		cancel()
	}()

	parsed := map[string]bool{}
	if !force {
		parsed, err = a.store.LoadAllFilenames()
		if err != nil {
			return err
		}
	}
	// Union the user-curated suppress-list ("Delete forever" in the
	// Unknown tab) into the parser's skip-set so the OCR pipeline
	// never even opens those files. Errors loading the ignored set
	// don't abort the parse — the set is a UX nicety, not a
	// correctness invariant; an empty set just means nothing's
	// suppressed for this run. Suppress list IS honoured even on
	// ReParseAll — the user explicitly told us never to look at
	// those files again.
	ignored, _ := a.store.LoadIgnoredFilenames()
	for f := range ignored {
		parsed[f] = true
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
	// teams can still correlate to an earlier summary via the
	// E/A/D + timestamp-window rules — but the alphabetical order
	// keeps the natural case fast.
	var inserts int
	// Cumulative re-parse counters — surfaced via ParseProgressEvent
	// so the Settings → Advanced re-parse-all surface can render
	// "X of Y matches updated · N hero / M map corrected" without
	// any extra round-trip. Only meaningful when `force` is true
	// (a regular Parse run touches new files only — no "before"
	// state to diff against), but accumulating in either case
	// keeps the closure shape one branch lighter.
	matchesUpdatedSet := map[string]struct{}{}
	var heroCorrections, mapCorrections int
	_, err = parser.ParseScreenshotsDir(ctx, screenshotsDir, parsed, func(done, total int, filename string, result *parser.MatchResult, parseErr error) {
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
			reviews, _ := a.store.LoadReviews()
			// Diff the pre-insert snap against snapAfter so the
			// counter reflects what THIS file actually changed for
			// THIS match key. New matches (not present in `snap`)
			// still count as updated — they're records that emerged
			// from this run. Hero/map corrections only fire when
			// both snapshots resolve to a record (both `ok`) AND
			// the resolved field changed.
			beforeRec, beforeOk := aggregateMatchKey(key, snap, annos, hidden, reviews)
			if rec, ok := aggregateMatchKey(key, snapAfter, annos, hidden, reviews); ok {
				a.emitMatchUpdated(rec)
				matchesUpdatedSet[key] = struct{}{}
				if beforeOk {
					if beforeRec.Data.Hero != rec.Data.Hero {
						heroCorrections++
					}
					if beforeRec.Data.Map != rec.Data.Map {
						mapCorrections++
					}
				}
			}
		}
		ev.MatchesUpdated = len(matchesUpdatedSet)
		ev.HeroCorrections = heroCorrections
		ev.MapCorrections = mapCorrections
		a.emitParseProgress(ev)
	})
	// User pressed Stop mid-batch. The partial state already
	// committed to SQLite stays put (each per-file insert ran
	// inside the callback before the next iteration). Emit
	// parse-cancelled so the frontend can flip the Stop button
	// back to Run; skip the normal error return because the
	// user asked for this.
	if errors.Is(err, context.Canceled) {
		a.emitParseCancelled()
		return nil
	}
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
			Map: r.Map, Playlist: r.Playlist, Hero: r.Hero,
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

	case "teams":
		row := db.TeamsRow{
			Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
			Eliminations: r.Eliminations, Assists: r.Assists, Deaths: r.Deaths,
			Damage: r.Damage, Healing: r.Healing, Mitigation: r.Mitigation,
			QueueType: r.QueueType,
		}
		row.HeroStats = flattenHeroStats(r.HeroesPlayed)
		return a.store.UpsertTeams(row)

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
