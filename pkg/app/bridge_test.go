package app

import (
	"context"
	"sync"

	"github.com/fsnotify/fsnotify"

	"recall/pkg/db"
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
	RunWatchEvents           = runWatchEvents
	ContainsProfile          = containsProfile
	PathIsMissingOrNotADir   = pathIsMissingOrNotADir
	LooksLikeZIP             = looksLikeZIP
	ReadZipFile              = readZipFile
)

// ── OW-data update client (URL seams are pointers so tests can swap them) ──
var (
	NewUpdateClient   = newUpdateClient
	ParseRosterNames  = parseRosterNames
	UpdateAllowedHost = updateAllowedHost
	VerifySha256      = verifySha256
	ReleasesURL       = &releasesURL
	MainVersionURL    = &mainVersionURL
	MainAssetURL      = &mainAssetURL
	ReleaseAssetURL   = &releaseAssetURL
	RenameFunc        = &renameFunc
)

// ── Other function-variable / tunable seams (pointers for save/swap/restore) ──
var (
	RevealCommand    = &revealCommand
	MaxZipEntryBytes = &maxZipEntryBytes
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
	ScrapeReader        = (*App).scrapeReader
	DataDir             = (*App).dataDir
	AutoProbeOnFirstRun = (*App).autoProbeOnFirstRun
)

// ── Unexported *App field accessors ───────────────────────────────────────

// AppSettings returns a pointer so tests can both read sub-fields and mutate
// them in place (the documented App-handler test pattern that avoids the
// IO-performing public setters).
func AppSettings(a *App) *Settings { return &a.settings }

// AppStore / SetAppStore bridge the persistence handle.
func AppStore(a *App) db.Store       { return a.store }
func SetAppStore(a *App, s db.Store) { a.store = s }

func AppProfiles(a *App) *Profiles              { return a.profiles }
func AppWatcher(a *App) *fsnotify.Watcher       { return a.watcher }
func AppWatchedDir(a *App) string               { return a.watchedDir }
func AppParseCancel(a *App) *context.CancelFunc { return &a.parseCancel }
func AppParseCancelMu(a *App) *sync.Mutex       { return &a.parseCancelMu }

// SseMsg aliases the unexported SSE message envelope (exported fields) so the
// SSE test can type its channels.
type SseMsg = sseMsg
