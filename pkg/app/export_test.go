package app

import (
	"time"

	"github.com/fsnotify/fsnotify"

	"recall/pkg/db"
	"recall/pkg/gamedata"
	"recall/pkg/release"
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
	DefaultTesseractPath = defaultTesseractPath
	ValidateScreenshots  = validateScreenshotsDir
	ValidateTesseract    = validateTesseractPath
)

// ── Probe / watcher / misc ────────────────────────────────────────────────
var (
	TesseractProbeCandidates = tesseractProbeCandidates
	ParseTesseractVersion    = parseTesseractVersion
	CheckTesseract           = checkTesseract
)

// RunWatchEvents runs the event loop with only a new-image callback.
func RunWatchEvents(events <-chan fsnotify.Event, errs <-chan error, onNewImage func()) {
	runWatchEvents(events, errs, watchHandlers{onNewImage: onNewImage})
}

// ── Backup / snapshot seams ───────────────────────────────────────────────
// The VACUUM INTO seam and the prune helper moved to pkg/snapshot with the
// carve; tests reach them there. What is left is the one *App method the
// shell kept, because scheduling needs the profile's paths and settings.
var MaybeAutoBackup = (*App).maybeAutoBackup

// ── Other function-variable / tunable seams (pointers for save/swap/restore) ──
var (
	RevealCommand            = &revealCommand
	TesseractProbeTimeout    = &tesseractProbeTimeout
	TesseractProbeRetryDelay = &tesseractProbeRetryDelay
	WatchDebounce            = &watchDebounce
	WatchRetryAfterBusy      = &watchRetryAfterBusy
	WatchRecheckInterval     = &watchRecheckInterval
)

// ── Unexported *App methods (method expressions) ──────────────────────────
var (
	ClaimRun               = (*App).claimRun
	FinishRun              = (*App).finishRun
	NoteProgress           = (*App).noteProgress
	CaptureFatal           = (*App).captureFatal
	StartWatching          = (*App).startWatching
	StopWatching           = (*App).stopWatching
	ScheduleParseDebounced = (*App).scheduleParseDebounced
	NoteWatchActivity      = (*App).noteWatchActivity
	ResetWatchActivity     = (*App).resetWatchActivity
	LoadSettings           = (*App).loadSettings
	SaveSettings           = (*App).saveSettings
	DataDir                = (*App).dataDir
	AutoProbeOnFirstRun    = (*App).autoProbeOnFirstRun

	ProbeTesseractInBackground = (*App).probeTesseractInBackground

	EmitTesseractStatus      = (*App).emitTesseractStatus
	SeedTesseractPlaceholder = (*App).seedTesseractPlaceholder
	EmitCoachSessionChanged  = (*App).emitCoachSessionChanged
)

// ── Unexported *App field accessors ───────────────────────────────────────
// Accessors carry the bare field name; where that collides with an exported
// package symbol (the Settings type, the Profiles alias) they take an -Of
// suffix instead.

// SettingsOf returns a pointer so tests can both read sub-fields and mutate
// them in place (the documented App-handler test pattern that avoids the
// IO-performing public setters).
func SettingsOf(a *App) *Settings { return &a.settings }

// Store bridges the persistence handle: whatever the holder has open, nil
// mid-swap or closed. A peek, not a lease — tests drive one call at a time.
func Store(a *App) db.Store {
	a.stores.mu.Lock()
	defer a.stores.mu.Unlock()
	return a.stores.store
}

// TessStatus exposes the cached Tesseract status so a parse test can mark
// the engine "found" without shelling out to a real binary.
func TessStatus(a *App) *TesseractStatus { return &a.tessStatus }

func ProfilesOf(a *App) *Profiles      { return a.profiles }
func Watcher(a *App) *fsnotify.Watcher { return a.watcher }

// WatchActivity snapshots the watcher's pending tally + last-seen
// stamp for the masthead-dot lifecycle tests.
func WatchActivity(a *App) (int, string) {
	a.watchMu.Lock()
	defer a.watchMu.Unlock()
	ev := a.watchActivityLocked()
	return ev.Pending, ev.LastSeenAt
}
func WatchedDir(a *App) string { return a.watchedDir }

// Manifest IO at the historical zero-config signatures — production
// reaches the manifest through pkg/gamedata directly; only tests
// want the appBaseDir()-resolved convenience.
func LoadManifest() (DataManifest, error) { return gamedata.LoadManifest(appBaseDir()) }

func SaveManifest(m DataManifest) error { return gamedata.SaveManifest(appBaseDir(), m) }

// Check-state IO at the historical zero-config signatures, same reason
// as the manifest pair above: production reaches pkg/release directly,
// and only the shell's tests want appBaseDir() resolved for them — which
// is exactly what they are asserting the shell still does.
func LoadCheckState() (CheckState, error) { return release.LoadCheckState(appBaseDir()) }

func SaveCheckState(s CheckState) error { return release.SaveCheckState(appBaseDir(), s) }

func TouchLastChecked(now time.Time) error { return release.TouchLastChecked(appBaseDir(), now) }

// HoldCoachLock takes the coaching-session lock and returns its release, so a
// test can park an opener on it and decide what happens before it gets in.
func HoldCoachLock(a *App) (release func()) {
	a.coachMu.Lock()
	return a.coachMu.Unlock
}
