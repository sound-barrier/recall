<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
// App-wide styles — extracted from this SFC to keep App.vue navigable
// (~890 lines of template + script vs. ~4 600 lines when the 3 698-line
// <style> block was inline). Imported here rather than via main.ts so
// the dependency lives next to the component that anchors the cascade.
// Still globally scoped (matches the historical behaviour); component-
// specific selectors are tracked for a follow-up extraction into
// per-SFC scoped <style> blocks.
import '@/styles/app.css'

import { ref, computed, watch, onMounted, nextTick, defineAsyncComponent, type Component } from 'vue'
import { storeToRefs } from 'pinia'
import type { MatchRecord, NamedCandidate } from '@/api'
import {
  GetStartupError,
  ParseScreenshots,
  ReParseAll,
  CancelParse,
  GetActiveParse,
  GetMatchResults,
  GetScreenshotsDir,
  PickScreenshotsDir,
  GetScreenshotsFolderCandidates,
  ResetScreenshotsDir,
  RevealScreenshotsDir,
  SetScreenshotsDir,
  GetWatchEnabled,
  SetWatchEnabled,
  GetTesseractStatus,
  ClearDatabase,
  GetNewScreenshotCount,
  GetDataLocation,
  ExportData,
  ExportDataCSV,
  ImportData,
  ResolveAmbiguousMatch,
  IgnoreScreenshot,
  SetMatchAnnotation,
  UpdateMatchData,
  ResetMatchData,
  SetMatchVisibility,
  BulkSetMatchPlayMode,
  BulkSetMatchQueue,
  SetMatchReview,
  SetMatchQueue,
  SetMatchPlayMode,
  SeedTestProfile,
  SwitchProfile,
} from '@/api'
import type { MatchAnnotationInput, PlayMode, QueueType, ReviewedBy, UserMatchDataInput } from '@/api'
import { plainLanguageError } from '@/error-helpers'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import { screenshotURL } from '@/match/match-helpers'
import { tallyWLD } from '@/match/match-stats-helpers'
import { useTabKeyboardNav, TAB_ORDER } from '@/composables/shared/useTabKeyboardNav'
import { useGlobalKeyboard } from '@/composables/shared/useGlobalKeyboard'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useBackupRestore } from '@/composables/settings/useBackupRestore'
import { useClearDatabase } from '@/composables/settings/useClearDatabase'
import { useScreenshotsDir } from '@/composables/settings/useScreenshotsDir'
import { useFeatureToggle } from '@/composables/shared/useFeatureToggle'
import { useEventStream } from '@/composables/shared/useEventStream'
import { useParseRecovery } from '@/composables/ingest/useParseRecovery'
import { useScreenshotPreview } from '@/composables/shared/useScreenshotPreview'
import { ONBOARDING_COMPLETED_KEY, ONBOARDING_RESUME_KEY } from '@/composables/shared/storageKeys'
import { useTheme } from '@/composables/settings/useTheme'
import { useWeekStart } from '@/composables/shared/useWeekStart'
import { useCardFocus } from '@/composables/matches/useCardFocus'
import { useExportBundle } from '@/composables/matches/useExportBundle'
import { useIgnoredScreenshots } from '@/composables/ingest/useIgnoredScreenshots'
import { useSelectedMatch } from '@/composables/matches/useSelectedMatch'
import { useMatchActions } from '@/composables/matches/useMatchActions'
import ParseStatusBar from '@/components/ingest/ParseStatusBar.vue'
import AppMasthead from '@/components/app/AppMasthead.vue'
import StartupErrorModal from '@/components/app/StartupErrorModal.vue'
import UnsupportedModal from '@/components/app/UnsupportedModal.vue'
import SystemAlertBanner from '@/components/app/SystemAlertBanner.vue'
import ErrorBanner from '@/components/app/ErrorBanner.vue'
import MatchesSkeleton from '@/components/matches/shared/MatchesSkeleton.vue'
import UpdateReminderBanner from '@/components/shared/UpdateReminderBanner.vue'
import { useUpdateReminder } from '@/composables/shared/useUpdateReminder'
import { useFirstRunAcknowledged } from '@/composables/shared/useFirstRunAcknowledged'

// Update-check modal — lazy-loaded since it ships with release-notes
// rendering + a focus trap + the apply state machine. Only mounted
// when the user clicks "Check for updates"; the bundle-size guard in
// App.lazy-views.test.ts checks for this pattern across heavy
// modals.
const UpdateCheckModal = defineAsyncComponent(() => import('@/components/shared/UpdateCheckModal.vue'))
// First-run modal only renders on the very first launch (or after the
// user clears localStorage). Lazy-loaded so 99 % of session boots
// don't pay for its bytes in the initial JS chunk.
const FirstRunProfileModal = defineAsyncComponent(() => import('@/components/shared/FirstRunProfileModal.vue'))
// Export-bundle confirmation modal — only mounted when the user clicks
// "Export bundle…" on the Matches bulk-action bar. Lazy so its bytes
// don't land in the initial chunk.
const ExportBundleModal = defineAsyncComponent(() => import('@/components/settings/ExportBundleModal.vue'))
// "Manage ignored files" panel — only mounted when the user opens
// Settings → Advanced → Manage. Lazy so the panel + its 16:9
// thumbnail styles don't land in the initial chunk.
const IgnoredFilesPanel = defineAsyncComponent(() => import('@/components/settings/IgnoredFilesPanel.vue'))

// View components are lazy-loaded via defineAsyncComponent so each
// becomes a separate JS chunk emitted by Vite. The initial bundle
// only ships the currently-visible view (Matches by default); the
// other three load on first tab click. Keeps initial JS small and
// makes the cost of adding a new view proportional to "is it
// visited" rather than "is it imported".
//
// `loadingComponent` + `delay: 220` shows a brief "Loading view…"
// fallback IF the chunk fetch + Vue mount takes longer than 220ms
// (the common case on throttled networks). On LAN / local the
// chunk lands before the delay elapses and the fallback never
// renders, keeping the snappy-feel intact.
import ViewLazyFallback from '@/components/shared/ViewLazyFallback.vue'
const VIEW_LAZY_DELAY = 220
function lazyView(loader: () => Promise<{ default: Component }>) {
  return defineAsyncComponent({
    loader,
    loadingComponent: ViewLazyFallback,
    delay: VIEW_LAZY_DELAY,
  })
}
const IngestView = lazyView(() => import('@/components/ingest/IngestView.vue'))
const MatchesView = lazyView(() => import('@/components/matches/MatchesView.vue'))
const SettingsView = lazyView(() => import('@/components/settings/SettingsView.vue'))
const UnknownMapsView = lazyView(() => import('@/components/unknown/UnknownMapsView.vue'))
// Modal surfaces only mount on demand — keep their (substantial)
// scoped CSS + JS out of the initial chunk so the router shell
// stays under the bundle-size budget. Same defineAsyncComponent
// pattern the views use; the brief load-on-first-open delay is
// invisible at LAN/local speeds.
const MatchDetailPanel = defineAsyncComponent(() => import('@/components/matches/detail/MatchDetailPanel.vue'))
// Anchor confirmation toast — small, eagerly loaded so it can fire
// on the very first anchor-set transition without a chunk fetch.
const MatchAnchorToast = defineAsyncComponent(() => import('@/components/matches/list/MatchAnchorToast.vue'))
const MatchScreenshotLightbox = defineAsyncComponent(() => import('@/components/matches/detail/MatchScreenshotLightbox.vue'))
const KeyboardShortcutsModal = defineAsyncComponent(() => import('@/components/shared/KeyboardShortcutsModal.vue'))
const ManualMatchModal = defineAsyncComponent(() => import('@/components/matches/manual/ManualMatchModal.vue'))

// OnboardingTour lives in its own chunk. The redesigned tour pulled
// in TourSpotlight + TourCallout + demo-match data + the controller
// composable — eagerly importing would have lifted ~12KB into the
// initial bundle for code only first-launch users actually see. The
// chunk fetches in parallel with App.vue's onMounted load(); the
// brief delay between "page paints" and "tour overlay appears" is
// imperceptible against the network round-trip the load() itself is
// already doing for /api/v1/matches.
const OnboardingTour = defineAsyncComponent(() => import('@/components/shared/OnboardingTour.vue'))

// App-shell cross-cutting state (error banner, version, update check, data
// location) lives in the Pinia app store. Destructure with the same local
// names so the existing call sites in this file stay unchanged.
const appStore = useAppStore()
const {
  error,
  errorRetry,
  appVersion,
  updateInfo,
  updateCheckBusy,
  updateCheckModalOpen,
  dataLocation,
} = storeToRefs(appStore)
const { setError, setErrorFromRaw, clearError, checkForUpdates, goToView } = appStore
const { view } = storeToRefs(appStore)

// Matches domain: records (source of truth) + the derived triage lists live
// in the matches store. App's load() boot coordinator writes `records`;
// destructure with the same local names so this file's call sites are
// unchanged.
const matchesStore = useMatchesStore()
const {
  records,
  unknownRecords,
  referenceGapRecords,
  hiddenRecords,
  ambiguousRecords,
  parseBusy,
  cancellingParse,
  firstLoadPending,
  parseProgress,
  parseLog,
  newScreenshotCount,
  lastParsedAt,
  recordsPulse,
} = storeToRefs(matchesStore)
const { refreshNewCount, flashRecordsPulse } = matchesStore

// Onboarding tour: when the tour is active we substitute the live
// records for the curated DEMO_MATCHES so every tour step has
// something realistic to land on. The swap is purely in-memory — the
// user's real records are stashed in `savedRecords` and restored the
// moment the tour closes (finish / skip / Esc). Nothing is persisted
// to the API or to SQLite.
//
// The demo dataset is dynamic-imported on activation so it lives in
// the OnboardingTour async chunk (kept out of the initial JS budget;
// users who never trigger the tour never download it).
// Seed tourActive synchronously from the same localStorage flag the
// tour reads. On a TRUE first launch both `recall.onboardingCompleted`
// and `recall.firstRunAccountNamed` are unset; without this seed the
// modal renders on tick 0, the tour's `active-change(true)` event
// fires a frame later, and the two overlays stack on top of each
// other. Seeding the ref `true` keeps the modal hidden until the
// tour completes (or is skipped) and the parent receives
// `active-change(false)` — then the modal can surface normally.
function readTourWillOpen(): boolean {
  try { return localStorage.getItem(ONBOARDING_COMPLETED_KEY) !== 'true' }
  catch (_) { return false }
}
const tourActive = ref(readTourWillOpen())
const savedRecords = ref<MatchRecord[]>([])
async function onTourActiveChange(active: boolean) {
  if (active) {
    const { DEMO_MATCHES } = await import('@/composables/shared/useDemoMatches')
    savedRecords.value = records.value
    records.value = [...DEMO_MATCHES]
    tourActive.value = true
  } else {
    // load() routes the real fetched records into savedRecords while the
    // tour is active — so this restores the user's data (including the
    // seeded "test" profile after a seed+switch resume).
    records.value = savedRecords.value
    savedRecords.value = []
    tourActive.value = false
  }
}

// Tour "Explore with real data": seed the sample "test" profile, park
// the step to resume on, then switch into it. SwitchProfile reloads the
// SPA, so this resolves only if it throws (the controller then falls
// through to a plain advance). On success the tour reopens at
// resumeStepIndex — now in the test profile — via the resume key.
async function onTourSeedAndSwitch(resumeStepIndex: number): Promise<void> {
  await SeedTestProfile()
  try { localStorage.setItem(ONBOARDING_RESUME_KEY, String(resumeStepIndex)) } catch (_) { /* ignore */ }
  await SwitchProfile('test')
  // SwitchProfile swaps the backend's active store; reload so every
  // composable re-fetches against the test profile (same as the
  // ProfileSwitcher chip). On the next mount the tour resumes at the
  // parked step, now in the test profile.
  window.location.reload()
}

// view + goToView live in the app store; useTabKeyboardNav drives them.
const { onTabKeydown, focusMain } = useTabKeyboardNav(view, goToView)

// ── Keyboard-shortcut + card-focus state ──────────────────────
// Card focus (the j/k/gg/G/n/N + e/t targets) lives in useCardFocus,
// which owns focusedCardIndex + the rendered-DOM-order walk helpers
// App.vue threads into useGlobalKeyboard. `openCheatsheet` toggles the
// `?` cheatsheet modal.
const {
  focusedCardIndex,
  focusCardByRenderedDelta,
  focusCardByRenderedEnd,
  focusSectionByRenderedDelta,
} = useCardFocus()
const openCheatsheet = ref(false)


// Tesseract status (path / found / version / supported flag) + the
// "Browse for binary…" + "Reset to default" pickers + the System Alert
// CTA that deep-links into Settings → Engine.
const settingsStore = useSettingsStore()
const {
  tesseractStatus,
  tesseractReady,
  tesseractSupported,
  tesseractPickerBusy,
  tesseractProbing,
  tesseractProbeMessage,
  tesseractProbeStatus,
  tesseractProbeTried,
} = storeToRefs(settingsStore)
const {
  setTesseractStatus,
  pickTesseractBinary,
  resetTesseractPath,
  detectTesseractBinary,
  gotoEngineSettings,
} = settingsStore

// Confirmation modal for parsing with an unsupported Tesseract version.
const showUnsupportedModal = ref(false)
const showManualMatchModal = ref(false)

// Modal focus trap — captures the trigger, focuses the first
// focusable inside `.modal-box` (markup-first = Cancel button, never
// the destructive Continue Anyway), traps Tab/Shift+Tab, treats
// Escape as cancel, restores focus to the trigger on close.
useModalFocusTrap(showUnsupportedModal, { containerSelector: '.modal-box' })

// Startup-failure modal. `startupErrorMessage` is filled by the
// onMounted GetStartupError() call below; the modal is open
// iff the message is non-empty. Unlike showUnsupportedModal it has
// no Cancel — the only recovery is restart, because Startup
// failures mean SQLite or profile init didn't happen and the rest
// of the app can't function. Driven by a computed so the focus
// trap composable can watch a Ref<boolean>.
const startupErrorMessage = ref('')
const showStartupErrorModal = computed(() => startupErrorMessage.value !== '')
// Non-dismissible: Escape becomes a no-op so the user can't
// trap-fail into a half-broken app. Restart is the only recovery.
useModalFocusTrap(showStartupErrorModal, {
  containerSelector: '.modal-box.startup-error',
  onClose: () => {},
})

// Screenshots dir — persisted on the Go side; mirrored here for
// rendering. The composable also owns the platform-probe state
// (probing / probeMessage / probeStatus / probeTried) consumed by
// SettingsView's "Detect Overwatch Folder" button.
const {
  screenshotsDir,
  probing,
  probeMessage,
  probeStatus,
  probeTried,
  setScreenshotsDir,
  pickDir,
  detectDir,
  revealDir,
  resetDir,
} = useScreenshotsDir({
  pickScreenshotsDir: PickScreenshotsDir,
  // Adapter onto the candidates probe (the single-best ProbeScreenshotsDir
  // endpoint was removed pre-1.0). The candidates list is the strict
  // superset; the first exists:true entry is the single-best path. Empty
  // on macOS / Linux — auto-detect is Windows-only, so detect surfaces
  // a "no default found" message there (same behaviour as before).
  probeScreenshotsDir: async () => {
    const candidates = await GetScreenshotsFolderCandidates()
    const tried = candidates.map(c => c.path).filter(Boolean)
    const hit = candidates.find(c => c.exists)
    return hit
      ? { found: true, path: hit.path, tried }
      : { found: false, tried }
  },
  setScreenshotsDir: SetScreenshotsDir,
  revealScreenshotsDir: RevealScreenshotsDir,
  resetScreenshotsDir: ResetScreenshotsDir,
  refreshNewCount: () => refreshNewCount(),
  shouldConfirmPickWhile: () => watchEnabled.value,
  onError: (m) => { setErrorFromRaw(m) },
})


// First-run picker candidates — four canonical Windows capture
// sources (Nvidia Overlay / OW PrntScn / Snip tool / Steam). Empty
// on macOS / Linux so the picker component hides the grid. Loaded
// once on mount; the user-initiated "Refresh" affordance lives
// inside the picker (re-loads via the same endpoint).
const screenshotCandidates = ref<NamedCandidate[]>([])
async function loadScreenshotCandidates() {
  try {
    screenshotCandidates.value = await GetScreenshotsFolderCandidates()
  } catch (_) {
    // Non-fatal — the picker just shows the Pick custom CTA when
    // candidates is empty.
    screenshotCandidates.value = []
  }
}
// pickDetectedSource: commits an auto-detected card's path via the
// SetScreenshotsDir api wrapper + mirrors the new value on the
// composable's local ref. Separate from `pickDir` (native dialog
// flow) so error handling can be tighter — the path came from our
// own probe so failure surfaces as a programming bug, not user
// input.
async function pickDetectedSource(path: string) {
  try {
    await SetScreenshotsDir(path)
    setScreenshotsDir(path)
    await refreshNewCount()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Watch feature toggle. Calls a Go setter that owns the actual side
// effect (fsnotify watcher) and rolls back the UI on round-trip
// failure. Gated on Tesseract being ready — turning it on with a
// broken OCR setup would queue silent failures.
const {
  enabled: watchEnabled,
  setEnabled: setWatchEnabled,
  toggle: toggleWatch,
} = useFeatureToggle({
  set: SetWatchEnabled,
  canEnable: () => tesseractReady.value
    ? null
    : 'Configure Tesseract in Settings → Engine before enabling Watch.',
  onError: (m) => { setErrorFromRaw(m) },
})

// Filter / filter-panel / grouping composables — owned here so the
// extracted view components (MatchesView, eventually others) receive
// them as bundled props rather than re-instantiating their own state.
// First-day-of-week preference (Settings → Calendar). The other
// persisted prefs (leaver-handling, min-play, include-undated /
// hidden / unknown) used to be wired in here for the deleted
// `useMatchFilters` consumer; the narrow panel owns its own copies
// of each dimension now, so App.vue doesn't need to read them.
const { weekStart, setWeekStart } = useWeekStart()

// (Per-card expand state replaced by the `selection` composable
// introduced for the detail-panel pattern. See below.)

async function load() {
  const before = records.value.length
  // Promise.allSettled, not Promise.all — one endpoint blowing up
  // (e.g. /api/match-results returning a 500 because the DB schema
  // is stale from a previous dev session) MUST NOT keep the rest of
  // the boot from rendering. The previous Promise.all + missing
  // `.catch()` would silently swallow the rejection and leave every
  // ref at its initial value, which surfaces as a misleading
  // "Tesseract not detected" banner even when the OCR engine is
  // perfectly fine. allSettled lets each call land independently and
  // we report failures through the global error banner instead of
  // pretending unrelated subsystems are broken.
  const results = await Promise.allSettled([
    GetMatchResults(),
    GetScreenshotsDir(),
    GetWatchEnabled(),
    GetTesseractStatus(),
    GetNewScreenshotCount(),
    GetDataLocation(),
  ])
  const [recs, dir, watchOn, tess, newCount, loc] = results
  if (recs.status === 'fulfilled') {
    // While the tour is active, the records ref carries the demo
    // corpus — stash the real records for restore-on-close but don't
    // clobber the demo data the user is looking at.
    if (tourActive.value) {
      savedRecords.value = recs.value ?? []
    } else {
      records.value = recs.value ?? []
      if (before > 0 && records.value.length > before) flashRecordsPulse()
    }
    // A successful load clears any stale "Could not load matches"
    // banner — including the one a previous failed attempt set
    // through the Retry CTA path.
    if (errorRetry.value === load) clearError()
  } else {
    setError(
      `Could not load matches: ${plainLanguageError(String(recs.reason))}`,
      load,
    )
  }
  if (dir.status === 'fulfilled')      setScreenshotsDir(dir.value || '')
  if (watchOn.status === 'fulfilled')  setWatchEnabled(!!watchOn.value)
  if (tess.status === 'fulfilled')     setTesseractStatus(tess.value)
  else                                 setTesseractStatus({ path: '', found: false, version: '', supported: false, error: String(tess.reason), default: '', platform: '' })
  newScreenshotCount.value = newCount.status === 'fulfilled' ? newCount.value : null
  dataLocation.value      = loc.status === 'fulfilled' ? loc.value : null
  firstLoadPending.value = false
}


// 90-day "haven't checked for updates in a while" reminder banner.
// Gated on updateInfo.last_checked_at (server-side persisted) +
// recall.updateReminder.dismissedAt (per-cycle dismissal). Hidden
// while updateInfo is null so we don't flash false-positive content
// on first paint.
const {
  shouldShowBanner: showUpdateReminder,
  daysSinceLastCheck: updateReminderDays,
  dismiss: dismissUpdateReminder,
} = useUpdateReminder(updateInfo)

// Update-check modal open-state. Driven by clicking the masthead's
// "Check for updates" button (which simultaneously fires
// checkForUpdates so the modal renders the result the moment the
// network roundtrip lands). Apply Update runs inside the modal.
// Refresh local matches when Apply Data Update swaps the parser —
// the new dataset can resolve previously-unknown heroes/maps.
function onDataApplied() {
  load()
}

async function runParse() {
  clearError()
  parseBusy.value = true
  parseProgress.value = null
  parseLog.value = []
  parseProgressOpen.value = false
  try {
    // POST /parses now returns 202 the instant the run is accepted (it
    // runs as a background job server-side); in Wails the IPC blocks
    // until done. Either way COMPLETION — load() + parseBusy=false —
    // arrives via the parse-complete event handler (onParseComplete),
    // not here, so a mid-parse network drop can't strand the panel.
    await ParseScreenshots()
  } catch (e) {
    // The kickoff itself failed (409 already-in-flight / unset folder,
    // or a pre-202 network error). Clear the busy state here since no
    // parse-complete will follow.
    setErrorFromRaw(String(e))
    parseBusy.value = false
    parseProgress.value = null
    cancellingParse.value = false
  }
}

// Stop click from IngestView's Run Parse button OR the bottom
// status bar's ABORT tile. Sets the local cancelling flag
// straight away so the buttons flip to "Cancelling…" / "ABORTING"
// without waiting for the SSE round-trip; the actual flag-clear
// happens in onParseCancelled above. Swallows 409 because the
// only way to hit it is a race where the parse finished
// naturally before the Stop click landed — the UI reconciles via
// the parse-complete branch instead. Does NOT gate on parseBusy:
// watcher-triggered parses don't flip parseBusy (it's owned by
// runParse), but the user must still be able to abort them.
async function onCancelParse() {
  if (cancellingParse.value) return
  cancellingParse.value = true
  try {
    await CancelParse()
  } catch (_) {
    // Race: parse finished between click and DELETE. The
    // parse-complete handler already ran (or is about to), and
    // the cancellingParse flag gets cleared in runParse's
    // finally block or in the parse-complete onComplete handler.
    cancellingParse.value = false
  }
}

// "Re-parse all screenshots" — Settings → Advanced fires this after
// its own two-step confirm. Re-uses the same parseBusy / parseLog /
// progress wiring runParse does so the masthead status bar and any
// open progress drawer reflect activity. Different from the normal
// `parse()` in two ways: (1) calls ReParseAll which forces re-OCR on
// already-parsed files, (2) skips the Tesseract-supported modal
// because the user knows they're committing to a multi-minute run.
async function onReParseAll() {
  if (!tesseractReady.value) {
    setError("Tesseract isn't set up yet. Open Settings → Engine to configure it.")
    return
  }
  clearError()
  parseBusy.value = true
  parseProgress.value = null
  parseLog.value = []
  try {
    // Same async-job contract as runParse — completion + load() arrive
    // via the parse-complete handler, not the POST resolving.
    await ReParseAll()
  } catch (e) {
    setErrorFromRaw(String(e))
    parseBusy.value = false
    parseProgress.value = null
    cancellingParse.value = false
  }
}

async function parse() {
  if (!tesseractReady.value) {
    setError("Tesseract isn't set up yet. Open Settings → Engine to configure it.")
    return
  }
  // If the detected version is unsupported, require explicit confirmation
  // before running — parsing may produce incorrect results.
  if (!tesseractSupported.value) {
    showUnsupportedModal.value = true
    return
  }
  await runParse()
}

async function confirmUnsupportedParse() {
  showUnsupportedModal.value = false
  await runParse()
}

// Whether the parse-progress detail panel (current file + log) is expanded.
// Collapsed by default — user sees only the count row until they open it.
const parseProgressOpen = ref(false)

// Clear-Database opt-out plumbing. SettingsAdvanced fires
// `clear-database` with `{ keepIgnored: boolean }`; we stash the
// current opt on this ref so the useClearDatabase api seam below
// reads the latest value when the composable executes. Declared
// before useClearDatabase so the closure binding resolves cleanly.
const pendingClearOpts = ref<{ keepIgnored: boolean }>({ keepIgnored: false })

// Two-step "Clear database" flow: arm → confirm → execute → reload.
// The api seam reads pendingClearOpts so SettingsAdvanced's
// "Keep suppress-list" checkbox controls whether the ignore list
// survives the wipe (see onClearDatabase below).
const { clearingDB, clearConfirm, clearDatabase, armClear, cancelClear } = useClearDatabase({
  clearDatabase: () => ClearDatabase(pendingClearOpts.value.keepIgnored),
  afterClear: async () => {
    await load()
    await loadIgnored()
  },
  resetLastParsedAt: () => {
    lastParsedAt.value = null
    try { localStorage.removeItem('recall.lastParsedAt') } catch (_) {}
  },
  onError: (m) => { setErrorFromRaw(m) },
})

// Backup / restore (JSON export + CSV export + JSON import). Inline
// result chip ("Saved: …" / "Imported: …" / failure) is owned by the
// composable and auto-clears after 5s; the IngestView consumes the
// refs as props and emits handlers that map back to these methods.
const {
  exporting,
  importing,
  importArmed,
  exportStatus,
  exportData,
  exportDataCSV,
  armImport,
  cancelImport,
  importData,
} = useBackupRestore({
  exportJSON: ExportData,
  exportCSV: ExportDataCSV,
  importJSON: ImportData,
  afterImport: () => load(),
})

// Open the native folder picker via Wails. The Go side persists the
// choice so subsequent app launches pick up the same directory; we
// just need to refresh our local mirror.
//
// Guard: if Watch is currently armed, confirm before re-targeting the
// watcher to a new folder. The watcher otherwise silently switches and
// (if the new folder is empty or invalid) keeps running against nothing
// with no feedback to the user.

// User-curated per-match leaver annotation. Routes through the
// unified SetMatchAnnotation writer with every other field carried
// over from the existing record so a leaver-chip click only changes
// the leaver bit — note / replay_code / members / tags survive.
async function onSetLeaverAnnotation(matchKey: string, leaver: '' | 'self' | 'team' | 'enemy') {
  try {
    const rec = records.value.find(r => r.match_key === matchKey)
    const prev = rec?.annotation
    await SetMatchAnnotation(matchKey, {
      leaver:      leaver as MatchAnnotationInput['leaver'],
      note:        prev?.note ?? '',
      replay_code: prev?.replay_code ?? '',
      members:     prev?.members ?? [],
      tags:        prev?.tags ?? [],
    })
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Unified annotation setter — used by the MatchCard "Match notes"
// block when the user edits note / replay_code / members in one go.
// The whole row is written in a single round-trip so partial state
// can't strand the user mid-edit.
async function onSetMatchAnnotation(matchKey: string, input: MatchAnnotationInput) {
  try {
    await SetMatchAnnotation(matchKey, input)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Inline match-data edit: persist the full override set, then reload so the
// re-aggregated record (with edited_fields + the ocr_edited badge) renders.
async function onUpdateMatchData(matchKey: string, overrides: UserMatchDataInput) {
  try {
    await UpdateMatchData(matchKey, overrides)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Reset a match to pure OCR — clears every override, reverting to the scanned
// values.
async function onResetMatchData(matchKey: string) {
  try {
    await ResetMatchData(matchKey)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// A manual match was created → close the modal, reload so it appears in the
// list, and open it so the user can add the right-panel review / replay-code
// details (the choosers key on match_key and work unchanged).
async function onManualMatchCreated(rec: MatchRecord) {
  showManualMatchModal.value = false
  await load()
  selection.open(rec.match_key)
}

// Hide / unhide handler. Soft-delete via SetMatchVisibility — the
// per-screenshot rows stay in the DB so a re-parse won't re-add the
// screenshots. After the round-trip we reload records so the dimmed
// state + Hidden · N count both update in lock-step.
async function onSetMatchHidden(matchKey: string, hidden: boolean) {
  try {
    await SetMatchVisibility(matchKey, hidden)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Per-match review-status handler. The empty-string branch clears
// (DELETE) — a click on the active chip toggles back to "not
// reviewed". `'self'` / `'coach'` PUT the new value. After the
// round-trip we reload so the next render reflects reviewed_by
// on every UI surface that reads it.
async function onSetMatchReview(matchKey: string, reviewedBy: ReviewedBy) {
  try {
    await SetMatchReview(matchKey, reviewedBy)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

async function onSetMatchQueue(matchKey: string, queueType: QueueType) {
  try {
    await SetMatchQueue(matchKey, queueType)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

async function onSetMatchPlayMode(matchKey: string, playMode: PlayMode) {
  try {
    await SetMatchPlayMode(matchKey, playMode)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// "Since this match" anchor handler. Empty string clears; any
// other value sets the anchor to that match. Frontend-only (no
// API round-trip) since the anchor is persisted in localStorage.
// Also fires the confirmation toast — set with the match's
// date-and-map label so the user can verify they got the right
// match, cleared with a simpler "filter cleared" note.
function onSetAnchor(matchKey: string) {
  anchorToastToken += 1
  if (matchKey === '') {
    matchAnchor.clearAnchor()
    anchorToast.value = { kind: 'cleared', label: '', token: anchorToastToken }
    return
  }
  matchAnchor.setAnchor(matchKey)
  const rec = records.value.find((r) => r.match_key === matchKey)
  const date = rec?.data?.date ?? ''
  const map = rec?.data?.map ?? '—'
  anchorToast.value = {
    kind: 'set',
    label: date ? `${date} · ${map}` : map,
    token: anchorToastToken,
  }
}

// "View filter" tap on the anchor toast → switch to Matches tab if
// needed, then click the same narrow trigger a user would. Mirrors
// the tour's openNarrow approach so the panel uses its own state
// machine end-to-end.
async function onAnchorToastViewFilter() {
  if (view.value !== 'matches') await goToView('matches')
  await nextTick()
  const trigger = document.querySelector<HTMLButtonElement>('[data-narrow-trigger]')
  trigger?.click()
}

function onAnchorToastDismiss(token: number) {
  if (anchorToast.value?.token === token) anchorToast.value = null
}

// Bulk-hide handler — MatchesView emits this when the user clicks
// Hide on the bulk action bar after ticking N rows. Fans out
// SetMatchVisibility(true) in parallel so the request stream
// pipelines instead of serializing, then reloads once when every
// PUT settles. A single failure aborts and surfaces the error;
// partial state is fine because each /visibility PUT is idempotent
// and the user can retry.
async function onHideMatches(matchKeys: string[]) {
  if (matchKeys.length === 0) return
  try {
    await Promise.all(matchKeys.map((k) => SetMatchVisibility(k, true)))
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Bulk play-mode / queue-type writers — one PUT to the
// collection-level endpoint instead of N per-match PUTs. The
// frontend's bulk wrapper hits PUT /api/v1/matches/play-mode (or
// /queue-type) which writes in one SQLite transaction; a partial
// crash leaves the table consistent.
async function onBulkPlayMode(matchKeys: string[], playMode: PlayMode) {
  if (matchKeys.length === 0) return
  try {
    await BulkSetMatchPlayMode(matchKeys, playMode)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

async function onBulkQueue(matchKeys: string[], queueType: QueueType) {
  if (matchKeys.length === 0) return
  try {
    await BulkSetMatchQueue(matchKeys, queueType)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Bulk-tag — append `tag` to every selected match's annotation,
// preserving every other annotation field. No bulk endpoint exists
// (yet); we do one read-modify-write per record in parallel. Reload
// once at the end. Idempotent: re-tagging an already-tagged record
// is a no-op (the API dedupes lowercase server-side, see
// SetMatchAnnotation).
// Match-mutation handlers (context-menu fast-tracks + archive-drawer bulk
// actions) + the pending detail-panel focus target live in useMatchActions
// — wired below via `useMatchActions(...)` once `selection` exists.

// ── Export-bundle + CSV flow ─────────────────────────────────────────
// The Matches bulk-action bar emits `export-bundle` / `export-csv` with the
// ticked keys (or a ready-to-save CSV string); useExportBundle owns the modal
// state + the ExportBundle / ExportMatchesCSV dispatch.
const {
  exportBundleOpen,
  exportBundleSelectedKeys,
  onExportBundleRequest,
  onExportMatchesCSV,
  onExportBundleConfirm,
} = useExportBundle({ onError: setErrorFromRaw })

// Ambiguous-attribution resolver. The user picks which candidate
// match an ambiguous screenshot belongs to from the Unknown tab's
// "Needs your review" subsection; we PUT the resolution, then
// reload so the row disappears + the resolved match's source-file
// count updates.
async function onResolveAmbiguous(ambiguousKey: string, resolvedTo: string) {
  try {
    await ResolveAmbiguousMatch(ambiguousKey, resolvedTo)
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// "Delete forever" from the Unknown tab's unmatched section.
// Adds the screenshot's filename to the suppress-list and wipes
// the unmatched- match row in lockstep; reload picks up the new
// state (the row disappears from Unknown).
async function onIgnoreScreenshot(filename: string) {
  try {
    await IgnoreScreenshot(filename)
    await loadIgnored()
    await load()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Ignored-screenshot management (Settings → Advanced → Manage panel) lives in
// useIgnoredScreenshots — the suppress-list + count chip + restore/clear/
// re-parse actions. loadIgnored is called from the record-reload, clear-DB, and
// ignore flows; the panel's actions need App.vue's error surface + view nav +
// the manual-parse kick.
const {
  ignoredScreenshots,
  ignoredCount,
  ignoredPanelOpen,
  loadIgnored,
  openIgnoredPanel,
  closeIgnoredPanel,
  onUnignoreScreenshot,
  onClearIgnoredScreenshots,
  onRunParseFromIgnored,
} = useIgnoredScreenshots({ onError: setErrorFromRaw, goToView, parse })

// SettingsAdvanced fires `clear-database` with `{ keepIgnored }`;
// stash the opt and forward to the composable so its in-flight state
// machine still owns the loading + onError surface.
function onClearDatabase(opts: { keepIgnored: boolean }) {
  pendingClearOpts.value = opts
  return clearDatabase()
}

// Selected-match panel (replaces the old inline-expansion model).
// Clicking a card opens the right-side MatchDetailPanel and pins
// `selection.selectedKey` to that match_key. ← / → inside the panel
// paginates through the filtered list. The composable auto-closes
// when the selected match leaves the filtered set (filter change,
// hide-toggle, re-parse drop).
// MatchesView's filter state is owned here so the right-side
// MatchDetailPanel (driven by `selection`) can paginate against the
// same narrowedRecords the view shows. Refs inside `matchesNarrow`
// don't auto-unwrap when passed as a prop bundle, but MatchesView
// destructures them into top-level setup vars on receipt — same
// CardStateApi convention as elsewhere in the app.
// The narrow filter + "since this match" anchor cluster lives in the matches
// store — it drives `selection` (detail panel) + the dossier off the same
// narrowedRecords the view shows. matchesNarrow / matchesNarrowState /
// matchAnchor are composable bundles (destructure directly; their inner refs
// don't auto-unwrap at object depth); searchClauses is a ref → storeToRefs.
const { matchAnchor, matchesNarrowState, matchesNarrow } = matchesStore
const { searchClauses } = storeToRefs(matchesStore)
const activeFilterCount = matchesNarrow.activeClauseCount

// Adapter for the detail panel's chip toggle contract. `isActive`
// reports whether a chip's value is currently picked in the narrow
// filter; `toggleFilter` flips it. Unknown fields (e.g. legacy
// 'sshot' — the screenshot-type filter useMatchFilters carried that
// the narrow panel doesn't) read as inactive and the toggle no-ops.
const NARROW_FIELDS: Record<string, { picked: () => Set<string>; pick: (v: string) => void }> = {
  hero:   { picked: () => matchesNarrowState.pickedHeroes.value,   pick: matchesNarrow.pickHero },
  role:   { picked: () => matchesNarrowState.pickedRoles.value,    pick: matchesNarrow.pickRole },
  result: { picked: () => matchesNarrowState.pickedResults.value,  pick: matchesNarrow.pickResult },
  map:    { picked: () => matchesNarrowState.pickedMaps.value,     pick: matchesNarrow.pickMap },
  type:   { picked: () => matchesNarrowState.pickedGameModes.value, pick: matchesNarrow.pickGameMode },
  tag:    { picked: () => matchesNarrowState.pickedTags.value,     pick: matchesNarrow.pickTag },
}
function isActive(field: string, value: string): boolean {
  return NARROW_FIELDS[field]?.picked().has(value) ?? false
}
function toggleFilter(field: string, value: string) {
  NARROW_FIELDS[field]?.pick(value)
}

// Anchor confirmation toast — fires on set + cleared transitions
// to bridge the cause-effect gap between the detail-panel button
// and the narrow-panel filter. `token` is the React-style fresh key
// so back-to-back changes reset the auto-dismiss window.
const anchorToast = ref<{ kind: 'set' | 'cleared'; label: string; token: number } | null>(null)
let anchorToastToken = 0
const selection = useSelectedMatch(matchesNarrow.narrowedRecords)

// Match-mutation handlers (context-menu fast-tracks + archive-drawer bulk
// actions) + the pending detail-panel focus target.
const {
  pendingFocusTarget,
  clearPendingFocus,
  onOpenMatchAndFocus,
  onCopyReplayCode,
  onCopyMatchLink,
  onOpenSourceFolder,
  onBulkTag,
  onHardDeleteMatch,
  onUnhideMatches,
  onHardDeleteMatches,
  onMoveMatches,
} = useMatchActions({
  records,
  openMatch: selection.open,
  reload: load,
  setError,
  onError: setErrorFromRaw,
})

// Tour-driven narrow popover + filter handlers. The tour fires
// these via emits on <OnboardingTour /> so a step can demonstrate
// "open Narrow, filter to Lucio" without simulating clicks across
// the MatchesView surface. openNarrow / closeNarrow click the same
// trigger buttons a real user uses (so MatchesView's existing open
// state stays the single source of truth); the filter mutators
// write directly to the shared `matchesNarrowState` refs so
// narrowedRecords + the panel UI both update in one pass. nextTick
// gives the v-if'd popover a render frame before the close click
// goes looking for the .np-close button.
async function onTourOpenNarrow() {
  if (view.value !== 'matches') await goToView('matches')
  await nextTick()
  const trigger = document.querySelector<HTMLButtonElement>(
    '.dossier-actions .dossier-btn.primary',
  )
  trigger?.click()
}
async function onTourCloseNarrow() {
  await nextTick()
  const close = document.querySelector<HTMLButtonElement>('#narrow-popover .np-close')
  close?.click()
}
function onTourApplyHeroFilter(hero: string) {
  matchesNarrowState.pickedHeroes.value = new Set([hero])
}
function onTourClearFilters() {
  matchesNarrowState.searchText.value = ''
  matchesNarrowState.pickedMaps.value = new Set()
  matchesNarrowState.pickedGameModes.value = new Set()
  matchesNarrowState.pickedHeroes.value = new Set()
  matchesNarrowState.pickedRoles.value = new Set()
  matchesNarrowState.pickedResults.value = new Set()
  matchesNarrowState.pickedTags.value = new Set()
  matchesNarrowState.pickedRange.value = 'all'
  matchesNarrowState.customFrom.value = ''
  matchesNarrowState.customTo.value = ''
}

// MatchesView's left-side "Narrow this set" panel mirrors
// MatchDetailPanel's modal contract: while open, the background
// container + status bar go inert + aria-hidden. The view emits its
// open/close state up here so the inert binding picks it up
// alongside `selection.isOpen` and `showUnsupportedModal`.
const matchesNarrowOpen = ref(false)
function onMatchesNarrowOpen(open: boolean) {
  matchesNarrowOpen.value = open
}

// First-run modal — asks for the user's main account name on a
// fresh install. Forced gate: every other surface goes inert + aria-
// hidden while the modal is up so the user can't change any setting
// before naming their main account. ESC / backdrop intentionally do
// NOT close it. The composable persists the dismissal in localStorage
// so the modal never returns once acknowledged.
const { pending: firstRunPending, ack: ackFirstRun } = useFirstRunAcknowledged()
// Gate on the tour too — `it should not appear if the tour is
// starting or continuing on`. `tourActive` is seeded synchronously
// from the onboarding flag (see readTourWillOpen above), so on a
// fresh install where both flags are unset the tour wins the first
// paint; once the user finishes / skips the tour, `tourActive`
// flips false and the modal surfaces. `firstRunPending` itself ANDs
// localStorage acknowledgement with the active-profile-is-default
// check — see useFirstRunAcknowledged.
const firstRunModalOpen = computed(() => firstRunPending.value && !tourActive.value)

// Every modal surface that should freeze the background. Used by
// the masthead container + status bar to flip `inert` + aria-hidden
// so screen readers + Tab nav don't bleed into the dimmed page.
// Add to this list whenever you mount a new full-surface modal.
const backgroundFrozen = computed(() =>
  firstRunModalOpen.value
  || showUnsupportedModal.value
  || showStartupErrorModal.value
  || selection.isOpen.value
  || matchesNarrowOpen.value
  || showManualMatchModal.value,
)

function onFirstRunDismiss(renamedTo: string | null) {
  ackFirstRun()
  // If the user renamed the active profile, the server tore down +
  // re-init'd the SQLite store at the new directory — same teardown
  // as the masthead chip's switch/create/rename flow. Mirror that
  // flow's window.location.reload() so every composable (including
  // ProfileSwitcher's onMounted GetProfiles()) re-fetches against
  // the renamed profile. A targeted refresh isn't enough: profile
  // state is owned by the chip, not App.vue.
  if (renamedTo !== null) {
    window.location.reload()
  }
}

// Step 2 of the first-run modal: the user clicked a "found" source
// card. Commit the path through the existing setScreenshotsDir flow
// (same writer the Settings picker uses) — the modal emits dismiss
// in lockstep so the localStorage gate flips on the same turn.
async function onFirstRunPickSource(path: string) {
  try {
    await SetScreenshotsDir(path)
    setScreenshotsDir(path)
    await refreshNewCount()
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Step 2 of the first-run modal: the user clicked the custom-pick
// tile. Trigger the native folder dialog (or window.prompt in the
// server-mode fallback) and, on a successful pick, commit + ack the
// first-run gate so the modal unmounts. Cancel leaves the modal on
// step 2 so the user can try again.
async function onFirstRunPickCustomSource() {
  try {
    await pickDir()
    if (screenshotsDir.value) {
      ackFirstRun()
    }
  } catch (e) {
    setErrorFromRaw(String(e))
  }
}

// Search → panel auto-track. When the panel is open AND the user
// is actively searching (any clauses parsed), the panel selection
// follows the first narrowed match so the highlighted content is
// visible without an extra click. The watcher fires on every
// searchText change while the panel is open; when the user clears
// the search, we leave the selection where it last landed (don't
// snap back to a previous match — that would surprise the user).
// `narrowedRecords` IS the search-aware list now that the legacy
// `filters.filteredSorted` is gone — same dimensions, no second
// independent filter pipeline to keep in sync.
watch(
  () => matchesNarrowState.searchText.value,
  () => {
    if (!selection.isOpen.value) return
    if (searchClauses.value.length === 0) return
    const first = matchesNarrow.narrowedRecords.value[0]
    if (first && first.match_key !== selection.selectedKey.value) {
      selection.open(first.match_key)
    }
  },
)


// Open the Matches detail panel for a given match key + scroll the
// source row into view behind it so the user doesn't lose their
// place. Used by Matches-view keyboard shortcuts ('e' / 't'); the
// Unknown tab uses its own local toggleUnknownExpand below.
async function toggleExpand(id: string) {
  selection.open(id)
  await nextTick()
  const el = document.getElementById(`match-${id}`)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// W-L-D summary that reflects the *currently narrowed* set so the user
// can see, for instance, "support role on Aatlis: 6W 2L 0D" by setting
// the matching filters. Sources from MatchesView's `narrowedRecords`
// so this stays in sync with the MatchesView dossier's Record KPI
// tile. Honors the same `leaver-exclude-tally` rule the dossier
// applies.
const wld = computed(() => tallyWLD(
  matchesNarrow.narrowedRecords.value,
  matchesNarrow.leaverHandling.value === 'exclude-tally',
))

// Per-card "source screenshots" sub-panel expansion. Independent of the
// main card expand state — most users don't care which screenshots fed
// a row, so we keep this folded by default even when the card itself
// is open.
const sourcesExpanded = ref<Record<string, boolean>>({})
function toggleSources(id: string) {
  sourcesExpanded.value = { ...sourcesExpanded.value, [id]: !sourcesExpanded.value[id] }
}
function isSourcesOpen(id: string) {
  return !!sourcesExpanded.value[id]
}

// Screenshot UI state — per-filename inline expand + fullscreen
// lightbox + cache-warm preload registry. Image bytes come from the
// Go ScreenshotHandler at /_screenshot/<filename>; the lightbox
// snapshot of files/dirIDs protects ←/→ navigation against the
// underlying record refreshing mid-view (e.g. SSE-driven reload).
const screenshotPreview = useScreenshotPreview()
const {
  isPreviewOpen,
  hasPreviewError,
  togglePreview,
  onPreviewError,
  lightboxFilename,
  lightboxFiles,
  lightboxDirIDs,
  lightboxIndex,
  openLightbox,
  closeLightbox,
  lightboxPrev,
  lightboxNext,
} = screenshotPreview
const lightboxSrc = computed(() => {
  const f = lightboxFilename.value
  if (!f) return null
  return screenshotURL(f, lightboxDirIDs.value[f] ?? 0)
})

// Per-card UI state for UnknownMapsView. The Unknown tab's expand/
// collapse gesture is INLINE — clicking a card head flips the local
// `unknownExpanded` map without touching `selection`. Pre-fix this
// reused App.vue's `toggleExpand` which calls `selection.open(id)`
// + scrolls the Matches detail panel into view, but the outer
// `.container` becomes `inert` whenever `selection.isOpen` is true.
// Result: the user clicked an unknown card, the empty detail panel
// dragged itself open over a non-Matches record, and the entire
// container locked down. Only Esc (which closes the panel) restored
// interactivity. The user-reported "page gets hyperfocused, only
// Esc unlocks" symptom is exactly this state. Local state keeps the
// Unknown tab self-contained.
const unknownExpanded = ref<Record<string, boolean>>({})
function isUnknownExpanded(id: string) {
  return !!unknownExpanded.value[id]
}
function toggleUnknownExpand(id: string) {
  unknownExpanded.value = {
    ...unknownExpanded.value,
    [id]: !unknownExpanded.value[id],
  }
}

// CardStateApi: all-function shape post item-8; the underlying
// preview state lives inside the `useScreenshotPreview` composable
// (item 12) so MatchDetailPanel + UnknownMapsView + the fullscreen
// lightbox all consult one owner. The composable persists for the
// life of App.vue so the same preview-open state survives a tab
// swap from Unknown → Matches → Unknown.
const cardState = {
  isSelected: isUnknownExpanded,
  isSourcesOpen,
  isPreviewOpen,
  hasPreviewError,
  toggleExpand: toggleUnknownExpand,
  toggleSources,
  togglePreview,
  onPreviewError,
}

// ── Keyboard shortcuts — full registry ─────────────────────────
// Hoisted to useGlobalKeyboard so App.vue stops carrying the
// ~100-line registry inline. The composable still installs a
// single capture-phase document listener via useKeyboardShortcuts;
// per-binding `when` predicates gate view-specific shortcuts.
// `suppressed: openCheatsheet` is wired inside the composable.
// See FEATURES.md for the cheatsheet contract.
useGlobalKeyboard({
  view,
  openCheatsheet,
  selectionIsOpen: selection.isOpen,
  selectedKey: selection.selectedKey,
  closeSelection: selection.close,
  focusedCardIndex,
  narrowedRecords: matchesNarrow.narrowedRecords,
  goToView,
  focusCardByRenderedDelta,
  focusCardByRenderedEnd,
  focusSectionByRenderedDelta,
  toggleExpand,
})

// Keep TAB_ORDER referenced so a future tab addition can lint-check
// the g-prefix coverage above. (Each entry in TAB_ORDER must have a
// matching g+x handler.)
void TAB_ORDER

// The derived triage lists (unknown / reference-gap / hidden / ambiguous)
// are getters on the matches store, destructured above.

// Pure helpers (detectScreenshotSlots, screenshotURL, etc.) live in
// ./match-helpers.ts so they can be unit-tested in isolation.

// fmtTime is imported from ./match-helpers.js (extracted for testing).

// Subscribe to the watcher's parse-complete event so the records list
// auto-refreshes when an auto-parse runs in the background. Without
// this the user would have to click Parse manually to see new matches
// land in the UI even though the data is already in SQLite.

const { themeMode, setTheme } = useTheme()

onMounted(() => {
  // Restore last-parse timestamp so the Settings page shows the right
  // "Last run · …" hint immediately on launch, not just after a fresh
  // parse in the current session.
  try {
    const v = localStorage.getItem('recall.lastParsedAt')
    if (v) lastParsedAt.value = Number(v) || null
  } catch (_) {}

  void appStore.loadVersion()
  // CheckForUpdate is no longer called on mount — it's gated behind
  // the "Check for updates" button in the masthead's ver-block. See
  // checkForUpdates() below + the v-if chain on .ver-block.
  load()
  void loadIgnored()
  void loadScreenshotCandidates()
  // Surface any captured Startup failure. The Wails wrapper used to
  // log.Fatal on profile / DB-init errors, which manifested as a
  // window flash with no user-visible reason. Startup now records
  // the failure on the App; we pull it here on mount and flip the
  // blocking modal so the user sees a real message.
  GetStartupError()
    .then(msg => { if (msg) startupErrorMessage.value = msg })
    .catch(() => {})
})

// Polite live-region announcement for the parse lifecycle. The
// ParseStatusBar already lights up an aria-live region during a
// run (counter + filename), but it goes inert when the bar hides
// at the end of the run — screen-reader users got no signal for
// "parse complete." Setting + clearing this ref drives an sr-only
// status region so the announcement fires once per terminal state.
const parseAnnouncement = ref('')
function announceParse(msg: string) {
  parseAnnouncement.value = msg
  setTimeout(() => {
    if (parseAnnouncement.value === msg) parseAnnouncement.value = ''
  }, 2000)
}

// SSE / Wails event subscriptions for the ingest lifecycle.
// parse-progress drives the inline log + counter; parse-complete is
// the authoritative reload after a batch; match-updated upserts a
// single record by match_key for live streaming during a long parse.
// Server-mode parse-stream recovery: detect a mid-parse SSE drop, resync
// against GET /parses/active on reconnect / reload, and surface a manual
// Refresh when the connection stays down. No-op in Wails mode.
const { connectionState: parseConnectionState, refresh: refreshParse } = useParseRecovery({
  parseBusy,
  parseProgress,
  reload: load,
  getActiveParse: GetActiveParse,
})

useEventStream({
  records,
  parseProgress,
  parseLog,
  // parse-complete is now the authoritative completion signal for EVERY
  // parse path (user click, watcher, re-parse) — the server emits it
  // from the OCR loop, so this handler owns clearing parseBusy + the
  // reload (runParse no longer waits on the POST to do it).
  onParseComplete: async () => {
    await load()
    lastParsedAt.value = Date.now()
    try { localStorage.setItem('recall.lastParsedAt', String(lastParsedAt.value)) } catch (_) {}
    parseBusy.value = false
    parseProgress.value = null
    cancellingParse.value = false
    const n = records.value.length
    announceParse(`Parse complete. ${n} match${n === 1 ? '' : 'es'} loaded.`)
  },
  // SSE confirmation of a Stop click. Records ref already reflects
  // whatever made it into SQLite before the cancellation point —
  // call load() so the matches list rebinds, then clear the busy +
  // cancelling flags so IngestView's Stop button flips back to Run.
  onParseCancelled: async () => {
    await load()
    parseBusy.value = false
    cancellingParse.value = false
    parseProgress.value = null
    announceParse('Parse cancelled.')
  },
})
</script>

<template>
  <div class="app">
    <!-- Skip-link: first focusable on the page so keyboard users can
         bypass the masthead and nav tabs on every load. Visually hidden
         until focused, then snaps in over the top-left corner. -->
    <a class="skip-link" href="#main-content" @click="focusMain">Skip to main content</a>

    <!-- Polite parse-lifecycle announcer. Sets briefly on
         parse-complete + parse-cancelled, then clears so the next
         terminal state re-announces. Invisible to sighted users —
         the masthead chip + status bar carry the visual signal. -->
    <div class="sr-only" role="status" aria-live="polite">
      {{ parseAnnouncement }}
    </div>

    <div class="atmos" aria-hidden="true" />
    <div class="grid-lines" aria-hidden="true" />

    <div class="container" :inert="backgroundFrozen || undefined" :aria-hidden="backgroundFrozen ? 'true' : undefined">
      <!-- System Alert: blocks both Matches and Settings flow when the
           OCR engine isn't usable. Renders ABOVE the masthead so it's
           the first thing a user sees on a broken install. -->
      <SystemAlertBanner
        v-if="!tesseractReady"
        :path="tesseractStatus.path"
        :error="tesseractStatus.error"
        @fix="gotoEngineSettings"
      />

      <AppMasthead
        :view="view"
        :active-filter-count="activeFilterCount"
        :unknown-count="unknownRecords.length"
        :parse-progress="parseProgress"
        :records-count="records.length"
        :wld="wld"
        :records-pulse="recordsPulse"
        :app-version="appVersion"
        :update-check-busy="updateCheckBusy"
        :has-update-info="!!updateInfo"
        :on-tab-keydown="onTabKeydown"
        @go-to-view="goToView"
        @check-updates="checkForUpdates"
      />

      <UpdateReminderBanner
        :open="showUpdateReminder"
        :days-since-last-check="updateReminderDays"
        @check="checkForUpdates"
        @dismiss="dismissUpdateReminder"
      />

      <ErrorBanner
        v-if="error"
        :message="error"
        :can-retry="!!errorRetry"
        @retry="errorRetry?.()"
        @dismiss="clearError"
      />

      <!-- <main> is the page's primary landmark. The skip-link at the
           top of .app jumps focus here so keyboard users can bypass the
           masthead and tablist on every load. tabindex="-1" lets us
           focus it programmatically without putting it in the natural
           tab order. -->
      <main id="main-content" tabindex="-1">
        <!-- ─── SETTINGS VIEW (folder + theme — minimal config) ──── -->
        <SettingsView
          v-if="view === 'settings'"
          :screenshots-dir="screenshotsDir"
          :watch-enabled="watchEnabled"
          :parse-busy="parseBusy"
          :theme-mode="themeMode"
          :week-start="weekStart"
          :data-location="dataLocation"
          :probing="probing"
          :probe-message="probeMessage"
          :probe-status="probeStatus"
          :probe-tried="probeTried"
          :screenshot-candidates="screenshotCandidates"
          :platform="tesseractStatus?.platform ?? ''"
          :tesseract-ready="tesseractReady"
          :tesseract-supported="tesseractSupported"
          :tesseract-status="tesseractStatus"
          :tesseract-picker-busy="tesseractPickerBusy"
          :tesseract-probing="tesseractProbing"
          :tesseract-probe-message="tesseractProbeMessage"
          :tesseract-probe-status="tesseractProbeStatus"
          :tesseract-probe-tried="tesseractProbeTried"
          :matched-count="records.length"
          :unknown-count="unknownRecords.length"
          :exporting="exporting"
          :importing="importing"
          :import-armed="importArmed"
          :export-status="exportStatus"
          :clear-confirm="clearConfirm"
          :clearing-d-b="clearingDB"
          :ignored-count="ignoredCount"
          :reparsing="parseBusy"
          :parse-progress="parseProgress"
          @pick-screenshots-dir="pickDir"
          @pick-detected-source="pickDetectedSource"
          @detect-screenshots-dir="detectDir"
          @reveal-screenshots-dir="revealDir"
          @reset-screenshots-dir="resetDir"
          @set-theme="setTheme"
          @set-week-start="setWeekStart"
          @go-to-view="goToView"
          @pick-tesseract="pickTesseractBinary"
          @reset-tesseract="resetTesseractPath"
          @detect-tesseract="detectTesseractBinary"
          @export-data="exportData"
          @export-data-csv="exportDataCSV"
          @arm-import="armImport"
          @cancel-import="cancelImport"
          @import-data="importData"
          @arm-clear="armClear"
          @clear-database="onClearDatabase"
          @cancel-clear="cancelClear"
          @open-ignored-panel="openIgnoredPanel"
          @re-parse-all="onReParseAll"
        />

        <!-- ─── PARSE VIEW (Watch + Manual Parse + Progress) ─────── -->
        <IngestView
          v-if="view === 'ingest'"
          :tesseract-ready="tesseractReady"
          :screenshots-dir="screenshotsDir"
          :watch-enabled="watchEnabled"
          :parse-busy="parseBusy"
          :cancelling-parse="cancellingParse"
          :new-screenshot-count="newScreenshotCount"
          :last-parsed-at="lastParsedAt"
          :parse-progress="parseProgress"
          :parse-log="parseLog"
          :parse-progress-open="parseProgressOpen"
          :parse-connection-state="parseConnectionState"
          :matched-count="records.length"
          :unknown-count="unknownRecords.length"
          @toggle-watch="toggleWatch"
          @parse="parse"
          @cancel-parse="onCancelParse"
          @toggle-progress="parseProgressOpen = !parseProgressOpen"
          @refresh-parse="refreshParse"
          @go-to-view="goToView"
        />

        <!-- ─── UNKNOWN MAPS VIEW ────────────────────────────────── -->
        <UnknownMapsView
          v-if="view === 'unknown'"
          :unknown-records="unknownRecords"
          :ambiguous-records="ambiguousRecords"
          :reference-gap-records="referenceGapRecords"
          :all-records="records"
          :card-state="cardState"
          :preload-screenshot="screenshotPreview.preload"
          :update-info="updateInfo"
          @go-to-view="goToView"
          @resolve-ambiguous="onResolveAmbiguous"
          @ignore-screenshot="onIgnoreScreenshot"
          @open-lightbox="openLightbox"
        />

        <!-- ─── MATCHES VIEW ───────────────────────────────────── -->
        <!-- First paint: render skeleton leaf-rows until the initial
             /api/v1/matches roundtrip lands. The skeleton mirrors the
             real .leaf-row grid so the page geometry doesn't shift. -->
        <MatchesSkeleton
          v-if="view === 'matches' && firstLoadPending && records.length === 0"
        />
        <MatchesView
          v-else-if="view === 'matches'"
          :focused-card-index="focusedCardIndex"
          @open-match="(k: string) => selection.open(k)"
          @add-match="showManualMatchModal = true"
          @narrow-open="onMatchesNarrowOpen"
          @hide-matches="onHideMatches"
          @bulk-play-mode="onBulkPlayMode"
          @bulk-queue="onBulkQueue"
          @bulk-tag="onBulkTag"
          @open-match-and-focus="onOpenMatchAndFocus"
          @copy-replay-code="onCopyReplayCode"
          @copy-match-link="onCopyMatchLink"
          @open-source-folder="onOpenSourceFolder"
          @unhide-match="(k: string) => onSetMatchHidden(k, false)"
          @hard-delete-match="onHardDeleteMatch"
          @unhide-matches="onUnhideMatches"
          @hard-delete-matches="onHardDeleteMatches"
          @move-matches="onMoveMatches"
          @export-bundle="onExportBundleRequest"
          @export-csv="onExportMatchesCSV"
          @clear-anchor="onSetAnchor('')"
          @set-anchor="onSetAnchor"
        />
      </main>
    </div>

    <!-- Persistent parse-status footer — visible from every tab while a
         parse is in flight; slides off-bottom 1.5 s after completion.
         Click anywhere on it to jump to the Ingest tab for the detailed
         log view. -->
    <ParseStatusBar
      :parse-progress="parseProgress"
      :parse-log="parseLog"
      :cancelling-parse="cancellingParse"
      :inert="backgroundFrozen || undefined"
      :aria-hidden="backgroundFrozen ? 'true' : undefined"
      @go-to-view="goToView"
      @cancel-parse="onCancelParse"
    />

    <!-- Match detail panel — replaces inline expansion. Slides in
         from the right when a match is selected; j/k paginates
         within the panel, Esc / click-outside closes. -->
    <MatchDetailPanel
      :record="selection.selectedRecord.value"
      :is-open="selection.isOpen.value"
      :is-sources-open="isSourcesOpen(selection.selectedKey.value)"
      :is-preview-open="isPreviewOpen"
      :has-preview-error="hasPreviewError"
      :is-active="isActive"
      :search-clauses="searchClauses"
      :can-prev="selection.canPrev.value"
      :can-next="selection.canNext.value"
      :position-index="selection.selectedIndex.value + 1"
      :position-total="matchesNarrow.narrowedRecords.value.length"
      :has-lightbox="lightboxFilename !== null"
      :available-tags="matchesNarrow.availableTags.value"
      :pending-focus="pendingFocusTarget"
      :anchor-key="matchAnchor.anchorKey.value"
      @focus-consumed="clearPendingFocus"
      @close="selection.close"
      @prev="selection.openPrev"
      @next="selection.openNext"
      @toggle-sources="toggleSources(selection.selectedKey.value)"
      @toggle-preview="togglePreview"
      @preview-error="onPreviewError"
      @open-lightbox="openLightbox"
      @filter-toggle="toggleFilter"
      @set-leaver-annotation="onSetLeaverAnnotation"
      @set-match-annotation="onSetMatchAnnotation"
      @update-match-data="onUpdateMatchData"
      @reset-match-data="onResetMatchData"
      @set-match-hidden="onSetMatchHidden"
      @set-match-review="onSetMatchReview"
      @set-match-queue="onSetMatchQueue"
      @set-match-play-mode="onSetMatchPlayMode"
      @set-anchor="onSetAnchor"
    />

    <!-- Anchor confirmation toast — appears bottom-right when the
         "since" reference is set or cleared. Sits ABOVE the
         dashboard undo toast (different bottom offset) so both can
         coexist if the user trashes a widget right after stamping
         an anchor. -->
    <MatchAnchorToast
      :state="anchorToast"
      @view-filter="onAnchorToastViewFilter"
      @dismiss="onAnchorToastDismiss"
    />

    <!-- Fullscreen screenshot lightbox — stacks above the detail
         panel via z-index. Esc / × / backdrop click close it.
         < / > buttons + ← / → / h / l keys navigate between the
         OWNING match's source_files (snapshotted on open). -->
    <MatchScreenshotLightbox
      :filename="lightboxFilename"
      :src="lightboxSrc"
      :files="lightboxFiles"
      :index="lightboxIndex"
      @close="closeLightbox"
      @prev="lightboxPrev"
      @next="lightboxNext"
    />

    <!-- Startup-failure modal. Filled by GetStartupError() on
         mount; non-empty message means the Go layer captured a
         profile-init / DB-open failure. No close affordance —
         restart is the only recovery. -->
    <StartupErrorModal :open="showStartupErrorModal" :message="startupErrorMessage" />

    <!-- Unsupported Tesseract version confirmation modal -->
    <UnsupportedModal
      :open="showUnsupportedModal"
      :version="tesseractStatus.version"
      @cancel="showUnsupportedModal = false"
      @confirm="confirmUnsupportedParse"
    />

    <!-- Keyboard-shortcut cheatsheet. Self-gated by `openCheatsheet`,
         opened by the `?` binding registered in useKeyboardShortcuts
         above and closed via Esc (focus-trap) or the modal's footer
         button + click-outside. -->
    <KeyboardShortcutsModal
      :open="openCheatsheet"
      :view="view"
      :panel-open="selection.isOpen.value"
      @close="openCheatsheet = false"
    />

    <ManualMatchModal
      :open="showManualMatchModal"
      @close="showManualMatchModal = false"
      @created="onManualMatchCreated"
    />

    <!-- First-launch tour overlay. Self-gates via localStorage;
         renders nothing once dismissed. Steps drive the underlying
         app via @navigate (tab switch), @open-match / @close-match
         (detail panel), @open-narrow / @close-narrow (filter
         popover), and @apply-hero-filter / @clear-filters
         (matchesNarrowState picks). @active-change flips the
         records swap so every tour step lands on demo data. -->
    <OnboardingTour
      :seed-and-switch-to-test="onTourSeedAndSwitch"
      @navigate="goToView"
      @active-change="onTourActiveChange"
      @open-match="(k: string) => selection.open(k)"
      @close-match="selection.close"
      @open-narrow="onTourOpenNarrow"
      @close-narrow="onTourCloseNarrow"
      @apply-hero-filter="onTourApplyHeroFilter"
      @clear-filters="onTourClearFilters"
    />

    <!-- First-run "Main account name" modal. Forced gate — every
         other surface is inert + aria-hidden while this is up.
         Dismissed via Save (rename) or "Keep as main" (acknowledge
         only). ESC + backdrop intentionally do not close it. -->
    <FirstRunProfileModal
      v-if="firstRunModalOpen"
      :platform="tesseractStatus?.platform ?? ''"
      :candidates="screenshotCandidates"
      :picking="probing"
      @dismiss="onFirstRunDismiss"
      @pick-source="onFirstRunPickSource"
      @pick-custom-source="onFirstRunPickCustomSource"
    />

    <!-- Export bundle modal — opens from the Matches bulk-action
         bar's "Export bundle…" button. Counts the selected keys
         (already a `string[]` arg) and shows the user the hidden +
         unknown totals so they can decide whether to UNION them
         into the export. Esc / backdrop / Cancel dismiss; Export
         dispatches to api.ts ExportBundle. -->
    <ExportBundleModal
      :open="exportBundleOpen"
      :selected-count="exportBundleSelectedKeys.length"
      :hidden-count="hiddenRecords.length"
      :unknown-count="unknownRecords.length"
      @close="exportBundleOpen = false"
      @export="onExportBundleConfirm"
    />

    <IgnoredFilesPanel
      :is-open="ignoredPanelOpen"
      :screenshots="ignoredScreenshots"
      :screenshot-u-r-l="(filename) => screenshotURL(filename, 0)"
      @close="closeIgnoredPanel"
      @restore="onUnignoreScreenshot"
      @restore-all="onClearIgnoredScreenshots"
      @run-parse="onRunParseFromIgnored"
      @open-lightbox="openLightbox"
    />

    <!-- Update-check modal — opens from the masthead's "Check for
         updates" button. Renders the binary vs latest comparison
         and a per-roster diff with an Apply Data Update CTA that
         swaps the parser in-place. Lazy so its bundle is only paid
         for by users who run the check. -->
    <UpdateCheckModal
      :open="updateCheckModalOpen"
      :update-info="updateInfo"
      :current-version="appVersion"
      :checking="updateCheckBusy"
      @close="updateCheckModalOpen = false"
      @applied="onDataApplied"
    />
  </div>
</template>

