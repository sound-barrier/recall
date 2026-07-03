package app

import (
	"context"
	"sync"

	"github.com/fsnotify/fsnotify"

	"recall/pkg/db"
	"recall/pkg/gamedata"
)

// Test-only bridges for the external app_test package. pkg/app is the core
// engine — correlation, aggregation, inference, settings IO, the OW-data update
// client, the probe/watcher machinery — almost none of which has a public seam
// (the public surface is the high-level App methods + GetMatchResults). These
// re-exports/accessors are compiled only under test, so they widen no shipped
// API. See the campaign note in REVIEW.md (Q5).

// ── Settings IO ───────────────────────────────────────────────────────────
var (
	DefaultSettings      = defaultSettings
	LoadSettingsFrom     = loadSettingsFrom
	MarshalSettings      = marshalSettings
	AppBaseDir           = appBaseDir
	DefaultTesseractPath = defaultTesseractPath
	ValidateScreenshots  = validateScreenshotsDir
	ValidateTesseract    = validateTesseractPath
)

// ── Probe / watcher / misc ────────────────────────────────────────────────
var (
	TesseractProbeCandidates = tesseractProbeCandidates
	ParseTesseractVersion    = parseTesseractVersion
	CheckTesseract           = checkTesseract
	RunWatchEvents           = runWatchEvents
	PathIsMissingOrNotADir   = pathIsMissingOrNotADir
)

// ── App-release update check (the gamedata seams moved to pkg/gamedata) ──
var ReleasesURL = &releasesURL

// ── Other function-variable / tunable seams (pointers for save/swap/restore) ──
var (
	RevealCommand         = &revealCommand
	TesseractProbeTimeout = &tesseractProbeTimeout
)

// ── Unexported *App methods (method expressions) ──────────────────────────
var (
	ClaimParse          = (*App).claimParse
	EndParse            = (*App).endParse
	NoteProgress        = (*App).noteProgress
	CaptureFatal        = (*App).captureFatal
	StartWatching       = (*App).startWatching
	StopWatching        = (*App).stopWatching
	LoadSettings        = (*App).loadSettings
	SaveSettings        = (*App).saveSettings
	DataDir             = (*App).dataDir
	AutoProbeOnFirstRun = (*App).autoProbeOnFirstRun

	ProbeTesseractInBackground = (*App).probeTesseractInBackground
)

// ── Unexported *App field accessors ───────────────────────────────────────

// AppSettings returns a pointer so tests can both read sub-fields and mutate
// them in place (the documented App-handler test pattern that avoids the
// IO-performing public setters).
func AppSettings(a *App) *Settings { return &a.settings }

// AppStore / SetAppStore bridge the persistence handle.
func AppStore(a *App) db.Store       { return a.store }
func SetAppStore(a *App, s db.Store) { a.store = s }

// AppTessStatus exposes the cached Tesseract status so a parse test can mark
// the engine "found" without shelling out to a real binary.
func AppTessStatus(a *App) *TesseractStatus { return &a.tessStatus }

func AppProfiles(a *App) *Profiles              { return a.profiles }
func AppWatcher(a *App) *fsnotify.Watcher       { return a.watcher }
func AppWatchedDir(a *App) string               { return a.watchedDir }
func AppParseCancel(a *App) *context.CancelFunc { return &a.parseCancel }
func AppParseRunning(a *App) *bool              { return &a.parseRunning }
func AppParseCancelMu(a *App) *sync.Mutex       { return &a.parseCancelMu }

// SseMsg aliases the unexported SSE message envelope (exported fields) so the
// SSE test can type its channels.
type SseMsg = sseMsg

// Manifest IO at the historical zero-config signatures — production
// reaches the manifest through pkg/gamedata directly; only tests
// want the appBaseDir()-resolved convenience.
func LoadManifest() (DataManifest, error) { return gamedata.LoadManifest(appBaseDir()) }

func SaveManifest(m DataManifest) error { return gamedata.SaveManifest(appBaseDir(), m) }
