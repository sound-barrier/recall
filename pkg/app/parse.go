package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"recall/pkg/aggregate"
	"recall/pkg/applog"
	"recall/pkg/correlate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// ParseScreenshotsDirFunc is the OCR-loop entry point — a function-variable
// seam (the codebase's DI convention, cf. RunTesseractFunc / ReleasesURL) so
// tests can stub the Tesseract-backed parse and drive handleFile with synthetic
// results instead of running real OCR over real images. Production points at
// parser.ParseScreenshotsDir.
var ParseScreenshotsDirFunc = parser.ParseScreenshotsDir

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

// validateParsePreconditions runs the cheap up-front checks (dir
// configured + readable, tesseract present) so both the sync and async
// entry points fail fast BEFORE claiming the run slot or spawning a
// goroutine. Returns the cleaned screenshots dir for the loop.
func (a *App) validateParsePreconditions() (string, error) {
	screenshotsDir, err := validateScreenshotsDir(a.settingsSnapshot().ScreenshotsDir)
	if err != nil {
		return "", err
	}
	if !a.tessStatusSnapshot().Found {
		s := checkTesseract(a.settingsSnapshot().TesseractPath)
		a.setTessStatus(s)
		if !s.Found {
			return "", fmt.Errorf("tesseract is not available: %s", s.Error)
		}
	}
	return screenshotsDir, nil
}

// runClaimedParse is the OCR loop body. Preconditions are already
// validated and the run slot already claimed (claimParse); this drives
// the parse and emits the lifecycle events. It emits parse-complete on
// success so EVERY path (server POST, Wails IPC, watcher) signals
// completion the same way — the linchpin that lets the server return
// 202 up-front instead of holding the request open for the whole run.
func (a *App) runClaimedParse(ctx context.Context, force bool, screenshotsDir string) error {
	// A force run (Re-parse All) rewrites every row from OCR — take a
	// silent safety snapshot first (backup_auto.go; never blocks).
	if force {
		a.snapshotBeforeReparse()
	}
	// This run consumes whatever the watcher queued — clear the
	// masthead's "N new" tally up front (the parse chip takes over).
	a.resetWatchActivity()
	// Record the source folder once per batch so every screenshot in this
	// Parse run is FK'd to the same screenshots_dirs row — and so the skip
	// set below can be scoped to it.
	dirID, err := a.store.EnsureScreenshotsDir(screenshotsDir)
	if err != nil {
		return err
	}
	parsed, err := a.parsedSkipSet(dirID, force)
	if err != nil {
		return err
	}
	// Byte-identical copies of already-ingested files skip OCR entirely
	// (dedup.go) — they join the skip set before the loop starts.
	a.dedupNewFiles(screenshotsDir, parsed)

	// Per-file work runs INSIDE the parser callback (parseRunState.handleFile)
	// so insert + match-updated emit fire as each screenshot finishes OCR.
	// Before this shape, the writes lived in a post-OCR for-loop that only ran
	// after every file had been OCR'd; the UI saw `parse-progress` stream
	// cleanly but `match-updated` arrived in a single last-instant burst, so
	// the Matches tab stayed blank until parse-complete.
	// One snapshot + sidecar load per RUN (patched in-memory per file —
	// see parse_snapshot.go); the loop previously re-materialized the
	// whole store twice per screenshot. Sidecars stay best-effort like
	// the per-file loads they replace: a failed load just mutes the
	// correction tallies, never the parse.
	snap, err := a.store.LoadAll()
	if err != nil {
		return err
	}
	st := &parseRunState{
		app: a, dirID: dirID, matchesUpdated: map[string]struct{}{},
		snap: snap, sidecars: a.loadSidecars(),
		preRunKeys: snapshotMatchKeys(snap),
	}
	_, err = ParseScreenshotsDirFunc(ctx, screenshotsDir, parsed, st.handleFile)
	// User pressed Stop mid-batch. The partial state already committed to
	// SQLite stays put (each per-file insert ran inside the callback before
	// the next iteration). Emit parse-canceled so the frontend can flip the
	// Stop button back to Run; skip the normal error return because the user
	// asked for this.
	if errors.Is(err, context.Canceled) {
		a.emitParseCanceled()
		return nil
	}
	if err != nil {
		return err
	}
	// Only now, with the run's capture sets complete, can a re-captured
	// match be recognized: its stat line lives under one fresh key
	// regardless of which file minted it (duplicate_sweep.go).
	st.sweepNewMatchDuplicates()
	// Post-run DB maintenance — self-gating, skipped when nothing changed.
	a.optimizeAfterParse(len(st.matchesUpdated))
	// Periodic safety net — writes a snapshot iff one is due (backup_scheduler.go).
	a.maybeAutoBackup()
	// Authoritative completion signal for EVERY parse path. The frontend
	// drives parseBusy off this (not a held-open request), and the watcher
	// no longer emits it separately. The distinct-match count feeds the desktop
	// native notification (no-op in server mode).
	a.emitParseComplete(len(st.matchesUpdated))
	return nil
}

// parsedSkipSet builds the set of filenames the parser should skip: the
// already-parsed files (unless force) — plus the recognized-but-unstored
// All-Heroes screens, which skip on a normal run but are re-examined on a
// force ReParseAll exactly like already-parsed files — unioned with the
// user-curated suppress-list ("Delete forever" in the Unknown tab) and the
// registry's standing byte-identical duplicates. Errors loading the ignored /
// recognized / duplicate sets don't abort the parse — it's a UX nicety, not a
// correctness invariant; an empty set just means nothing's suppressed. The
// suppress list and the duplicate registry ARE honored even on ReParseAll
// (force) — the user explicitly told us never to look at those files again,
// and a duplicate's canonical re-parses in its place.
//
// GetNewScreenshotCount reports the same set's complement as the pending
// count, so the "Run Parse · N" button and the progress panel's "X / N files"
// can't disagree. Anything new that suppresses a file belongs HERE, not in a
// second skip set at the call site.
// dirID scopes the "already parsed" half: filename is a BASENAME, and
// screenshots_dirs accumulates a row every time the user re-points the
// folder. Keyed on the basename alone, a same-named capture in a second
// folder counted as already parsed and was silently never ingested — no
// row, no failed entry, nothing on the Unknown tab, and missing from the
// pending count too, so nothing ever said so.
func (a *App) parsedSkipSet(dirID int64, force bool) (map[string]bool, error) {
	parsed := map[string]bool{}
	if !force {
		var err error
		parsed, err = a.store.LoadFilenamesForDir(dirID)
		if err != nil {
			return nil, err
		}
		// All-Heroes screens carry no stored parent row, so LoadAllFilenames
		// misses them; union their recognized-skip list here so a normal
		// re-parse doesn't re-OCR them. Skipped only on a normal run (not
		// force): the recognition is automatic, so a full ReParseAll should
		// reconsider it.
		recognized, _ := a.store.LoadAllHeroesFilenames()
		for f := range recognized {
			parsed[f] = true
		}
	}
	ignored, _ := a.store.LoadIgnoredFilenames()
	for f := range ignored {
		parsed[f] = true
	}
	for f := range a.standingDuplicates() {
		parsed[f] = true
	}
	return parsed, nil
}

// parseRunState accumulates per-file outcomes across one Parse batch so the
// callback can report cumulative counts (matches updated, hero/map
// corrections) as each screenshot finishes OCR.
type parseRunState struct {
	app             *App
	dirID           int64
	matchesUpdated  map[string]struct{}
	heroCorrections int
	mapCorrections  int
	// Run-scoped correlation snapshot + sidecars: loaded once at run
	// start, patched in-memory after each insert (parse_snapshot.go).
	snap     db.Screenshots
	sidecars aggregate.Sidecars
	// Match keys that existed before this run started — the duplicate
	// sweep (duplicate_sweep.go) only judges keys minted during the
	// run, so pre-existing history is never demoted and ReParseAll
	// (where every re-adopted key pre-exists) is exempt by construction.
	preRunKeys map[string]struct{}
}

// handleFile is the per-file parser callback: snapshot progress, insert the
// parsed row, reconcile ambiguity, then emit match-updated. Every exit path
// emits a progress event so the footer counter advances regardless of
// outcome.
func (st *parseRunState) handleFile(done, total int, filename string, result *parser.MatchResult, parseErr error) {
	a := st.app
	// Snapshot progress for the GET /parses/active resync anchor before any
	// per-file work, so a status read always reflects the file in flight.
	a.noteProgress(done, total)
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
	// Skip insert/aggregate on per-file parse failure but still emit the
	// progress event so the user sees an accurate file count. Record the
	// failure in the ledger so the Unknown tab can triage it — a UX
	// nicety, not a correctness invariant, so a store error only logs.
	// The ledger is NOT a skip list: the file is re-attempted next run.
	if parseErr != nil || result == nil {
		errMsg := "parser returned no result"
		if parseErr != nil {
			errMsg = parseErr.Error()
		}
		if err := a.store.RecordFailedFile(filename, st.dirID, errMsg); err != nil {
			applog.Subsystem("parse").Warn("record failed file", "filename", filename, "err", err)
		}
		a.emitParseProgress(ev)
		return
	}
	st.reconcileFailureLedger(filename, result)

	key, ambigCands := correlate.ResolveMatchKey(filename, result, st.snap)
	ev.MatchKey = key
	// The pre-insert aggregate for this key, from the carried snapshot —
	// the correction tallies diff against it after the write lands.
	beforeRec, beforeOk := aggregate.MatchKey(key, st.snap, st.sidecars)

	if err := a.insertParsed(filename, key, ev.Type, st.dirID, result); err != nil {
		ev.Error = "insert: " + err.Error()
		a.emitParseProgress(ev)
		return
	}
	// ApplyAmbiguity wipes any prior ambiguous record for this filename and
	// re-inserts iff ambigCands is non-empty — a re-parse that newly resolves
	// (or newly surfaces) ambiguity updates the candidates table in lockstep.
	if err := a.store.ApplyAmbiguity(filename, ambigCands); err != nil {
		ev.Error = "ambiguity: " + err.Error()
		a.emitParseProgress(ev)
		return
	}
	// Mirror both writes onto the carried snapshot so the NEXT file
	// correlates against this one, exactly as the per-file reload did.
	st.applyToSnapshot(filename, key, ev.Type, result)
	st.applyAmbiguityToSnapshot(filename, ambigCands)

	st.recordMatchUpdate(key, beforeRec, beforeOk)
	ev.MatchesUpdated = len(st.matchesUpdated)
	ev.HeroCorrections = st.heroCorrections
	ev.MapCorrections = st.mapCorrections
	a.emitParseProgress(ev)
}

// reconcileFailureLedger keeps the triage ledger in step with a parse that
// SUCCEEDED. A clean parse graduates out of the list. A parse the parser
// flagged as degraded — a stat cell whose OCR failed, a hero card that lost
// its timing — keeps a row instead: everything it DID read is still stored
// (a missing stat must not block the match from landing), but the file stays
// visible in the Unknown tab so the user can re-parse it deliberately. Ledger
// writes are a UX nicety, not a correctness invariant, so a store error only
// logs.
func (st *parseRunState) reconcileFailureLedger(filename string, result *parser.MatchResult) {
	if len(result.Warnings) == 0 {
		if err := st.app.store.RemoveFailedFile(filename); err != nil {
			applog.Subsystem("parse").Warn("clear failed file", "filename", filename, "err", err)
		}
		return
	}
	summary := strings.Join(result.Warnings, "; ")
	if err := st.app.store.RecordFailedFile(filename, st.dirID, summary); err != nil {
		applog.Subsystem("parse").Warn("record degraded file", "filename", filename, "err", err)
	}
}

// recordMatchUpdate diffs the pre-insert aggregate for `key` against the
// post-insert carried snapshot, emits match-updated, and tallies hero/map
// corrections. New matches (no pre-insert aggregate) still count as
// updated — they emerged from this run; corrections only fire when both
// sides resolve a record and the field changed.
func (st *parseRunState) recordMatchUpdate(key string, beforeRec match.Record, beforeOk bool) {
	rec, ok := aggregate.MatchKey(key, st.snap, st.sidecars)
	if !ok {
		return
	}
	st.app.emitMatchUpdated(rec)
	st.matchesUpdated[key] = struct{}{}
	if beforeOk {
		if beforeRec.Data.Hero != rec.Data.Hero {
			st.heroCorrections++
		}
		if beforeRec.Data.Map != rec.Data.Map {
			st.mapCorrections++
		}
	}
}

// insertParsed dispatches a parsed result to the right Upsert method on
// the store, materializing children from the parser's nested types.
// dirID is the screenshots_dirs FK resolved once per batch by the
// caller (0 = unset; the store renders that as SQL NULL).
// The build*Row constructors are shared by the store write (insertParsed)
// and the run snapshot's in-memory mirror (applyToSnapshot) — one source
// for the row fields, so the mirror can't drift from what was written.
// canonicalPlayedAtUTC derives the match's canonical UTC instant from its
// naive local date+finished_at, interpreting the wall clock in the machine's
// timezone identity (time.Local — a full zone, so DST is correct per match
// date). Returns nil (→ SQL NULL) when the pair is absent/unparseable. The
// naive date/finished_at stay naive-local on the row; this is additive.
func canonicalPlayedAtUTC(date, finishedAt string) *string {
	utc, ok := match.LocalWallClockToUTC(date, finishedAt, time.Local)
	if !ok {
		return nil
	}
	s := utc.Format(time.RFC3339)
	return &s
}

// ParseStaleness reports how many matches a Re-parse All would actually improve,
// alongside the generation doing the judging.
//
// A parser fix reaches only files parsed after it ships, and nothing used to say
// so — the improvement landed on new captures while the existing history kept its
// old readings, and a chart drawn over both mixed vintages without a hint. This
// is what lets the UI say "N matches were read by an older version" instead of
// leaving the user to guess whether Re-parse All has anything to do.
type ParseStaleness struct {
	StaleMatches     int `json:"stale_matches"`
	ParserGeneration int `json:"parser_generation"`
}

// GetParseStaleness implements the staleness surface.
func (a *App) GetParseStaleness() (ParseStaleness, error) {
	n, err := a.store.StaleParseCount(parser.Generation)
	if err != nil {
		return ParseStaleness{}, err
	}
	return ParseStaleness{StaleMatches: n, ParserGeneration: parser.Generation}, nil
}

func buildSummaryRow(filename, key string, dirID int64, r *parser.MatchResult) db.SummaryRow {
	row := db.SummaryRow{
		Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
		ParserGeneration: parser.Generation,
		Map:              r.Map, Playlist: r.Playlist, Hero: r.Hero,
		Result: r.Result, FinalScore: r.FinalScore,
		Date: r.Date, FinishedAt: r.FinishedAt, GameLength: r.GameLength,
		PlayedAtUTC: canonicalPlayedAtUTC(r.Date, r.FinishedAt),
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
	return row
}

func buildTeamsRow(filename, key string, dirID int64, r *parser.MatchResult) db.TeamsRow {
	row := db.TeamsRow{
		Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
		ParserGeneration: parser.Generation,
		Eliminations:     r.Eliminations, Assists: r.Assists, Deaths: r.Deaths,
		Damage: r.Damage, Healing: r.Healing, Mitigation: r.Mitigation,
		QueueType: r.QueueType,

		HeroStats: flattenHeroStats(r.HeroesPlayed)}
	return row
}

func buildPersonalRow(filename, key string, dirID int64, r *parser.MatchResult) db.PersonalRow {
	row := db.PersonalRow{
		Filename: filename, MatchKey: key, ScreenshotsDirID: dirID, Hero: r.Hero,
		ParserGeneration: parser.Generation,

		HeroStats: flattenHeroStats(r.HeroesPlayed)}
	return row
}

func buildRankRow(filename, key string, dirID int64, r *parser.MatchResult) db.RankRow {
	row := db.RankRow{
		Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
		ParserGeneration: parser.Generation,
		Rank:             r.Rank, Level: r.Level,
		RankProgress: r.RankProgress, ChangePercent: r.ChangePercent,
		Result:       r.Result,
		Modifiers:    append([]string(nil), r.Modifiers...),
		ModifiersRaw: r.ModifiersRaw,
		// Copied by value, not aliased: the parse result is reused after this
		// and a shared pointer would let a later write reach into a stored row.
		RankPercentile: copyIntPtr(r.RankPercentile),
	}
	for _, sr := range r.SR {
		row.SR = append(row.SR, db.HeroSR{Hero: sr.Hero, SR: sr.SR, Change: sr.Change})
	}
	return row
}

// copyIntPtr clones an optional int so the stored row owns its value.
func copyIntPtr(v *int) *int {
	if v == nil {
		return nil
	}
	out := *v
	return &out
}

func buildUnknownRow(filename, key string, dirID int64) db.UnknownRow {
	return db.UnknownRow{
		Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
		ParserGeneration: parser.Generation,
	}
}

func (a *App) insertParsed(filename, key, t string, dirID int64, r *parser.MatchResult) error {
	// A re-parse can reclassify a file (a parser fix reading a screen that
	// once stored as another type); wipe its rows from the sibling type
	// tables first or the stale row aggregates beside the new one forever.
	// EXCEPT toward all_heroes: it stores no data, only a skip-registry
	// filename, so evicting a real typed row in its favor converts a probe
	// false-positive into silent permanent loss (rowless, skip-listed, no
	// ledger entry, and the deterministic misread repeats every re-parse).
	if t != "all_heroes" {
		if err := a.store.DeleteScreenshotSiblings(filename, t); err != nil {
			return err
		}
	}
	switch t {
	case "summary":
		return a.store.UpsertSummary(buildSummaryRow(filename, key, dirID, r))
	case "teams":
		return a.store.UpsertTeams(buildTeamsRow(filename, key, dirID, r))
	case "personal":
		return a.store.UpsertPersonal(buildPersonalRow(filename, key, dirID, r))
	case "rank":
		return a.store.UpsertRank(buildRankRow(filename, key, dirID, r))
	case "all_heroes":
		// Recognized but intentionally not stored as match data: its combat
		// totals duplicate the TEAMS screen and its card icons defeat the OCR.
		// Record only the filename so the next parse run skips it (no re-OCR),
		// without a garbage match row or an Unknown-tab entry.
		return a.store.UpsertAllHeroesScreenshot(filename)
	default: // unknown
		return a.store.UpsertUnknown(buildUnknownRow(filename, key, dirID))
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
