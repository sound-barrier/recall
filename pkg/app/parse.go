package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"recall/pkg/aggregate"
	"recall/pkg/applog"
	"recall/pkg/correlate"
	"recall/pkg/db"
	"recall/pkg/match"
	"recall/pkg/parser"
)

// ErrNoParseInFlight is returned by CancelParse when no parse is
// running. The HTTP layer maps this to 409 Conflict — the request
// was well-formed, the server's runtime state just doesn't have
// anything to cancel.
var ErrNoParseInFlight = errors.New("no parse in flight")

// ErrParseInFlight is returned by the parse entry points when a parse
// is already running. Single-flight is fail-fast (not queued): a second
// trigger — a user click, a watcher debounce, or a concurrent POST —
// gets this rather than waiting behind the running loop. The HTTP layer
// maps it to 409 Conflict.
var ErrParseInFlight = errors.New("a parse is already in flight")

// ParseScreenshotsDirFunc is the OCR-loop entry point — a function-variable
// seam (the codebase's DI convention, cf. RunTesseractFunc / ReleasesURL) so
// tests can stub the Tesseract-backed parse and drive handleFile with synthetic
// results instead of running real OCR over real images. Production points at
// parser.ParseScreenshotsDir.
var ParseScreenshotsDirFunc = parser.ParseScreenshotsDir

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

// ActiveParseStatus is the GET /api/v1/parses/active snapshot — enough
// for a reconnecting / reloading client to decide "is a parse running,
// and how far along" without the SSE backlog (which isn't replayed on
// connect). The resync anchor for the async-job pipeline.
type ActiveParseStatus struct {
	Running bool   `json:"running"`
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Scope   string `json:"scope"`
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
//
// Synchronous (blocks until the run finishes) — the Wails IPC path +
// Go tests rely on that. Server mode uses StartParse instead.
func (a *App) ReParseAll() error {
	return a.parseSync(true)
}

// ParseScreenshots OCRs every image in screenshots/ and writes each
// result to its per-type table. Correlation (correlate.ResolveMatchKey) runs per
// screenshot in filename-timestamp order so cross-file deps (e.g. a
// PERSONAL adopting the SUMMARY it shares a match with) see the
// already-inserted siblings. Synchronous; see ReParseAll / StartParse.
func (a *App) ParseScreenshots() error {
	return a.parseSync(false)
}

// StartParse kicks off a parse in a BACKGROUND goroutine and returns
// immediately — the server's POST /api/v1/parses path. Progress +
// completion reach the client over SSE (parse-progress / parse-complete
// / parse-cancelled); GET /api/v1/parses/active is the resync anchor.
// Preconditions are validated synchronously so the caller still gets a
// 409/500 before the 202; a parse already in flight returns
// ErrParseInFlight. This is what makes the run survive a client network
// drop — there's no held-open request to lose.
func (a *App) StartParse(force bool) error {
	dir, err := a.validateParsePreconditions()
	if err != nil {
		return err
	}
	ctx, ok := a.claimParse(force)
	if !ok {
		return ErrParseInFlight
	}
	go func() {
		defer applog.RecoverPanic("parse")
		defer a.endParse()
		if runErr := a.runClaimedParse(ctx, force, dir); runErr != nil {
			applog.Subsystem("parse").Error("background parse failed", "err", runErr)
		}
	}()
	return nil
}

// parseSync runs a parse to completion on the caller's goroutine — the
// Wails IPC path, the watcher debounce, and Go tests all rely on the
// call blocking until the OCR loop finishes. Fail-fast single-flight
// (ErrParseInFlight) instead of queueing behind a held mutex.
func (a *App) parseSync(force bool) error {
	dir, err := a.validateParsePreconditions()
	if err != nil {
		return err
	}
	ctx, ok := a.claimParse(force)
	if !ok {
		return ErrParseInFlight
	}
	defer a.endParse()
	return a.runClaimedParse(ctx, force, dir)
}

// ActiveParse returns the current run-state snapshot.
func (a *App) ActiveParse() ActiveParseStatus {
	a.parseCancelMu.Lock()
	defer a.parseCancelMu.Unlock()
	return ActiveParseStatus{
		Running: a.parseRunning,
		Done:    a.parseDone,
		Total:   a.parseTotal,
		Scope:   a.parseScope,
	}
}

// validateParsePreconditions runs the cheap up-front checks (dir
// configured + readable, tesseract present) so both the sync and async
// entry points fail fast BEFORE claiming the run slot or spawning a
// goroutine. Returns the cleaned screenshots dir for the loop.
func (a *App) validateParsePreconditions() (string, error) {
	if err := a.assertActiveMutable(); err != nil {
		return "", err
	}
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

func scopeLabel(force bool) string {
	if force {
		return "all"
	}
	return "new"
}

// claimParse takes the single-flight slot: false when a parse is already
// running. On success it stamps the run-state snapshot + creates the
// cancel ctx the OCR loop checks between files. Paired with endParse.
func (a *App) claimParse(force bool) (context.Context, bool) {
	return a.claimRunSlot(scopeLabel(force))
}

// claimRunSlot takes the single-flight slot for any operation that needs
// the store to itself — OCR runs and profile activations alike (a store
// swap under a live parse would close the handle out from under the
// loop). scope labels the run for the ActiveParse resync snapshot.
func (a *App) claimRunSlot(scope string) (context.Context, bool) {
	a.parseCancelMu.Lock()
	defer a.parseCancelMu.Unlock()
	if a.parseRunning {
		return nil, false
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.parseRunning = true
	a.parseCancel = cancel
	a.parseScope = scope
	a.parseDone, a.parseTotal = 0, 0
	return ctx, true
}

// endParse releases the single-flight slot and cancels the ctx (a no-op
// after normal completion; the signal that unwinds the loop on cancel).
func (a *App) endParse() {
	a.parseCancelMu.Lock()
	defer a.parseCancelMu.Unlock()
	if a.parseCancel != nil {
		a.parseCancel()
	}
	a.parseRunning = false
	a.parseCancel = nil
}

// noteProgress snapshots the per-file counter so GET /parses/active can
// report how far along a running parse is to a resyncing client.
func (a *App) noteProgress(done, total int) {
	a.parseCancelMu.Lock()
	a.parseDone, a.parseTotal = done, total
	a.parseCancelMu.Unlock()
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
	parsed, err := a.parsedSkipSet(force)
	if err != nil {
		return err
	}
	// Byte-identical copies of already-ingested files skip OCR entirely
	// (dedup.go) — they join the skip set before the loop starts.
	a.dedupNewFiles(screenshotsDir, parsed)

	// Record the source folder once per batch so every screenshot in
	// this Parse run is FK'd to the same screenshots_dirs row. Resolved
	// up-front because the parser callback below fires per-file during
	// OCR and we don't want to repeat this lookup on every shot.
	dirID, err := a.store.EnsureScreenshotsDir(screenshotsDir)
	if err != nil {
		return err
	}

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
	annos, _ := a.store.LoadAnnotations()
	hidden, _ := a.store.LoadHiddenKeys()
	reviews, _ := a.store.LoadReviews()
	pinned, _ := a.store.LoadPinnedKeys()
	st := &parseRunState{
		app: a, dirID: dirID, matchesUpdated: map[string]struct{}{},
		snap: snap, annos: annos, hidden: hidden, reviews: reviews, pinned: pinned,
		preRunKeys: snapshotMatchKeys(snap),
	}
	_, err = ParseScreenshotsDirFunc(ctx, screenshotsDir, parsed, st.handleFile)
	// User pressed Stop mid-batch. The partial state already committed to
	// SQLite stays put (each per-file insert ran inside the callback before
	// the next iteration). Emit parse-cancelled so the frontend can flip the
	// Stop button back to Run; skip the normal error return because the user
	// asked for this.
	if errors.Is(err, context.Canceled) {
		a.emitParseCancelled()
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
// user-curated suppress-list ("Delete forever" in the Unknown tab). Errors
// loading the ignored / recognized sets don't abort the parse — it's a UX
// nicety, not a correctness invariant; an empty set just means nothing's
// suppressed. The suppress list IS honoured even on ReParseAll (force) — the
// user explicitly told us never to look at those files again.
func (a *App) parsedSkipSet(force bool) (map[string]bool, error) {
	parsed := map[string]bool{}
	if !force {
		var err error
		parsed, err = a.store.LoadAllFilenames()
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
	snap    db.Screenshots
	annos   map[string]db.Annotation
	hidden  map[string]bool
	reviews map[string]db.ReviewState
	pinned  map[string]bool
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
	// A parse that now succeeds clears any standing failure row — the
	// file graduated out of the triage list.
	if err := a.store.RemoveFailedFile(filename); err != nil {
		applog.Subsystem("parse").Warn("clear failed file", "filename", filename, "err", err)
	}

	key, ambigCands := correlate.ResolveMatchKey(filename, result, st.snap)
	ev.MatchKey = key
	// The pre-insert aggregate for this key, from the carried snapshot —
	// the correction tallies diff against it after the write lands.
	beforeRec, beforeOk := aggregate.AggregateMatchKey(key, st.snap, st.annos, st.hidden, st.reviews, st.pinned)

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

// recordMatchUpdate diffs the pre-insert aggregate for `key` against the
// post-insert carried snapshot, emits match-updated, and tallies hero/map
// corrections. New matches (no pre-insert aggregate) still count as
// updated — they emerged from this run; corrections only fire when both
// sides resolve a record and the field changed.
func (st *parseRunState) recordMatchUpdate(key string, beforeRec match.MatchRecord, beforeOk bool) {
	rec, ok := aggregate.AggregateMatchKey(key, st.snap, st.annos, st.hidden, st.reviews, st.pinned)
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

func buildSummaryRow(filename, key string, dirID int64, r *parser.MatchResult) db.SummaryRow {
	row := db.SummaryRow{
		Filename: filename, MatchKey: key, ScreenshotsDirID: dirID,
		Map: r.Map, Playlist: r.Playlist, Hero: r.Hero,
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
		Eliminations: r.Eliminations, Assists: r.Assists, Deaths: r.Deaths,
		Damage: r.Damage, Healing: r.Healing, Mitigation: r.Mitigation,
		QueueType: r.QueueType,
	}
	row.HeroStats = flattenHeroStats(r.HeroesPlayed)
	return row
}

func buildPersonalRow(filename, key string, dirID int64, r *parser.MatchResult) db.PersonalRow {
	row := db.PersonalRow{
		Filename: filename, MatchKey: key, ScreenshotsDirID: dirID, Hero: r.Hero,
	}
	row.HeroStats = flattenHeroStats(r.HeroesPlayed)
	return row
}

func buildRankRow(filename, key string, dirID int64, r *parser.MatchResult) db.RankRow {
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
	return row
}

func buildUnknownRow(filename, key string, dirID int64) db.UnknownRow {
	return db.UnknownRow{Filename: filename, MatchKey: key, ScreenshotsDirID: dirID}
}

func (a *App) insertParsed(filename, key, t string, dirID int64, r *parser.MatchResult) error {
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
