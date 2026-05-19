package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"recall/pkg/db"
	"recall/pkg/metrics"
	"recall/pkg/parser"
)

type MatchRecord struct {
	ID          int64    `json:"id"`
	MatchKey    string   `json:"match_key"`
	SourceFiles []string `json:"source_files"`
	// SourceTypes maps a source filename to the OW2 screenshot type the
	// parser classified it as ("summary" / "scoreboard" / "personal" /
	// "rank"). Populated at parse time and persisted in the DB so the UI
	// can label each file. May be nil/missing for rows parsed before
	// type tracking landed — fall back to the per-row Data-Coverage
	// inference when a file isn't in the map.
	SourceTypes map[string]string  `json:"source_types,omitempty"`
	Data        parser.MatchResult `json:"data"`
}

// Settings is the on-disk JSON config the user persists across runs.
// New user-tweakable knobs can be added as new fields without migration
// (missing fields unmarshal to their zero value — which is exactly the
// default for the boolean toggles).
type Settings struct {
	ScreenshotsDir    string `json:"screenshots_dir"`
	TesseractPath     string `json:"tesseract_path"`
	PrometheusEnabled bool   `json:"prometheus_enabled"`
	WatchEnabled      bool   `json:"watch_enabled"`
}

// TesseractStatus describes whether the configured tesseract binary
// resolves to a working executable. The frontend renders the System
// Alert banner and the Engine setting state from this struct.
type TesseractStatus struct {
	Path    string `json:"path"`
	Found   bool   `json:"found"`
	Version string `json:"version"`
	Error   string `json:"error"`
	Default string `json:"default"`
}

// defaultTesseractPath returns the most likely on-disk install location
// for the current platform, falling through to whatever's on PATH and
// finally a bare "tesseract" hint. macOS prefers the Homebrew prefix
// (Apple Silicon first, then Intel). Linux prefers /usr/bin (the apt
// install location); Windows checks both Program Files variants.
func defaultTesseractPath() string {
	var candidates []string
	switch runtime.GOOS {
	case "darwin":
		candidates = []string{
			"/opt/homebrew/bin/tesseract",
			"/usr/local/bin/tesseract",
		}
	case "linux":
		candidates = []string{
			"/usr/bin/tesseract",
			"/usr/local/bin/tesseract",
		}
	case "windows":
		candidates = []string{
			`C:\Program Files\Tesseract-OCR\tesseract.exe`,
			`C:\Program Files (x86)\Tesseract-OCR\tesseract.exe`,
		}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	if p, err := exec.LookPath("tesseract"); err == nil {
		return p
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return "tesseract"
}

// checkTesseract runs `<path> --version` and parses the output. On
// success returns the version string (e.g. "5.4.1"); on failure
// populates the Error field with a human-readable explanation suitable
// for surfacing directly in the UI banner.
func checkTesseract(path string) TesseractStatus {
	s := TesseractStatus{Path: path, Default: defaultTesseractPath()}
	if path == "" {
		s.Error = "Tesseract path is empty — pick the binary in Settings → Engine."
		return s
	}
	cmd := exec.Command(path, "--version")
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// Distinguish "file doesn't exist" from "ran but failed".
		if _, statErr := os.Stat(path); statErr != nil {
			s.Error = fmt.Sprintf("Nothing exists at %s. Install Tesseract or change the path in Settings → Engine.", path)
		} else {
			s.Error = fmt.Sprintf("Could not run %s: %v", path, err)
		}
		return s
	}
	// `tesseract --version` writes its banner to stderr on most builds,
	// stdout on others. Concatenate both so we don't depend on the
	// channel.
	output := stdout.String() + stderr.String()
	first := strings.TrimSpace(strings.SplitN(output, "\n", 2)[0])
	if !strings.HasPrefix(strings.ToLower(first), "tesseract") {
		s.Error = "Binary at that path doesn't identify as Tesseract: " + first
		return s
	}
	s.Found = true
	v := strings.TrimSpace(strings.TrimPrefix(first, "tesseract"))
	v = strings.TrimSpace(strings.TrimPrefix(v, "v"))
	s.Version = v
	return s
}

// watchDebounce is how long we wait after seeing a new screenshot
// before kicking off a parse. The user typically takes 3–4 screenshots
// in quick succession (SUMMARY → TEAMS → PERSONAL → rank screen); we
// don't want to fire ParseScreenshots once per file. 60 seconds is
// generous enough to absorb a slow tab-cycler.
const watchDebounce = 60 * time.Second

// appDataDir returns the platform-appropriate directory for Recall's
// settings and database. It follows OS conventions so the files land in
// the right place for a distributed app regardless of cwd:
//
//	macOS:   ~/Library/Application Support/Recall/
//	Linux:   $XDG_CONFIG_HOME/recall/  (fallback ~/.config/recall/)
//	Windows: %AppData%\Recall\
func appDataDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		// Should not happen on any supported OS; fall back to ~/.recall.
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".recall")
	}
	name := "recall"
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		name = "Recall"
	}
	return filepath.Join(base, name)
}

func settingsPath() string { return filepath.Join(appDataDir(), "settings.json") }

func loadSettings() Settings {
	s := Settings{ScreenshotsDir: "screenshots"} // relative default works for `wails dev`
	raw, err := os.ReadFile(settingsPath())
	if err != nil {
		return s // file doesn't exist yet (first run); use defaults
	}
	_ = json.Unmarshal(raw, &s) // ignore malformed JSON; keep defaults
	if s.ScreenshotsDir == "" {
		s.ScreenshotsDir = "screenshots"
	}
	return s
}

func saveSettings(s Settings) error {
	if err := os.MkdirAll(filepath.Dir(settingsPath()), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(settingsPath(), b, 0o644)
}

type App struct {
	ctx      context.Context
	settings Settings
	// tessStatus is the last result of checkTesseract(). Refreshed on
	// Startup, on SetTesseractPath, on PickTesseractBinary, and on
	// ResetTesseractPath. Read-only from the Wails GetTesseractStatus
	// binding the frontend polls; mutated only on the same goroutine
	// that responds to the bound calls (no lock needed).
	tessStatus TesseractStatus
	// metricsServer is non-nil only while the Prometheus endpoint is
	// running. SetPrometheusEnabled toggles between nil and a fresh
	// *metrics.Server (http.Server can't be reused after Shutdown, so
	// each enable creates a new one).
	metricsServer *metrics.Server
	// File-watch state. watcher is non-nil while the directory is being
	// observed; watchTimer holds the debounce timer that fires
	// ParseScreenshots after no new files have appeared for
	// watchDebounce. watchMu guards all three plus watchedDir.
	watcher    *fsnotify.Watcher
	watchedDir string
	watchTimer *time.Timer
	watchMu    sync.Mutex
	// parseMu serializes ParseScreenshots so an auto-trigger from the
	// watcher can't overlap with a user-triggered click (or a second
	// debounce that fires while the first parse is still running).
	parseMu sync.Mutex
	// SSEHub is non-nil in --server mode. When set, parse-complete events
	// are broadcast over SSE instead of (or in addition to) the Wails
	// runtime event bus.
	SSEHub *SSEHub
}

func New() *App {
	return &App{}
}

// Startup initializes the app: loads settings, checks Tesseract, opens the
// SQLite database, and starts the metrics/watcher if configured. Called by
// the Wails runtime via OnStartup, or directly by pkg/cmd/server.go in
// headless mode.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	a.settings = loadSettings()

	// Resolve tesseract first — if the user hasn't configured a path,
	// pick the platform default and persist it so the value is visible
	// in the Settings → Engine row on first launch. The status check
	// runs regardless; the frontend will render a System Alert banner
	// if the path doesn't resolve to a working binary.
	if a.settings.TesseractPath == "" {
		a.settings.TesseractPath = defaultTesseractPath()
		_ = saveSettings(a.settings)
	}
	a.tessStatus = checkTesseract(a.settings.TesseractPath)
	parser.SetTesseractPath(a.settings.TesseractPath)

	dbDir := filepath.Join(appDataDir(), "db")
	if err := os.MkdirAll(dbDir, 0o700); err != nil {
		log.Fatal("could not create db dir:", err)
	}
	if err := db.Init(filepath.Join(dbDir, "recall.db")); err != nil {
		log.Fatal("could not init db:", err)
	}

	// Start the Prometheus metrics endpoint only if the user has
	// explicitly enabled it via the checkbox (default off so the desktop
	// app doesn't open a network port without consent).
	if a.settings.PrometheusEnabled {
		a.startMetrics()
	}
	if a.settings.WatchEnabled {
		a.startWatching()
	}
}

// startWatching begins watching the configured screenshots directory
// for newly created image files. Each new file resets a debounce timer;
// when the timer elapses (watchDebounce after the last new file), the
// parser runs and the frontend is notified via a Wails event.
func (a *App) startWatching() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watcher != nil {
		return // already watching
	}
	dir := a.settings.ScreenshotsDir
	if dir == "" {
		log.Printf("watch: no screenshots directory configured, skipping")
		return
	}
	w, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("watch: NewWatcher failed: %v", err)
		return
	}
	if err := w.Add(dir); err != nil {
		log.Printf("watch: cannot watch %s: %v", dir, err)
		_ = w.Close()
		return
	}
	a.watcher = w
	a.watchedDir = dir
	log.Printf("watch: watching %s", dir)

	go a.runWatchLoop(w)
}

func (a *App) runWatchLoop(w *fsnotify.Watcher) {
	for {
		select {
		case ev, ok := <-w.Events:
			if !ok {
				return
			}
			// Care only about new files. Write events fire repeatedly
			// during a screenshot save; Create is the cleanest signal.
			if ev.Op&fsnotify.Create == 0 {
				continue
			}
			ext := strings.ToLower(filepath.Ext(ev.Name))
			if ext != ".png" && ext != ".jpg" && ext != ".jpeg" {
				continue
			}
			log.Printf("watch: new file %s — debouncing parse for %s", filepath.Base(ev.Name), watchDebounce)
			a.scheduleParseDebounced()
		case err, ok := <-w.Errors:
			if !ok {
				return
			}
			log.Printf("watch: error: %v", err)
		}
	}
}

// scheduleParseDebounced (re)arms the debounce timer. Each call resets
// it, so a burst of file-create events within watchDebounce collapses
// into a single ParseScreenshots invocation.
func (a *App) scheduleParseDebounced() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watchTimer != nil {
		a.watchTimer.Stop()
	}
	a.watchTimer = time.AfterFunc(watchDebounce, func() {
		log.Printf("watch: debounce elapsed, running ParseScreenshots")
		if err := a.ParseScreenshots(); err != nil {
			log.Printf("watch: parse failed: %v", err)
			return
		}
		// Tell the frontend to reload its records list. The Vue side
		// subscribes via runtime.EventsOn("parse-complete").
		a.emitParseComplete()
	})
}

// stopWatching tears down the watcher and cancels any pending debounce
// timer. Safe to call when no watcher is running.
func (a *App) stopWatching() {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	if a.watchTimer != nil {
		a.watchTimer.Stop()
		a.watchTimer = nil
	}
	if a.watcher == nil {
		return
	}
	prev := a.watchedDir
	_ = a.watcher.Close()
	a.watcher = nil
	a.watchedDir = ""
	log.Printf("watch: stopped watching %s", prev)
}

// GetWatchEnabled reports whether the watcher is currently active.
// Read by the frontend on mount to seed the checkbox state.
func (a *App) GetWatchEnabled() bool {
	return a.settings.WatchEnabled
}

// SetWatchEnabled toggles the directory watcher and persists the
// preference. Enabling/disabling takes effect immediately.
func (a *App) SetWatchEnabled(enabled bool) error {
	a.settings.WatchEnabled = enabled
	if err := saveSettings(a.settings); err != nil {
		return err
	}
	if enabled {
		a.startWatching()
	} else {
		a.stopWatching()
	}
	return nil
}

// startMetrics spins up a fresh metrics.Server. Idempotent: returns
// without re-binding if one is already running.
func (a *App) startMetrics() {
	if a.metricsServer != nil {
		return
	}
	s := metrics.NewServer(":9091", scrapeReader)
	s.Start()
	a.metricsServer = s
}

// stopMetrics gracefully shuts down the current metrics.Server, if any.
// Safe to call when no server is running.
func (a *App) stopMetrics() {
	if a.metricsServer == nil {
		return
	}
	a.metricsServer.Stop()
	a.metricsServer = nil
}

// GetPrometheusEnabled reports whether the Prometheus endpoint is
// currently bound. Read by the frontend on mount to seed the checkbox.
func (a *App) GetPrometheusEnabled() bool {
	return a.settings.PrometheusEnabled
}

// SetPrometheusEnabled toggles the metrics endpoint and persists the
// choice to settings.json so the preference survives app restarts.
// Returns nil on success; bind failures show up in the app logs rather
// than as an error here because they're non-fatal.
func (a *App) SetPrometheusEnabled(enabled bool) error {
	a.settings.PrometheusEnabled = enabled
	if err := saveSettings(a.settings); err != nil {
		return err
	}
	if enabled {
		a.startMetrics()
	} else {
		a.stopMetrics()
	}
	return nil
}

// GetScreenshotsDir returns the directory the parser will read from.
// Exposed to the frontend so the UI can show "Reading from <path>".
func (a *App) GetScreenshotsDir() string {
	return a.settings.ScreenshotsDir
}

// SetScreenshotsDir updates the configured screenshots directory and
// persists the change. Used by the REST API in server mode (replaces
// the native directory dialog).
func (a *App) SetScreenshotsDir(path string) error {
	a.settings.ScreenshotsDir = path
	return saveSettings(a.settings)
}

// ScreenshotHandler serves files from the user's configured screenshots
// directory under the `/_screenshot/<filename>` URL prefix. Wired into
// the Wails AssetServer in pkg/cmd/wails.go so the frontend can render
// <img src="/_screenshot/foo.png"> directly — no base64 round-trip via
// the JS↔Go bridge for what's potentially a multi-MB PNG.
//
// The directory comes from a.settings at REQUEST time, so changing the
// configured path via PickScreenshotsDir() takes effect immediately for
// subsequent image fetches without restarting the server.
func (a *App) ScreenshotHandler() http.Handler {
	const prefix = "/_screenshot/"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, prefix) {
			http.NotFound(w, r)
			return
		}
		name, err := url.PathUnescape(r.URL.Path[len(prefix):])
		if err != nil {
			http.Error(w, "bad name", http.StatusBadRequest)
			return
		}
		// Reject anything that isn't a plain basename — guards against
		// path traversal even though the filenames in source_files are
		// always basenames produced by the parser.
		if name == "" ||
			strings.ContainsAny(name, "/\\") ||
			strings.Contains(name, "..") {
			http.NotFound(w, r)
			return
		}
		dir := a.settings.ScreenshotsDir
		if dir == "" {
			http.NotFound(w, r)
			return
		}
		full := filepath.Join(dir, name)
		// Safety belt: confirm the resolved path is actually inside
		// the configured directory.
		dirAbs, err1 := filepath.Abs(dir)
		fullAbs, err2 := filepath.Abs(full)
		if err1 != nil || err2 != nil || !strings.HasPrefix(fullAbs+string(filepath.Separator), dirAbs+string(filepath.Separator)) {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, full)
	})
}

// GetTesseractStatus returns the cached result of the last detection
// run (refreshed on Startup + any path-changing call). Cheap — does not
// re-shell out to tesseract.
func (a *App) GetTesseractStatus() TesseractStatus {
	return a.tessStatus
}

// SetTesseractPath persists a user-typed or user-picked path, re-runs
// detection, and rewires the parser to use the new binary. The
// returned status reflects the new state so the frontend can refresh
// the Engine row + System Alert without a follow-up call.
func (a *App) SetTesseractPath(path string) (TesseractStatus, error) {
	path = strings.TrimSpace(path)
	a.settings.TesseractPath = path
	if err := saveSettings(a.settings); err != nil {
		return a.tessStatus, err
	}
	a.tessStatus = checkTesseract(path)
	parser.SetTesseractPath(path)
	return a.tessStatus, nil
}

// ResetTesseractPath restores the platform default and re-validates.
// Useful when the user has clobbered the path with something broken
// and wants to start over.
func (a *App) ResetTesseractPath() (TesseractStatus, error) {
	return a.SetTesseractPath(defaultTesseractPath())
}

// scrapeReader returns every match in the DB as a slice of metrics.ScrapeRow.
// Called by the Prometheus collector on every scrape; the read is the same
// SELECT that backs GetMatchResults, so cardinality and freshness are
// identical between the Wails UI and the metrics endpoint.
func scrapeReader() ([]metrics.ScrapeRow, error) {
	recs, err := readAllRecords()
	if err != nil {
		return nil, err
	}
	out := make([]metrics.ScrapeRow, len(recs))
	for i, r := range recs {
		inferSoleHeroPercent(&r.Data)
		inferResultFromRank(&r.Data)
		out[i] = metrics.ScrapeRow{MatchKey: r.MatchKey, Data: r.Data}
	}
	return out, nil
}

// inferSoleHeroPercent fills percent_played for matches where only one hero
// is on record. Scoreboard-only rows (no SUMMARY screenshot captured) have a
// single HeroesPlayed entry with PercentPlayed=0 because that field only
// comes from the SUMMARY tab — if there's just one hero, they were played
// for the whole match. Applied at read time, not at parse/merge time, so a
// later SUMMARY screenshot can still write the real percentage into the
// stored 0 via mergeMatchResult's first-non-zero-wins rule.
func inferSoleHeroPercent(d *parser.MatchResult) {
	if len(d.HeroesPlayed) != 1 {
		return
	}
	hp := &d.HeroesPlayed[0]
	if hp.PercentPlayed == 0 && hp.PlayTime == "" {
		hp.PercentPlayed = 100
	}
}

// inferResultFromRank fills Result for rows that have rank-screen data but
// where the COMPETITIVE VICTORY/DEFEAT/DRAW banner OCR missed. The italic
// stylized banner is the parser's primary signal but it's the most brittle
// piece of the rank screen — when it fails, the signed SR delta on the same
// screenshot is the next-best signal. Applied at read time so existing rows
// where the banner failed get the inferred badge without a re-parse.
func inferResultFromRank(d *parser.MatchResult) {
	if d.Result != "" || len(d.SR) == 0 {
		return
	}
	for _, s := range d.SR {
		if s.Change > 0 {
			d.Result = "victory"
			return
		}
		if s.Change < 0 {
			d.Result = "defeat"
			return
		}
	}
}

// ParseScreenshots OCRs every image in screenshots/ and merges results from
// screenshots taken close together (within mergeWindow) into one DB row.
// SUMMARY, TEAMS, and PERSONAL screenshots populate disjoint subsets of
// fields; the user typically takes them within a few seconds by cycling the
// post-match tabs, so the filename timestamp is the most reliable correlation
// signal — PERSONAL has no E/A/D, so a stats-based key wouldn't catch it.
func (a *App) ParseScreenshots() error {
	// Bail out early if Tesseract isn't usable. The frontend already
	// shows a blocking System Alert when this is the case and disables
	// the Parse button — this guard catches the rare case where the
	// binary disappeared (uninstall, move) after launch.
	if !a.tessStatus.Found {
		// Refresh once in case the user fixed the install in another
		// window without clicking through the UI to re-check.
		a.tessStatus = checkTesseract(a.settings.TesseractPath)
		if !a.tessStatus.Found {
			return fmt.Errorf("tesseract is not available: %s", a.tessStatus.Error)
		}
	}
	// Serialize parses: the watcher might fire one while the user has
	// just clicked Parse, and overlapping Tesseract calls + DB upserts
	// would race on the parsed-files set.
	a.parseMu.Lock()
	defer a.parseMu.Unlock()

	// Skip files already in some DB row's source_files. OCR is slow (~seconds
	// per image), and we only need to re-process newly added screenshots.
	parsed, err := loadParsedFilenames()
	if err != nil {
		return err
	}
	results, err := parser.ParseScreenshotsDir(a.settings.ScreenshotsDir, parsed, func(done, total int, filename string, result *parser.MatchResult) {
		a.emitParseProgress(ParseProgressEvent{
			Done:     done,
			Total:    total,
			Filename: filename,
			Type:     screenshotType(result),
			Data:     result,
		})
	})
	if err != nil {
		return err
	}
	if len(results) == 0 {
		return nil
	}

	// Two-pass merge across the NEW parses: first by filename timestamp
	// (catches sequential SUMMARY/TEAMS/PERSONAL clicks of one match), then
	// by (E, A, D) signature (catches a mid-match scoreboard screenshot
	// paired with the post-match summary taken minutes or hours later).
	newRows := mergeByTimestamp(results)
	newRows = mergeByStatsSignature(newRows)

	// Fold each new row into an existing DB row when one matches — by E/A/D
	// or by filename timestamp window with no conflicting metadata. This
	// keeps incremental re-parses idempotent: adding the rank screenshot to
	// a Lucio match already in the DB updates that row instead of creating
	// a new one.
	existing, err := loadExistingMergedRows()
	if err != nil {
		return err
	}
	for _, nr := range newRows {
		if idx := findMergeIntoExisting(nr, existing); idx >= 0 {
			targetKey := existing[idx].Key
			mergeMatchResult(&existing[idx].Data, &nr.Data)
			existing[idx].Sources = unionSortedStrings(existing[idx].Sources, nr.Sources)
			existing[idx].Types = mergeTypeMaps(existing[idx].Types, nr.Types)
			existing[idx].Key = targetKey
			if err := upsertMergedRow(existing[idx]); err != nil {
				return err
			}
		} else {
			// All modes (competitive, quickplay, unranked, …) land in
			// SQLite — the Wails UI shows everything and lets the user
			// filter via the Mode dropdown. The Prometheus collector
			// applies its own competitive-only filter at scrape time
			// (see pkg/metrics/metrics.go) so the Grafana side
			// keeps its win-rate / KDA series clean.
			if err := upsertMergedRow(nr); err != nil {
				return err
			}
		}
	}
	return nil
}

// loadParsedFilenames returns every source filename across every existing
// DB row, so we can skip OCR for files already on disk.
func loadParsedFilenames() (map[string]bool, error) {
	rows, err := db.DB.Query(`SELECT source_files FROM match_results`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	parsed := map[string]bool{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var files []string
		if err := json.Unmarshal([]byte(raw), &files); err != nil {
			return nil, err
		}
		for _, f := range files {
			parsed[f] = true
		}
	}
	return parsed, rows.Err()
}

// loadExistingMergedRows reads every row back into the mergedRow shape so
// new parses can be folded into them.
func loadExistingMergedRows() ([]mergedRow, error) {
	records, err := readAllRecords()
	if err != nil {
		return nil, err
	}
	rows := make([]mergedRow, 0, len(records))
	for _, rec := range records {
		rows = append(rows, mergedRow{
			Key:     rec.MatchKey,
			Sources: rec.SourceFiles,
			Types:   rec.SourceTypes,
			Data:    rec.Data,
		})
	}
	return rows, nil
}

// findMergeIntoExisting returns the index of an existing row that nr should
// fold into, or -1. A row qualifies via either:
//   - statsRowsMergeable (E/A/D agreement plus no field conflicts), or
//   - any source filename in nr is within mergeWindow of any source in the
//     existing row AND no signature field conflicts (map / date / finish
//     time / hero / E/A/D).
func findMergeIntoExisting(nr mergedRow, existing []mergedRow) int {
	for i, er := range existing {
		if statsRowsMergeable(nr, er) {
			return i
		}
		if timestampWindowOverlap(nr.Sources, er.Sources) && !rowsConflict(nr, er) {
			return i
		}
	}
	return -1
}

func timestampWindowOverlap(a, b []string) bool {
	for _, fa := range a {
		ta, ok := parseFilenameTimestamp(fa)
		if !ok {
			continue
		}
		for _, fb := range b {
			tb, ok := parseFilenameTimestamp(fb)
			if !ok {
				continue
			}
			d := ta.Sub(tb)
			if d < 0 {
				d = -d
			}
			if d <= mergeWindow {
				return true
			}
		}
	}
	return false
}

func rowsConflict(a, b mergedRow) bool {
	if stringsConflict(a.Data.Map, b.Data.Map) ||
		stringsConflict(a.Data.Date, b.Data.Date) ||
		stringsConflict(a.Data.FinishedAt, b.Data.FinishedAt) ||
		stringsConflict(a.Data.Hero, b.Data.Hero) {
		return true
	}
	if intsConflict(a.Data.Eliminations, b.Data.Eliminations) ||
		intsConflict(a.Data.Assists, b.Data.Assists) ||
		intsConflict(a.Data.Deaths, b.Data.Deaths) {
		return true
	}
	return false
}

func unionSortedStrings(a, b []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(a)+len(b))
	for _, s := range a {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	for _, s := range b {
		if _, ok := seen[s]; !ok {
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

// ParseProgressEvent is emitted on the "parse-progress" channel/event
// after each screenshot finishes OCR.
type ParseProgressEvent struct {
	Done     int                 `json:"done"`
	Total    int                 `json:"total"`
	Filename string              `json:"filename"`
	Type     string              `json:"screenshot_type"`
	Data     *parser.MatchResult `json:"data,omitempty"`
}

// screenshotType infers the screenshot category from the fields that were
// populated by the parser: rank fields → "rank", summary fields → "summary",
// E/A/D combat stats → "scoreboard", per-hero stats → "personal", otherwise
// "unknown".
//
// Order matters: a SCOREBOARD parse populates *both* the E/A/D combat row
// and the right-side panel's hero stats (which go into HeroesPlayed[*].Stats),
// while a PERSONAL parse only populates hero stats. So the E/A/D check must
// come before the hero-stats check — otherwise every scoreboard with a
// non-empty right panel falls through as "personal".
func screenshotType(r *parser.MatchResult) string {
	if r == nil {
		return "unknown"
	}
	if r.Rank != "" {
		return "rank"
	}
	if r.Result != "" || r.Date != "" || r.GameLength != "" {
		return "summary"
	}
	if r.Eliminations > 0 || r.Assists > 0 || r.Deaths > 0 || r.Damage > 0 {
		return "scoreboard"
	}
	for _, hp := range r.HeroesPlayed {
		if len(hp.Stats) > 0 {
			return "personal"
		}
	}
	return "unknown"
}

// GetNewScreenshotCount returns the number of image files in the configured
// screenshots directory that haven't been parsed yet (i.e. don't appear in
// any existing DB row's source_files). Returns 0 when the directory is
// unset, empty, or missing.
func (a *App) GetNewScreenshotCount() (int, error) {
	if a.settings.ScreenshotsDir == "" {
		return 0, nil
	}
	parsed, err := loadParsedFilenames()
	if err != nil {
		return 0, err
	}
	entries, err := os.ReadDir(a.settings.ScreenshotsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	count := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext != ".jpg" && ext != ".jpeg" && ext != ".png" {
			continue
		}
		if !parsed[e.Name()] {
			count++
		}
	}
	return count, nil
}

// GetMatchResults returns all stored, merged match rows.
func (a *App) GetMatchResults() ([]MatchRecord, error) {
	recs, err := readAllRecords()
	if err != nil {
		return nil, err
	}
	for i := range recs {
		inferSoleHeroPercent(&recs[i].Data)
		inferResultFromRank(&recs[i].Data)
	}
	return recs, nil
}

// ClearDatabase deletes all rows from match_results, resetting the
// parse history without touching settings or the SQLite schema.
func (a *App) ClearDatabase() error {
	_, err := db.DB.Exec(`DELETE FROM match_results`)
	return err
}

func readAllRecords() ([]MatchRecord, error) {
	rows, err := db.DB.Query(`SELECT
		id, match_key, source_files, source_types,
		map, type, mode, role, hero,
		eliminations, assists, deaths, damage, healing, mitigation,
		result, final_score, date, finished_at, game_length,
		heroes_played, performance,
		rank, level, rank_progress, change_percent, modifiers, sr
		FROM match_results ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []MatchRecord
	for rows.Next() {
		rec, err := scanMatchRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	return records, rows.Err()
}

// mergedRow is one DB row's worth of merged data: a stable key derived from
// E/A/D, the list of source files that fed it, and the merged stats.
// Types carries per-source-file screenshot type (parallel to Sources) so
// each filename can be labeled in the UI.
type mergedRow struct {
	Key     string
	Sources []string
	Types   map[string]string
	Data    parser.MatchResult
}

// mergeWindow is how close two screenshot filenames must be in time to count
// as belonging to the same match. 2 minutes is generous enough to absorb a
// slow tab-cycler but tight enough that two separate matches never collide.
const mergeWindow = 2 * time.Minute

var filenameTimestampRe = regexp.MustCompile(`(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})`)

// parseFilenameTimestamp extracts the YYYY.MM.DD - HH.MM.SS portion the OW2
// client embeds in its screenshot filenames. Returns ok=false for filenames
// that don't carry a timestamp (manually renamed files, screenshots from
// other tools) so they get their own row instead of merging with whatever
// timestamped file happens to be nearest.
func parseFilenameTimestamp(f string) (time.Time, bool) {
	m := filenameTimestampRe.FindStringSubmatch(f)
	if m == nil {
		return time.Time{}, false
	}
	s := fmt.Sprintf("%s-%s-%sT%s:%s:%sZ", m[1], m[2], m[3], m[4], m[5], m[6])
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// fileEntry pairs a screenshot filename with its parsed result and the
// timestamp extracted from its filename. Defined at package level so
// splitByMatchMetadata can take a slice of it.
type fileEntry struct {
	file string
	ts   time.Time
	res  *parser.MatchResult
}

// mergeByTimestamp groups screenshots taken within mergeWindow of each other
// (in filename-timestamp order) and merges each group into one row. Files
// without a parseable timestamp are kept as their own rows so we don't
// silently fold them into an unrelated match.
func mergeByTimestamp(parsed map[string]*parser.MatchResult) []mergedRow {
	var timed []fileEntry
	var loners []string
	for f, r := range parsed {
		if ts, ok := parseFilenameTimestamp(f); ok {
			timed = append(timed, fileEntry{f, ts, r})
		} else {
			loners = append(loners, f)
		}
	}
	sort.Slice(timed, func(i, j int) bool { return timed[i].ts.Before(timed[j].ts) })

	var groups [][]fileEntry
	for _, e := range timed {
		if n := len(groups); n > 0 {
			last := groups[n-1]
			if e.ts.Sub(last[len(last)-1].ts) <= mergeWindow {
				groups[n-1] = append(last, e)
				continue
			}
		}
		groups = append(groups, []fileEntry{e})
	}

	out := make([]mergedRow, 0, len(groups)+len(loners))
	for _, g := range groups {
		// Two distinct matches can fall inside one timestamp window if the
		// user pulls them up back-to-back (e.g. inspecting match history).
		// Split on conflicting (date, finished_at) — those are signed by the
		// SUMMARY screen and are the strongest "this is a different match"
		// signal we have.
		for _, sub := range splitByMatchMetadata(g) {
			var merged parser.MatchResult
			sources := make([]string, 0, len(sub))
			types := make(map[string]string, len(sub))
			for _, e := range sub {
				sources = append(sources, e.file)
				types[e.file] = screenshotType(e.res)
				mergeMatchResult(&merged, e.res)
			}
			out = append(out, mergedRow{
				Key:     "match:" + sub[0].ts.UTC().Format("2006-01-02T15:04:05"),
				Sources: sources,
				Types:   types,
				Data:    merged,
			})
		}
	}
	sort.Strings(loners)
	for _, f := range loners {
		out = append(out, mergedRow{
			Key:     "unmatched:" + f,
			Sources: []string{f},
			Types:   map[string]string{f: screenshotType(parsed[f])},
			Data:    *parsed[f],
		})
	}
	return out
}

// mergeByStatsSignature folds rows that share the same (E, A, D) signature
// into one, provided their (map, date, finished_at) don't conflict. The
// in-game scoreboard screenshot (mid-match, no SUMMARY metadata) ends up in a
// separate timestamp-window from the corresponding post-match SUMMARY/TEAMS/
// PERSONAL session, but the two are obviously the same match — E/A/D signed
// by both views is the reliable bridge.
func mergeByStatsSignature(rows []mergedRow) []mergedRow {
	// Repeatedly find one mergeable pair and combine it; bail when no pair
	// is mergeable. Transitively merges chains (A↔B, B↔C ⇒ A∪B∪C) without
	// the complexity of a union-find.
	for {
		i, j := findStatsMergePair(rows)
		if i < 0 {
			break
		}
		rows[i] = combineStatsRows(rows[i], rows[j])
		rows = append(rows[:j], rows[j+1:]...)
	}
	return rows
}

func findStatsMergePair(rows []mergedRow) (int, int) {
	for i := range rows {
		for j := i + 1; j < len(rows); j++ {
			if statsRowsMergeable(rows[i], rows[j]) {
				return i, j
			}
		}
	}
	return -1, -1
}

func statsRowsMergeable(a, b mergedRow) bool {
	// Both sides need a non-zero E/A/D signature — a row of all zeros is a
	// parse failure, not a real match, and shouldn't pull other rows in.
	if a.Data.Eliminations == 0 && a.Data.Assists == 0 && a.Data.Deaths == 0 {
		return false
	}
	if b.Data.Eliminations == 0 && b.Data.Assists == 0 && b.Data.Deaths == 0 {
		return false
	}
	if a.Data.Eliminations != b.Data.Eliminations ||
		a.Data.Assists != b.Data.Assists ||
		a.Data.Deaths != b.Data.Deaths {
		return false
	}
	// Sanity check: any field both sides have must agree. Damage/healing/
	// mitigation usually only one side has (post-match SUMMARY doesn't carry
	// them, in-game scoreboard does), but if both do they should match.
	if stringsConflict(a.Data.Map, b.Data.Map) ||
		stringsConflict(a.Data.Date, b.Data.Date) ||
		stringsConflict(a.Data.FinishedAt, b.Data.FinishedAt) ||
		stringsConflict(a.Data.Hero, b.Data.Hero) ||
		intsConflict(a.Data.Damage, b.Data.Damage) ||
		intsConflict(a.Data.Healing, b.Data.Healing) ||
		intsConflict(a.Data.Mitigation, b.Data.Mitigation) {
		return false
	}
	return true
}

func stringsConflict(a, b string) bool { return a != "" && b != "" && a != b }
func intsConflict(a, b int) bool       { return a != 0 && b != 0 && a != b }

func combineStatsRows(a, b mergedRow) mergedRow {
	mergeMatchResult(&a.Data, &b.Data)
	seen := map[string]struct{}{}
	for _, s := range a.Sources {
		seen[s] = struct{}{}
	}
	for _, s := range b.Sources {
		if _, ok := seen[s]; !ok {
			a.Sources = append(a.Sources, s)
			seen[s] = struct{}{}
		}
	}
	sort.Strings(a.Sources)
	a.Types = mergeTypeMaps(a.Types, b.Types)
	// Match key follows the earliest screenshot — ISO timestamps compare
	// lexicographically as chronological, so the smaller string wins.
	if strings.HasPrefix(a.Key, "match:") && strings.HasPrefix(b.Key, "match:") && b.Key < a.Key {
		a.Key = b.Key
	}
	return a
}

// mergeTypeMaps returns a single map containing every (filename → type) pair
// from a and b. Entries with a real type (non-empty) win over empty ones;
// b only adds keys absent from a so existing classifications survive.
func mergeTypeMaps(a, b map[string]string) map[string]string {
	if len(a) == 0 && len(b) == 0 {
		return nil
	}
	out := make(map[string]string, len(a)+len(b))
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		if existing, ok := out[k]; !ok || existing == "" {
			out[k] = v
		}
	}
	return out
}

// splitByMatchMetadata partitions a timestamp-window group of screenshots
// into one group per distinct (date, finished_at) signature seen on a SUMMARY
// screen inside the group. Screenshots that don't carry that metadata (TEAMS,
// PERSONAL) are assigned to whichever signature group has the closest-in-time
// member — practically, the SUMMARY screenshot from the same match. This
// catches the case where the user pulls up two matches in a row from match
// history within the 2-min merge window.
func splitByMatchMetadata(group []fileEntry) [][]fileEntry {
	type sig struct{ date, finishedAt string }
	var signatures []sig
	hasSig := func(s sig) bool {
		for _, x := range signatures {
			if x == s {
				return true
			}
		}
		return false
	}
	for _, e := range group {
		s := sig{e.res.Date, e.res.FinishedAt}
		if (s.date != "" || s.finishedAt != "") && !hasSig(s) {
			signatures = append(signatures, s)
		}
	}
	if len(signatures) <= 1 {
		return [][]fileEntry{group}
	}

	buckets := make([][]fileEntry, len(signatures))
	var unsigned []fileEntry
	for _, e := range group {
		s := sig{e.res.Date, e.res.FinishedAt}
		assigned := false
		for i, x := range signatures {
			if x == s {
				buckets[i] = append(buckets[i], e)
				assigned = true
				break
			}
		}
		if !assigned {
			unsigned = append(unsigned, e)
		}
	}
	// Assign each unsigned screenshot to the bucket whose closest member
	// (by filename timestamp) is nearest in time. Falls through to bucket 0
	// only when all buckets are empty of timestamps, which can't happen here
	// because every bucket got at least one signed member above.
	for _, e := range unsigned {
		bestIdx := 0
		bestDelta := time.Duration(1<<62 - 1)
		for i, b := range buckets {
			for _, m := range b {
				d := e.ts.Sub(m.ts)
				if d < 0 {
					d = -d
				}
				if d < bestDelta {
					bestDelta = d
					bestIdx = i
				}
			}
		}
		buckets[bestIdx] = append(buckets[bestIdx], e)
	}
	return buckets
}

// mergeMatchResult fills empty fields on dst from src — i.e. each field takes
// the first non-zero / non-empty value seen across the merge group. This
// works because the two screenshot types populate disjoint subsets: the
// SUMMARY has map/result/etc., the TEAMS scoreboard has damage/healing/mit.
func mergeMatchResult(dst, src *parser.MatchResult) {
	if dst.Map == "" {
		dst.Map = src.Map
	}
	if dst.Type == "" {
		dst.Type = src.Type
	}
	if dst.Mode == "" {
		dst.Mode = src.Mode
	}
	if dst.Role == "" {
		dst.Role = src.Role
	}
	if dst.Hero == "" {
		dst.Hero = src.Hero
	}
	if dst.Eliminations == 0 {
		dst.Eliminations = src.Eliminations
	}
	if dst.Assists == 0 {
		dst.Assists = src.Assists
	}
	if dst.Deaths == 0 {
		dst.Deaths = src.Deaths
	}
	if dst.Damage == 0 {
		dst.Damage = src.Damage
	}
	if dst.Healing == 0 {
		dst.Healing = src.Healing
	}
	if dst.Mitigation == 0 {
		dst.Mitigation = src.Mitigation
	}
	if dst.Result == "" {
		dst.Result = src.Result
	}
	if dst.FinalScore == "" {
		dst.FinalScore = src.FinalScore
	}
	if dst.Date == "" {
		dst.Date = src.Date
	}
	if dst.FinishedAt == "" {
		dst.FinishedAt = src.FinishedAt
	}
	if dst.GameLength == "" {
		dst.GameLength = src.GameLength
	}
	if dst.Performance == nil {
		dst.Performance = src.Performance
	}
	// Rank-screen fields (filled only by parseRank).
	if dst.Rank == "" {
		dst.Rank = src.Rank
	}
	if dst.Level == 0 {
		dst.Level = src.Level
	}
	if len(dst.Modifiers) == 0 {
		dst.Modifiers = src.Modifiers
	}
	if dst.RankProgress == 0 {
		dst.RankProgress = src.RankProgress
	}
	if dst.ChangePercent == 0 {
		dst.ChangePercent = src.ChangePercent
	}
	// SR is per-hero; merge by hero name like HeroesPlayed.
	for _, srcSR := range src.SR {
		exists := false
		for i := range dst.SR {
			if dst.SR[i].Hero == srcSR.Hero {
				exists = true
				if dst.SR[i].SR == 0 {
					dst.SR[i].SR = srcSR.SR
				}
				if dst.SR[i].Change == 0 {
					dst.SR[i].Change = srcSR.Change
				}
				break
			}
		}
		if !exists {
			dst.SR = append(dst.SR, srcSR)
		}
	}

	// Merge heroes_played by hero name — a multi-hero match has one PERSONAL
	// screenshot per hero, each contributing the stats for its own hero. We
	// can't take the whole list from "first source" (that'd discard later
	// PERSONAL stats) nor append blindly (that'd duplicate heroes already in
	// the SUMMARY's heroes_played list).
	for _, srcHp := range src.HeroesPlayed {
		var match *parser.HeroPlay
		for i := range dst.HeroesPlayed {
			if dst.HeroesPlayed[i].Hero == srcHp.Hero {
				match = &dst.HeroesPlayed[i]
				break
			}
		}
		if match == nil {
			dst.HeroesPlayed = append(dst.HeroesPlayed, srcHp)
			continue
		}
		if match.PercentPlayed == 0 {
			match.PercentPlayed = srcHp.PercentPlayed
		}
		if match.PlayTime == "" {
			match.PlayTime = srcHp.PlayTime
		}
		for k, v := range srcHp.Stats {
			if match.Stats == nil {
				match.Stats = map[string]int{}
			}
			if _, exists := match.Stats[k]; !exists {
				match.Stats[k] = v
			}
		}
	}
}

func upsertMergedRow(row mergedRow) error {
	sourcesJSON, err := json.Marshal(row.Sources)
	if err != nil {
		return err
	}
	typesJSON, err := jsonNullable(row.Types, len(row.Types) > 0)
	if err != nil {
		return err
	}
	heroesJSON, err := jsonNullable(row.Data.HeroesPlayed, len(row.Data.HeroesPlayed) > 0)
	if err != nil {
		return err
	}
	perfJSON, err := jsonNullable(row.Data.Performance, row.Data.Performance != nil)
	if err != nil {
		return err
	}
	modifiersJSON, err := jsonNullable(row.Data.Modifiers, len(row.Data.Modifiers) > 0)
	if err != nil {
		return err
	}
	srJSON, err := jsonNullable(row.Data.SR, len(row.Data.SR) > 0)
	if err != nil {
		return err
	}

	_, err = db.DB.Exec(
		`INSERT INTO match_results (
		match_key, source_files, source_types,
		map, type, mode, role, hero,
		eliminations, assists, deaths, damage, healing, mitigation,
		result, final_score, date, finished_at, game_length,
		heroes_played, performance,
		rank, level, rank_progress, change_percent, modifiers, sr
	) VALUES (?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?,?,?)
	ON CONFLICT(match_key) DO UPDATE SET
		source_files   = excluded.source_files,
		source_types   = excluded.source_types,
		map            = excluded.map,
		type           = excluded.type,
		mode           = excluded.mode,
		role           = excluded.role,
		hero           = excluded.hero,
		eliminations   = excluded.eliminations,
		assists        = excluded.assists,
		deaths         = excluded.deaths,
		damage         = excluded.damage,
		healing        = excluded.healing,
		mitigation     = excluded.mitigation,
		result         = excluded.result,
		final_score    = excluded.final_score,
		date           = excluded.date,
		finished_at    = excluded.finished_at,
		game_length    = excluded.game_length,
		heroes_played  = excluded.heroes_played,
		performance    = excluded.performance,
		rank           = excluded.rank,
		level          = excluded.level,
		rank_progress  = excluded.rank_progress,
		change_percent = excluded.change_percent,
		modifiers      = excluded.modifiers,
		sr             = excluded.sr,
		parsed_at      = CURRENT_TIMESTAMP`,
		row.Key, string(sourcesJSON), typesJSON,
		nullableString(row.Data.Map), nullableString(row.Data.Type),
		nullableString(row.Data.Mode), nullableString(row.Data.Role),
		nullableString(row.Data.Hero),
		row.Data.Eliminations, row.Data.Assists, row.Data.Deaths,
		row.Data.Damage, row.Data.Healing, row.Data.Mitigation,
		nullableString(row.Data.Result), nullableString(row.Data.FinalScore),
		nullableString(row.Data.Date), nullableString(row.Data.FinishedAt),
		nullableString(row.Data.GameLength),
		heroesJSON, perfJSON,
		nullableString(row.Data.Rank), row.Data.Level,
		row.Data.RankProgress, row.Data.ChangePercent,
		modifiersJSON, srJSON,
	)
	return err
}

func jsonNullable(v any, present bool) (sql.NullString, error) {
	if !present {
		return sql.NullString{}, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: string(b), Valid: true}, nil
}

func scanMatchRecord(rows *sql.Rows) (MatchRecord, error) {
	var rec MatchRecord
	var sourcesJSON string
	var typesJSON sql.NullString
	var mapCol, typeCol, mode, role, hero sql.NullString
	var result, finalScore, date, finishedAt, gameLength sql.NullString
	var heroesJSON, perfJSON sql.NullString
	var rank sql.NullString
	var modifiersJSON, srJSON sql.NullString
	err := rows.Scan(
		&rec.ID, &rec.MatchKey, &sourcesJSON, &typesJSON,
		&mapCol, &typeCol, &mode, &role, &hero,
		&rec.Data.Eliminations, &rec.Data.Assists, &rec.Data.Deaths,
		&rec.Data.Damage, &rec.Data.Healing, &rec.Data.Mitigation,
		&result, &finalScore, &date, &finishedAt, &gameLength,
		&heroesJSON, &perfJSON,
		&rank, &rec.Data.Level, &rec.Data.RankProgress, &rec.Data.ChangePercent,
		&modifiersJSON, &srJSON,
	)
	if err != nil {
		return rec, err
	}
	rec.Data.Rank = rank.String
	if err := json.Unmarshal([]byte(sourcesJSON), &rec.SourceFiles); err != nil {
		return rec, err
	}
	if typesJSON.Valid && typesJSON.String != "" {
		_ = json.Unmarshal([]byte(typesJSON.String), &rec.SourceTypes)
	}
	rec.Data.Map = mapCol.String
	rec.Data.Type = typeCol.String
	rec.Data.Mode = mode.String
	rec.Data.Role = role.String
	rec.Data.Hero = hero.String
	rec.Data.Result = result.String
	rec.Data.FinalScore = finalScore.String
	rec.Data.Date = date.String
	rec.Data.FinishedAt = finishedAt.String
	rec.Data.GameLength = gameLength.String
	if heroesJSON.Valid && heroesJSON.String != "" {
		_ = json.Unmarshal([]byte(heroesJSON.String), &rec.Data.HeroesPlayed)
	}
	if perfJSON.Valid && perfJSON.String != "" {
		_ = json.Unmarshal([]byte(perfJSON.String), &rec.Data.Performance)
	}
	if modifiersJSON.Valid && modifiersJSON.String != "" {
		_ = json.Unmarshal([]byte(modifiersJSON.String), &rec.Data.Modifiers)
	}
	if srJSON.Valid && srJSON.String != "" {
		_ = json.Unmarshal([]byte(srJSON.String), &rec.Data.SR)
	}
	return rec, nil
}

func nullableString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
