<script setup lang="ts">
// App-wide styles — extracted from this SFC to keep App.vue navigable
// (~890 lines of template + script vs. ~4 600 lines when the 3 698-line
// <style> block was inline). Imported here rather than via main.ts so
// the dependency lives next to the component that anchors the cascade.
// Still globally scoped (matches the historical behaviour); component-
// specific selectors are tracked for a follow-up extraction into
// per-SFC scoped <style> blocks.
import './styles/app.css'

import { ref, computed, watch, onMounted, nextTick, defineAsyncComponent } from 'vue'
import type { MatchRecord, DataLocation, NamedCandidate } from './api'
import {
  GetVersion,
  GetStartupError,
  CheckForUpdate,
  OpenURL,
  type UpdateInfo,
  ParseScreenshots,
  CancelParse,
  GetMatchResults,
  GetScreenshotsDir,
  PickScreenshotsDir,
  ProbeScreenshotsDir,
  GetScreenshotsFolderCandidates,
  ResetScreenshotsDir,
  RevealScreenshotsDir,
  SetScreenshotsDir,
  GetPrometheusEnabled,
  SetPrometheusEnabled,
  GetWatchEnabled,
  SetWatchEnabled,
  GetTesseractStatus,
  PickTesseractBinary,
  ProbeTesseractBinary,
  ResetTesseractPath,
  SetTesseractPath,
  ClearDatabase,
  GetNewScreenshotCount,
  GetDataLocation,
  ExportData,
  ExportDataCSV,
  ExportBundle,
  ImportData,
  ResolveAmbiguousMatch,
  IgnoreScreenshot,
  UnignoreScreenshot,
  ClearIgnoredScreenshots,
  GetIgnoredScreenshots,
  SetMatchAnnotation,
  SetMatchVisibility,
  BulkSetMatchPlayMode,
  BulkSetMatchQueue,
  SetMatchReview,
  SetMatchQueue,
  SetMatchPlayMode,
  HardDeleteMatch,
  MoveMatches,
} from './api'
import type { IgnoredScreenshot, MatchAnnotationInput, PlayMode, QueueType, ReviewedBy } from './api'
import { tallyWLD, screenshotURL } from './match-helpers'
import { useTabKeyboardNav, TAB_ORDER, type TabId } from './composables/useTabKeyboardNav'
import { useGlobalKeyboard } from './composables/useGlobalKeyboard'
import { useModalFocusTrap } from './composables/useModalFocusTrap'
import { useBackupRestore } from './composables/useBackupRestore'
import { useClearDatabase } from './composables/useClearDatabase'
import { useTesseractStatus } from './composables/useTesseractStatus'
import { useScreenshotsDir } from './composables/useScreenshotsDir'
import { useFeatureToggle } from './composables/useFeatureToggle'
import { useEventStream } from './composables/useEventStream'
import { useScreenshotPreview } from './composables/useScreenshotPreview'
import { ONBOARDING_COMPLETED_KEY } from './composables/storageKeys'
import { useTheme } from './composables/useTheme'
import { useWeekStart } from './composables/useWeekStart'
import { useSearchClauses } from './composables/useSearchClauses'
import { useSelectedMatch } from './composables/useSelectedMatch'
import { useMatchesNarrow, createMatchesNarrowState } from './composables/useMatchesNarrow'
import { useMatchAnchor } from './composables/useMatchAnchor'
import type { ParseProgressEvent } from './components/ParseProgressPanel.vue'
import ParseStatusBar from './components/ParseStatusBar.vue'
import MastheadParseChip from './components/MastheadParseChip.vue'
import MatchesSkeleton from './components/MatchesSkeleton.vue'
import { useFirstRunAcknowledged } from './composables/useFirstRunAcknowledged'
// First-run modal only renders on the very first launch (or after the
// user clears localStorage). Lazy-loaded so 99 % of session boots
// don't pay for its bytes in the initial JS chunk.
const FirstRunProfileModal = defineAsyncComponent(() => import('./components/FirstRunProfileModal.vue'))
// Export-bundle confirmation modal — only mounted when the user clicks
// "Export bundle…" on the Matches bulk-action bar. Lazy so its bytes
// don't land in the initial chunk.
const ExportBundleModal = defineAsyncComponent(() => import('./components/ExportBundleModal.vue'))
// "Manage ignored files" panel — only mounted when the user opens
// Settings → Advanced → Manage. Lazy so the panel + its 16:9
// thumbnail styles don't land in the initial chunk.
const IgnoredFilesPanel = defineAsyncComponent(() => import('./components/IgnoredFilesPanel.vue'))

// View components are lazy-loaded via defineAsyncComponent so each
// becomes a separate JS chunk emitted by Vite. The initial bundle
// only ships the currently-visible view (Matches by default); the
// other three load on first tab click. Keeps initial JS small and
// makes the cost of adding a new view proportional to "is it
// visited" rather than "is it imported".
const IngestView = defineAsyncComponent(() => import('./components/IngestView.vue'))
const MatchesView = defineAsyncComponent(() => import('./components/MatchesView.vue'))
const SettingsView = defineAsyncComponent(() => import('./components/SettingsView.vue'))
const UnknownMapsView = defineAsyncComponent(() => import('./components/UnknownMapsView.vue'))
// Modal surfaces only mount on demand — keep their (substantial)
// scoped CSS + JS out of the initial chunk so the router shell
// stays under the bundle-size budget. Same defineAsyncComponent
// pattern the views use; the brief load-on-first-open delay is
// invisible at LAN/local speeds.
const MatchDetailPanel = defineAsyncComponent(() => import('./components/MatchDetailPanel.vue'))
// Anchor confirmation toast — small, eagerly loaded so it can fire
// on the very first anchor-set transition without a chunk fetch.
const MatchAnchorToast = defineAsyncComponent(() => import('./components/MatchAnchorToast.vue'))
// Sketch-only preview of the analytics-first dashboard (Phase E in
// ROADMAP.md → "Analysis tab"). The component is mounted on the
// dedicated Analysis tab so the shipping Matches view stays
// untouched while we iterate on the dashboard's data wiring.
const MatchesDashboardSketch = defineAsyncComponent(() => import('./components/MatchesDashboardSketch.vue'))
// ProfileSwitcher is part of the always-visible masthead chrome, so
// it's a static import — lazy-loading it would just buy a tiny
// initial-bundle saving at the cost of a render-blocking flash on
// every first paint.
import ProfileSwitcher from './components/ProfileSwitcher.vue'
const MatchScreenshotLightbox = defineAsyncComponent(() => import('./components/MatchScreenshotLightbox.vue'))
const KeyboardShortcutsModal = defineAsyncComponent(() => import('./components/KeyboardShortcutsModal.vue'))

// OnboardingTour lives in its own chunk. The redesigned tour pulled
// in TourSpotlight + TourCallout + demo-match data + the controller
// composable — eagerly importing would have lifted ~12KB into the
// initial bundle for code only first-launch users actually see. The
// chunk fetches in parallel with App.vue's onMounted load(); the
// brief delay between "page paints" and "tour overlay appears" is
// imperceptible against the network round-trip the load() itself is
// already doing for /api/v1/matches.
const OnboardingTour = defineAsyncComponent(() => import('./components/OnboardingTour.vue'))

// GitHub repository URL — surfaced via the brandmark in the masthead.
// Centralised here so the markup, hover title, and any future references
// stay in sync. Routed through OpenURL so Wails-mode clicks open in the
// user's system browser instead of the embedded WebView.
const GITHUB_REPO_URL = 'https://github.com/sound-barrier/recall'

const records = ref<MatchRecord[]>([])
const error = ref('')
// `parseBusy` flips true during runParse(); used to disable the
// manual Parse button and its peers in IngestView / SettingsView.
const parseBusy = ref(false)
// `cancellingParse` flips true between the Stop click and the SSE
// `parse-cancelled` confirmation. Drives the IngestView button copy
// ("Cancelling…") + disabled state so a second click doesn't fire a
// redundant DELETE. Cleared in the onParseCancelled handler below.
const cancellingParse = ref(false)
// `firstLoadPending` is true from boot until the first load() resolves
// (or fails). Drives the Matches skeleton placeholder so the view
// doesn't render its empty-state for a frame between mount and the
// first /api/v1/matches response. Distinct from `parseBusy` because a
// manual parse should NOT swap the real records for skeleton rows.
const firstLoadPending = ref(true)

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
    const { DEMO_MATCHES } = await import('./composables/useDemoMatches')
    savedRecords.value = records.value
    records.value = [...DEMO_MATCHES]
    tourActive.value = true
  } else {
    records.value = savedRecords.value
    savedRecords.value = []
    tourActive.value = false
  }
}

// Brief visual pulse on the scoreboard / records-count surface when
// the watcher (or a manual parse) brings in additional records. Without
// this the auto-refresh is silent — records simply appear and the user
// must scan to notice. The pulse class is bound to .scoreboard and
// auto-clears after the animation completes.
const recordsPulse = ref(false)
let recordsPulseTimer: ReturnType<typeof setTimeout> | null = null
function flashRecordsPulse() {
  recordsPulse.value = true
  if (recordsPulseTimer) clearTimeout(recordsPulseTimer)
  recordsPulseTimer = setTimeout(() => { recordsPulse.value = false }, 1600)
}

// Parse progress: the most-recently-completed file during an active parse.
// null when no parse is running.
const parseProgress = ref<ParseProgressEvent | null>(null)
// Rolling log of completed files during the current parse (up to 50).
const parseLog = ref<ParseProgressEvent[]>([])
// Count of image files in the screenshots dir not yet in the database.
// null = not yet fetched; 0 = all parsed; >0 = new files waiting.
const newScreenshotCount = ref<number | null>(null)

// Which top-level view is shown: 'matches' (default — filter rail +
// match cards) or 'settings' (config sections — directory, watch,
// parse, Grafana export). Switched via the masthead nav tabs.
const view = ref<TabId>('matches')

// Version + update + dev-build state. appVersion drives the masthead
// "v0.3.0" / "v0.3.0-dev" label; the -dev suffix gates dev-only
// chrome via isDevBuild / visibleTabs (the latter feeds
// useTabKeyboardNav so ←/→ wrap-around stays inside rendered tabs).
const appVersion = ref('')
const updateInfo = ref<UpdateInfo | null>(null)
// updateCheckBusy gates the "Check for updates" button while the
// GitHub releases roundtrip is in flight. The check is user-
// triggered (NOT on mount) so users on metered connections or
// stricter network postures don't pay for a release lookup they
// didn't ask for. Pre-rename this fired automatically on mount and
// the "↑ update available" pill rendered silently — regressed when
// the masthead got rewired; this is the deliberate-pull restoration.
const updateCheckBusy = ref(false)
// isDevBuild gates dev-only chrome — currently the "05 Analysis"
// tab + panel. Dev builds carry a "-dev" suffix on the version
// string (e.g. "0.3.0-dev"); release builds don't. The check is
// purely string-suffix, no network calls.
const isDevBuild = computed(() => appVersion.value.endsWith('-dev'))
// visibleTabs is the subset of TAB_ORDER currently exposed to the
// user. Analysis is a work-in-progress dashboard sketch only
// rendered on dev builds; everything else stays. Drives both the
// rendered <button>s and the keyboard nav cycle (useTabKeyboardNav
// reads from this so ←/→ wrap correctly when analysis is hidden).
const visibleTabs = computed<readonly TabId[]>(() =>
  isDevBuild.value ? TAB_ORDER : TAB_ORDER.filter((t) => t !== 'analysis'),
)

// goToView switches the active tab AND moves focus into the newly visible
// panel so keyboard users land in the new content rather than staying on
// the nav button. Each <section> has tabindex="-1" so it can receive
// programmatic focus without entering the natural tab order.
async function goToView(next: string) {
  view.value = next as TabId
  await nextTick()
  const panel = document.getElementById(`panel-${next}`)
  if (panel) panel.focus({ preventScroll: true })
}

const { onTabKeydown, focusMain } = useTabKeyboardNav(view, goToView, visibleTabs)

// ── Keyboard-shortcut state ───────────────────────────────────
// `focusedCardIndex` is the flat index (across the filteredSorted
// list) of the card the j/k/e/t bindings target. -1 = no card
// focused; the MatchCard wrapper's roving tabindex reads this and
// flips between 0 / -1. `openCheatsheet` toggles the `?` modal.
const focusedCardIndex = ref(-1)
const openCheatsheet = ref(false)

// Programmatically focus the leaf-row at the given index in the
// narrowedRecords list. Used by the j/k handlers below; we query-
// select by data-card-index because the row lives inside
// MatchesView's grouped section list and template refs would be
// awkward across the section dividers.
async function focusCardByIndex(idx: number) {
  focusedCardIndex.value = idx
  await nextTick()
  const el = document.querySelector<HTMLElement>(
    `.leaf-row[data-card-index="${idx}"]`,
  )
  el?.focus({ preventScroll: false })
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'auto' })
}

// Walk to the next/prev leaf-row in RENDERED order (DOM-document
// order under .leaves-list). j/k previously walked
// `narrowedRecords` order directly, which only matched the visible
// list when `sortOrder='newest'` — flip Sort to Oldest (or any
// non-default order) and `j` advanced to a row that wasn't the
// visually next one. DOM order is the cheapest reliable source of
// the rendered sequence — MatchesView owns the sort + group logic,
// the rendered list owns the order, and we just walk it.
async function focusCardByRenderedDelta(delta: 1 | -1) {
  const rows = Array.from(
    document.querySelectorAll<HTMLElement>('.leaf-row[data-card-index]'),
  )
  if (rows.length === 0) return
  let currentRowIdx = -1
  if (focusedCardIndex.value !== -1) {
    currentRowIdx = rows.findIndex(
      (r) => Number(r.dataset.cardIndex) === focusedCardIndex.value,
    )
  }
  let nextRowIdx: number
  if (currentRowIdx === -1) {
    // No card focused yet — first j lands on row 0, first k on row 0
    // too (preserves the pre-fix "k from -1 lands on 0" behavior).
    nextRowIdx = 0
  } else {
    nextRowIdx = Math.max(
      0,
      Math.min(rows.length - 1, currentRowIdx + delta),
    )
  }
  const target = rows[nextRowIdx]
  if (!target) return
  const newIndex = Number(target.dataset.cardIndex)
  if (Number.isNaN(newIndex)) return
  if (newIndex === focusedCardIndex.value) return
  await focusCardByIndex(newIndex)
}

// Wall-clock time of the last successful manual parse, used to render
// "Last run · X ago" feedback under the Parse button on the settings
// page. Persisted to localStorage so the timestamp survives reloads.
const lastParsedAt = ref<number | null>(null)

// Tesseract status (path / found / version / supported flag) + the
// "Browse for binary…" + "Reset to default" pickers + the System Alert
// CTA that deep-links into Settings → Engine.
const {
  tesseractStatus,
  tesseractReady,
  tesseractSupported,
  tesseractPickerBusy,
  tesseractProbing,
  tesseractProbeMessage,
  tesseractProbeStatus,
  tesseractProbeTried,
  setTesseractStatus,
  pickTesseractBinary,
  resetTesseractPath,
  detectTesseractBinary,
  gotoEngineSettings,
} = useTesseractStatus({
  pickTesseractBinary: PickTesseractBinary,
  resetTesseractPath: ResetTesseractPath,
  probeTesseractBinary: ProbeTesseractBinary,
  setTesseractPath: SetTesseractPath,
  onError: (m) => { error.value = m },
  navigateToEngine: async () => {
    view.value = 'settings'
    await nextTick()
    const el = document.getElementById('sec-engine')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  },
})

// Confirmation modal for parsing with an unsupported Tesseract version.
const showUnsupportedModal = ref(false)

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
  probeScreenshotsDir: ProbeScreenshotsDir,
  setScreenshotsDir: SetScreenshotsDir,
  revealScreenshotsDir: RevealScreenshotsDir,
  resetScreenshotsDir: ResetScreenshotsDir,
  refreshNewCount: () => refreshNewCount(),
  shouldConfirmPickWhile: () => watchEnabled.value,
  onError: (m) => { error.value = m },
})

// Platform-resolved data paths — surfaced read-only in Settings →
// Directories so the user can see where the DB lives. Null until the
// first load() completes.
const dataLocation = ref<DataLocation | null>(null)

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
    error.value = String(e)
  }
}

// Prometheus + Watch feature toggles. Each calls a Go setter that
// owns the actual side effect (server bind / fsnotify watcher) and
// rolls back the UI on round-trip failure. Watch is gated on
// Tesseract being ready — turning it on with a broken OCR setup
// would queue silent failures.
const {
  enabled: prometheusEnabled,
  setEnabled: setPrometheusEnabled,
  toggle: togglePrometheus,
} = useFeatureToggle({
  set: SetPrometheusEnabled,
  onError: (m) => { error.value = m },
})
const {
  enabled: watchEnabled,
  setEnabled: setWatchEnabled,
  toggle: toggleWatch,
} = useFeatureToggle({
  set: SetWatchEnabled,
  canEnable: () => tesseractReady.value
    ? null
    : 'Configure Tesseract in Settings → Engine before enabling Watch.',
  onError: (m) => { error.value = m },
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
    GetPrometheusEnabled(),
    GetWatchEnabled(),
    GetTesseractStatus(),
    GetNewScreenshotCount(),
    GetDataLocation(),
  ])
  const [recs, dir, promOn, watchOn, tess, newCount, loc] = results
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
  } else {
    error.value = `Could not load matches: ${String(recs.reason)}`
  }
  if (dir.status === 'fulfilled')      setScreenshotsDir(dir.value || '')
  if (promOn.status === 'fulfilled')   setPrometheusEnabled(!!promOn.value)
  if (watchOn.status === 'fulfilled')  setWatchEnabled(!!watchOn.value)
  if (tess.status === 'fulfilled')     setTesseractStatus(tess.value)
  else                                 setTesseractStatus({ path: '', found: false, version: '', supported: false, error: String(tess.reason), default: '', platform: '' })
  newScreenshotCount.value = newCount.status === 'fulfilled' ? newCount.value : null
  dataLocation.value      = loc.status === 'fulfilled' ? loc.value : null
  firstLoadPending.value = false
}

async function refreshNewCount() {
  try { newScreenshotCount.value = await GetNewScreenshotCount() } catch (_) {}
}

// User-triggered GitHub release check. Idempotent — re-clicks while
// in flight are no-ops; re-clicks after a result silently replace
// the cached updateInfo. Network failure leaves the button in its
// default state so the user can retry without an explicit error
// surface (the masthead can't carry a banner here).
async function checkForUpdates() {
  if (updateCheckBusy.value) return
  updateCheckBusy.value = true
  try {
    const u = await CheckForUpdate()
    if (u.checked) updateInfo.value = u
  } catch (_) {
    // Silent — the button reverts to "Check for updates" so the
    // user can retry. The error doesn't merit a global banner.
  } finally {
    updateCheckBusy.value = false
  }
}

async function runParse() {
  error.value = ''
  parseBusy.value = true
  parseProgress.value = null
  parseLog.value = []
  parseProgressOpen.value = false
  try {
    await ParseScreenshots()
    await load()
    lastParsedAt.value = Date.now()
    try { localStorage.setItem('recall.lastParsedAt', String(lastParsedAt.value)) } catch (_) {}
  } catch (e) {
    error.value = String(e)
  } finally {
    parseBusy.value = false
    parseProgress.value = null
    // Race tolerance: if the user clicked Stop AND the parse
    // happened to finish at the same time, the SSE
    // parse-cancelled may never fire (the server already
    // emitted parse-complete). Clearing the flag here keeps the
    // Stop button from staying stuck on "Cancelling…".
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

async function parse() {
  if (!tesseractReady.value) {
    error.value = 'Tesseract is not configured. Fix it in Settings → Engine.'
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
  onError: (m) => { error.value = m },
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
    error.value = String(e)
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
    error.value = String(e)
  }
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
    error.value = String(e)
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
    error.value = String(e)
  }
}

async function onSetMatchQueue(matchKey: string, queueType: QueueType) {
  try {
    await SetMatchQueue(matchKey, queueType)
    await load()
  } catch (e) {
    error.value = String(e)
  }
}

async function onSetMatchPlayMode(matchKey: string, playMode: PlayMode) {
  try {
    await SetMatchPlayMode(matchKey, playMode)
    await load()
  } catch (e) {
    error.value = String(e)
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
    error.value = String(e)
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
    error.value = String(e)
  }
}

async function onBulkQueue(matchKeys: string[], queueType: QueueType) {
  if (matchKeys.length === 0) return
  try {
    await BulkSetMatchQueue(matchKeys, queueType)
    await load()
  } catch (e) {
    error.value = String(e)
  }
}

// Hard-delete handler — drawer "Delete forever" affordance after
// the user confirms the two-step. Idempotent on the server so a
// double-fire from a stale UI is safe.
async function onHardDeleteMatch(matchKey: string) {
  try {
    await HardDeleteMatch(matchKey)
    await load()
  } catch (e) {
    error.value = String(e)
  }
}

// Bulk unhide — Archive drawer's bulk-action bar. Fans out
// SetMatchVisibility(false) in parallel, single reload when all
// PUTs settle. Same shape as onHideMatches.
async function onUnhideMatches(matchKeys: string[]) {
  if (matchKeys.length === 0) return
  try {
    await Promise.all(matchKeys.map((k) => SetMatchVisibility(k, false)))
    await load()
  } catch (e) {
    error.value = String(e)
  }
}

// Bulk hard-delete — Archive drawer's bulk "Delete forever" after
// the action-bar two-step confirm. Fans out HardDeleteMatch in
// parallel.
async function onHardDeleteMatches(matchKeys: string[]) {
  if (matchKeys.length === 0) return
  try {
    await Promise.all(matchKeys.map((k) => HardDeleteMatch(k)))
    await load()
  } catch (e) {
    error.value = String(e)
  }
}

// Bulk move-to-profile — MatchesView emits this from either action
// bar after the user picks a target profile. Server handles the
// two-phase transfer (write target, delete source); we reload the
// active profile's data after so the moved rows disappear from the
// current dossier.
async function onMoveMatches(matchKeys: string[], targetProfile: string) {
  if (matchKeys.length === 0) return
  try {
    await MoveMatches(matchKeys, targetProfile)
    await load()
  } catch (e) {
    error.value = String(e)
  }
}

// ── Export-bundle flow ──────────────────────────────────────────────
// The Matches bulk-action bar emits `export-bundle` with the ticked
// match_keys. App.vue captures the keys, opens the
// ExportBundleModal, and on Export → calls ExportBundle in api.ts
// which dispatches to Wails' SaveFileDialog or to a browser blob
// download depending on transport.
const exportBundleOpen = ref(false)
const exportBundleSelectedKeys = ref<string[]>([])

function onExportBundleRequest(matchKeys: string[]) {
  exportBundleSelectedKeys.value = matchKeys
  exportBundleOpen.value = true
}

async function onExportBundleConfirm(
  _filename: string,
  includeHidden: boolean,
  includeUnknown: boolean,
) {
  try {
    await ExportBundle({
      matchKeys: exportBundleSelectedKeys.value,
      includeHidden,
      includeUnknown,
    })
  } catch (e) {
    error.value = String(e)
  } finally {
    exportBundleOpen.value = false
    exportBundleSelectedKeys.value = []
  }
}

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
    error.value = String(e)
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
    error.value = String(e)
  }
}

// Ignored-screenshot management (Settings → Advanced → Manage panel).
// `ignoredScreenshots` is the rich list (filename + ignored_at) the
// panel renders; the count drives the SettingsAdvanced Manage button
// + the Clear-Database opt-out checkbox visibility. Refreshed on app
// mount, after every Ignore / Unignore / ClearIgnored / ClearDatabase
// call so callers don't have to wait for a full record reload to see
// the count tick.
const ignoredScreenshots = ref<IgnoredScreenshot[]>([])
const ignoredCount = computed(() => ignoredScreenshots.value.length)
const ignoredPanelOpen = ref(false)

async function loadIgnored() {
  try {
    ignoredScreenshots.value = await GetIgnoredScreenshots()
  } catch (e) {
    // Best-effort — failing to refresh the count shouldn't block the
    // primary record reload that triggered us.
    console.warn('GetIgnoredScreenshots failed:', e)
  }
}

function openIgnoredPanel() {
  ignoredPanelOpen.value = true
}

function closeIgnoredPanel() {
  ignoredPanelOpen.value = false
}

// Per-row Restore from the panel. Removes the file from the
// suppress-list and refreshes the list — the next Parse run will
// re-discover the file from disk.
async function onUnignoreScreenshot(filename: string) {
  try {
    await UnignoreScreenshot(filename)
    await loadIgnored()
  } catch (e) {
    error.value = String(e)
  }
}

// Bulk Re-enable all from the panel — truncates the suppress-list in
// one call. Same downstream as per-file restore: the panel re-renders
// empty and the user can Run Parse to re-discover everything.
async function onClearIgnoredScreenshots() {
  try {
    await ClearIgnoredScreenshots()
    await loadIgnored()
  } catch (e) {
    error.value = String(e)
  }
}

// "Run Parse now" link inside the panel — close the modal, switch to
// the Parse tab, and kick the existing manual-parse flow.
function onRunParseFromIgnored() {
  closeIgnoredPanel()
  goToView('ingest')
  void parse()
}

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
// "Since this match" anchor — persists across reloads (per-OS-profile
// in localStorage). The narrow state borrows the same ref so the
// filter sees mutations from the detail panel without a round-trip.
const matchAnchor = useMatchAnchor()
const matchesNarrowState = createMatchesNarrowState({ anchorKey: matchAnchor.anchorKey })
const matchesNarrow = useMatchesNarrow(records, matchesNarrowState)

// Search-clause parsing for the detail-panel hit highlighter.
// Sources directly off the narrow panel's `searchText` so there's
// no bridge ref to keep in sync — exactly the simplification the
// useMatchFilters teardown enabled. The narrow filter's own
// `activeClauseCount` is what the masthead badge reads now.
const { searchClauses } = useSearchClauses(matchesNarrowState.searchText)
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
  type:   { picked: () => matchesNarrowState.pickedMapTypes.value, pick: matchesNarrow.pickMapType },
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
  matchesNarrowState.pickedMapTypes.value = new Set()
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
  || matchesNarrowOpen.value,
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
// See UI_RECOMMENDATIONS.md item 4 for the design + FEATURES.md
// for the cheatsheet contract.
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
  toggleExpand,
})

// Keep TAB_ORDER referenced so a future tab addition can lint-check
// the g-prefix coverage above. (Each entry in TAB_ORDER must have a
// matching g+x handler.)
void TAB_ORDER

// Records that couldn't be resolved to a named match — either the
// screenshot filename had no parseable OW timestamp ("unmatched-…")
// or OCR failed to determine a map name. These surface in the
// Unknown Maps view for triage.
const unknownRecords = computed(() =>
  records.value.filter(r => !r.data?.map && !r.ambiguous)
)
// Records flagged hidden by the user via the Matches drawer. Used by
// the export-bundle modal to surface the count + offer the "include
// hidden" toggle without forcing the user to navigate the archive.
const hiddenRecords = computed(() =>
  records.value.filter(r => !!r.hidden),
)
// Records the resolver couldn't pin to a single match (EAD-bridge
// ambiguity). Surface above unknownRecords in the Unknown tab so
// the user can pick the correct attribution via the candidate
// picker.
const ambiguousRecords = computed(() =>
  records.value.filter(r => r.ambiguous),
)


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

  GetVersion().then(v => { appVersion.value = v }).catch(() => {})
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
useEventStream({
  records,
  parseProgress,
  parseLog,
  onParseComplete: async () => {
    await load()
    lastParsedAt.value = Date.now()
    try { localStorage.setItem('recall.lastParsedAt', String(lastParsedAt.value)) } catch (_) {}
    // Race tolerance: if the user clicked Stop right before the
    // parse finished naturally, parse-complete may arrive before
    // (or instead of) parse-cancelled. Clear the cancelling flag
    // here so the Stop button doesn't stay stuck on "Cancelling…"
    // for a watcher-triggered parse where runParse's finally
    // never ran.
    cancellingParse.value = false
    const n = records.value.length
    announceParse(`Parse complete. ${n} match${n === 1 ? '' : 'es'} loaded.`)
  },
  // SSE confirmation of a Stop click. Records ref already reflects
  // whatever made it into SQLite before the cancellation point —
  // call load() so the matches list rebinds, then clear the
  // cancelling flag so IngestView's Stop button flips back to Run.
  onParseCancelled: async () => {
    await load()
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
    <div class="sr-only" role="status" aria-live="polite">{{ parseAnnouncement }}</div>

    <div class="atmos" aria-hidden="true" />
    <div class="grid-lines" aria-hidden="true" />

    <div class="container" :inert="backgroundFrozen || undefined" :aria-hidden="backgroundFrozen ? 'true' : undefined">
      <!-- System Alert: blocks both Matches and Settings flow when the
           OCR engine isn't usable. Renders ABOVE the masthead so it's
           the first thing a user sees on a broken install. -->
      <div v-if="!tesseractReady" class="system-alert" role="alert">
        <div class="system-alert-stripes" aria-hidden="true" />
        <div class="system-alert-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26">
            <path d="M12 2.6 L22.4 20.5 L1.6 20.5 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            <line x1="12" y1="10" x2="12" y2="15.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            <circle cx="12" cy="17.8" r="1.2" fill="currentColor" />
          </svg>
        </div>
        <div class="system-alert-body">
          <div class="system-alert-eyebrow">
            System Halt · OCR Engine Offline
          </div>
          <h3 class="system-alert-title">
            Tesseract not detected
            <span class="system-alert-path" :title="tesseractStatus.path">{{ tesseractStatus.path || '— no path —' }}</span>
          </h3>
          <p class="system-alert-desc">
            {{ tesseractStatus.error || 'Recall cannot OCR screenshots without Tesseract. Install it, or point Recall at the existing binary in Settings → Engine.' }}
          </p>
        </div>
        <div class="system-alert-actions">
          <button class="btn alert-cta" @click="gotoEngineSettings">
            <span class="alert-cta-arrow" aria-hidden="true">→</span>
            Fix in Settings → Engine
          </button>
        </div>
      </div>

      <header class="masthead">
        <div class="masthead-left">
          <!-- Brandmark also acts as the repo link. Use <a> so the
               markup is semantically navigational (and middle-/right-
               click "open in new tab" work in server mode), but route
               left-clicks through OpenURL so Wails mode hits the OS
               browser instead of the embedded WebView. -->
          <a
            class="brandmark-tile brandmark-link"
            :href="GITHUB_REPO_URL"
            target="_blank"
            rel="noopener noreferrer"
            :title="`Open Recall on GitHub — ${GITHUB_REPO_URL}`"
            aria-label="Open the Recall project on GitHub"
            @click.prevent="OpenURL(GITHUB_REPO_URL)"
          >
            <span class="brand-tick">↺</span>
            <h1 class="brand">
              RE<span class="brand-accent">CALL</span>
            </h1>
            <span class="brand-corner" aria-hidden="true" />
            <span class="brand-extlink" aria-hidden="true">↗</span>
          </a>
          <p class="tagline">
            Personal Telemetry · Match Almanac
          </p>
          <!-- Workflow order: configure → ingest → view → triage. Matches
               stays the default landing tab even though it sits at position
               03 — the numbering communicates the intended user flow. -->
          <nav class="page-nav" role="tablist" aria-label="Primary" @keydown="onTabKeydown">
            <button
              id="tab-settings"
              class="nav-tab"
              :class="{ active: view === 'settings' }"
              :aria-selected="view === 'settings'"
              :aria-current="view === 'settings' ? 'page' : undefined"
              :tabindex="view === 'settings' ? 0 : -1"
              role="tab"
              aria-controls="panel-settings"
              @click="goToView('settings')"
            >
              <span class="nav-tab-num">01</span>
              <span class="nav-tab-label">Settings</span>
            </button>
            <button
              id="tab-ingest"
              class="nav-tab"
              :class="{ active: view === 'ingest' }"
              :aria-selected="view === 'ingest'"
              :aria-current="view === 'ingest' ? 'page' : undefined"
              :tabindex="view === 'ingest' ? 0 : -1"
              role="tab"
              aria-controls="panel-ingest"
              @click="goToView('ingest')"
            >
              <span class="nav-tab-num">02</span>
              <span class="nav-tab-label">Parse</span>
            </button>
            <button
              id="tab-matches"
              class="nav-tab"
              :class="{ active: view === 'matches' }"
              :aria-selected="view === 'matches'"
              :aria-current="view === 'matches' ? 'page' : undefined"
              :tabindex="view === 'matches' ? 0 : -1"
              role="tab"
              aria-controls="panel-matches"
              @click="goToView('matches')"
            >
              <span class="nav-tab-num">03</span>
              <span class="nav-tab-label">
                Matches
                <span
                  v-if="activeFilterCount > 0 && view !== 'matches'"
                  class="nav-tab-filter-dot"
                  :title="`${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`"
                  aria-label="filters active"
                />
              </span>
            </button>
            <button
              id="tab-unknown"
              class="nav-tab"
              :class="{ active: view === 'unknown' }"
              :aria-selected="view === 'unknown'"
              :aria-current="view === 'unknown' ? 'page' : undefined"
              :tabindex="view === 'unknown' ? 0 : -1"
              role="tab"
              aria-controls="panel-unknown"
              @click="goToView('unknown')"
            >
              <span class="nav-tab-num">04</span>
              <span class="nav-tab-label">
                Unknown
                <span v-if="unknownRecords.length > 0" class="nav-tab-badge">{{ unknownRecords.length }}</span>
              </span>
            </button>
            <!-- 05 Analysis is a work-in-progress dashboard sketch.
                 Only exposed to dev builds so release users don't see
                 the incomplete chrome. Hidden from both the tablist
                 and the keyboard nav cycle (via visibleTabs) when the
                 version string lacks the "-dev" suffix. Positioned
                 last so Unknown's number stays "04" across dev +
                 release — dev users see the same Unknown anchor
                 release users do, just with an extra tab on the end. -->
            <button
              v-if="isDevBuild"
              id="tab-analysis"
              class="nav-tab"
              :class="{ active: view === 'analysis' }"
              :aria-selected="view === 'analysis'"
              :aria-current="view === 'analysis' ? 'page' : undefined"
              :tabindex="view === 'analysis' ? 0 : -1"
              role="tab"
              aria-controls="panel-analysis"
              @click="goToView('analysis')"
            >
              <span class="nav-tab-num">05</span>
              <span class="nav-tab-label">Analysis</span>
            </button>
          </nav>
        </div>
        <div class="masthead-right">
          <MastheadParseChip
            :parse-progress="parseProgress"
            @go-to-view="goToView"
          />
          <div
            v-if="records.length > 0 && view === 'matches'"
            class="scoreboard"
            :class="{ pulse: recordsPulse }"
            title="Wins · Losses · Draws across the currently filtered matches"
          >
            <div class="score-cell">
              <span class="score-num win">{{ wld.w }}</span>
              <span class="score-label">Won</span>
            </div>
            <div class="score-cell">
              <span class="score-num loss">{{ wld.l }}</span>
              <span class="score-label">Lost</span>
            </div>
            <div class="score-cell">
              <span class="score-num draw">{{ wld.d }}</span>
              <span class="score-label">Drew</span>
            </div>
          </div>
          <ProfileSwitcher />
          <div class="ver-block">
            <span v-if="appVersion" class="app-version">v{{ appVersion }}</span>
            <!-- Default state — manual update check. Clicking fires
                 CheckForUpdate (GitHub releases roundtrip); the
                 result swaps the button for one of the three result
                 states below. NOT auto-fired on mount: opting in
                 keeps the boot path off the network. -->
            <button
              v-if="updateInfo === null"
              class="ver-btn ver-btn-check"
              :disabled="updateCheckBusy"
              :title="updateCheckBusy ? 'Checking GitHub releases…' : 'Check GitHub for a newer release'"
              @click="checkForUpdates"
            >
              {{ updateCheckBusy ? 'Checking…' : 'Check for updates' }}
            </button>
            <!-- Result: dev build — link out to the latest release
                 regardless of whether it's "newer" than this build's
                 SHA. The server returns dev_build=true when the
                 local version is "0.0.0-dev" / similar. -->
            <button
              v-else-if="updateInfo.dev_build"
              class="ver-btn ver-btn-dev"
              :title="`Open release page for v${updateInfo.latest}`"
              @click="OpenURL(updateInfo.url)"
            >
              ↗ view release v{{ updateInfo.latest }}
            </button>
            <!-- Result: a newer release is published. -->
            <button
              v-else-if="updateInfo.available"
              class="ver-btn ver-btn-update"
              :title="`Download v${updateInfo.latest}`"
              @click="OpenURL(updateInfo.url)"
            >
              ↑ New version ready · v{{ updateInfo.latest }}
            </button>
            <!-- Result: at the latest release. -->
            <span
              v-else
              class="ver-btn ver-btn-current"
            >✓ Up to date</span>
          </div>
        </div>
      </header>

      <p v-if="error" class="error">
        <span class="error-tick">✕</span>{{ error }}
      </p>

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
          :prometheus-enabled="prometheusEnabled"
          :clear-confirm="clearConfirm"
          :clearing-d-b="clearingDB"
          :ignored-count="ignoredCount"
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
          @toggle-prometheus="togglePrometheus"
          @arm-clear="armClear"
          @clear-database="onClearDatabase"
          @cancel-clear="cancelClear"
          @open-ignored-panel="openIgnoredPanel"
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
          :matched-count="records.length"
          :unknown-count="unknownRecords.length"
          @toggle-watch="toggleWatch"
          @parse="parse"
          @cancel-parse="onCancelParse"
          @toggle-progress="parseProgressOpen = !parseProgressOpen"
          @go-to-view="goToView"
        />

        <!-- ─── UNKNOWN MAPS VIEW ────────────────────────────────── -->
        <UnknownMapsView
          v-if="view === 'unknown'"
          :unknown-records="unknownRecords"
          :ambiguous-records="ambiguousRecords"
          :all-records="records"
          :card-state="cardState"
          :preload-screenshot="screenshotPreview.preload"
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
          :records="records"
          :narrow="matchesNarrow"
          :focused-card-index="focusedCardIndex"
          @open-match="(k: string) => selection.open(k)"
          @narrow-open="onMatchesNarrowOpen"
          @hide-matches="onHideMatches"
          @bulk-play-mode="onBulkPlayMode"
          @bulk-queue="onBulkQueue"
          @unhide-match="(k: string) => onSetMatchHidden(k, false)"
          @hard-delete-match="onHardDeleteMatch"
          @unhide-matches="onUnhideMatches"
          @hard-delete-matches="onHardDeleteMatches"
          @move-matches="onMoveMatches"
          @export-bundle="onExportBundleRequest"
          @clear-anchor="onSetAnchor('')"
          @set-anchor="onSetAnchor"
        />

        <!-- ─── ANALYSIS VIEW (coaching dashboard sketch) ──────────
             Gated on isDevBuild — keeps the WIP panel out of release
             builds even if a user somehow ends up with view='analysis'
             persisted (currently view is in-memory only, but the gate
             stays defence-in-depth). -->
        <MatchesDashboardSketch
          v-if="view === 'analysis' && isDevBuild"
          :records="records"
          :selected-match-key="selection.selectedKey.value"
          @open-match="(matchKey: string) => selection.open(matchKey)"
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
      @set-match-hidden="onSetMatchHidden"
      @set-match-review="onSetMatchReview"
      @set-match-queue="onSetMatchQueue"
      @set-match-play-mode="onSetMatchPlayMode"
      @set-anchor="onSetAnchor"
      :anchor-key="matchAnchor.anchorKey.value"
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
    <transition name="modal-fade">
      <div
        v-if="showStartupErrorModal"
        class="modal-overlay"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="startup-error-title"
        aria-describedby="startup-error-message"
        data-testid="startup-error-modal"
      >
        <div class="modal-box startup-error">
          <div class="modal-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path d="M12 2.6 L22.4 20.5 L1.6 20.5 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
              <line x1="12" y1="10" x2="12" y2="15.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <circle cx="12" cy="17.8" r="1.2" fill="currentColor" />
            </svg>
          </div>
          <h3 id="startup-error-title" class="modal-title">
            Recall could not start
          </h3>
          <p id="startup-error-message" class="modal-body">
            {{ startupErrorMessage }}
          </p>
          <p class="modal-body modal-caution">
            Recall captured a failure during boot — restart the app to try again. If the problem persists, check the application data directory for permissions issues and file a report from the Settings tab once you can re-enter the app.
          </p>
        </div>
      </div>
    </transition>

    <!-- Unsupported Tesseract version confirmation modal -->
    <transition name="modal-fade">
      <div v-if="showUnsupportedModal" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title" @click.self="showUnsupportedModal = false">
        <div class="modal-box">
          <div class="modal-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path d="M12 2.6 L22.4 20.5 L1.6 20.5 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
              <line x1="12" y1="10" x2="12" y2="15.4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <circle cx="12" cy="17.8" r="1.2" fill="currentColor" />
            </svg>
          </div>
          <h3 id="modal-title" class="modal-title">
            Unsupported Tesseract Version
          </h3>
          <p class="modal-body">
            Tesseract <strong>{{ tesseractStatus.version }}</strong> is detected. Only version <strong>5.x</strong> is officially tested with Recall.
          </p>
          <p class="modal-body modal-caution">
            Proceed at your own caution — OCR results may be incorrect or incomplete with this version.
          </p>
          <div class="modal-actions">
            <button class="btn ghost" @click="showUnsupportedModal = false">
              Cancel
            </button>
            <button class="btn primary" @click="confirmUnsupportedParse">
              Continue Anyway
            </button>
          </div>
        </div>
      </div>
    </transition>

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

    <!-- First-launch tour overlay. Self-gates via localStorage;
         renders nothing once dismissed. Steps drive the underlying
         app via @navigate (tab switch), @open-match / @close-match
         (detail panel), @open-narrow / @close-narrow (filter
         popover), and @apply-hero-filter / @clear-filters
         (matchesNarrowState picks). @active-change flips the
         records swap so every tour step lands on demo data. -->
    <OnboardingTour
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
      @dismiss="onFirstRunDismiss"
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
  </div>
</template>

