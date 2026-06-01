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
import type { MatchRecord, DataLocation } from './api'
import {
  GetVersion,
  CheckForUpdate,
  OpenURL,
  type UpdateInfo,
  ParseScreenshots,
  GetMatchResults,
  GetScreenshotsDir,
  PickScreenshotsDir,
  ProbeScreenshotsDir,
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
  ImportData,
  ResolveAmbiguousMatch,
  SetMatchAnnotation,
  SetMatchVisibility,
  HardDeleteMatch,
  MoveMatches,
} from './api'
import type { MatchAnnotationInput } from './api'
import { tallyWLD, screenshotURL } from './match-helpers'
import { useIncludeUndated } from './composables/useIncludeUndated'
import { useIncludeUnknown } from './composables/useIncludeUnknown'
import { useMinPlayThreshold } from './composables/useMinPlayThreshold'
import { useLeaverHandling } from './composables/useLeaverHandling'
import { useShowHidden } from './composables/useShowHidden'
import { useTabKeyboardNav, TAB_ORDER, type TabId } from './composables/useTabKeyboardNav'
import { useKeyboardShortcuts, type Shortcut } from './composables/useKeyboardShortcuts'
import { useModalFocusTrap } from './composables/useModalFocusTrap'
import { useBackupRestore } from './composables/useBackupRestore'
import { useClearDatabase } from './composables/useClearDatabase'
import { useTesseractStatus } from './composables/useTesseractStatus'
import { useScreenshotsDir } from './composables/useScreenshotsDir'
import { useFeatureToggle } from './composables/useFeatureToggle'
import { useEventStream } from './composables/useEventStream'
import { useTheme } from './composables/useTheme'
import { useWeekStart } from './composables/useWeekStart'
import { useMatchFilters } from './composables/useMatchFilters'
import { useSelectedMatch } from './composables/useSelectedMatch'
import { useMatchesNarrow, createMatchesNarrowState } from './composables/useMatchesNarrow'
import type { ParseProgressEvent } from './components/ParseProgressPanel.vue'
import ParseStatusBar from './components/ParseStatusBar.vue'
import MastheadParseChip from './components/MastheadParseChip.vue'
import MatchesSkeleton from './components/MatchesSkeleton.vue'
import { useFirstRunAcknowledged } from './composables/useFirstRunAcknowledged'
// First-run modal only renders on the very first launch (or after the
// user clears localStorage). Lazy-loaded so 99 % of session boots
// don't pay for its bytes in the initial JS chunk.
const FirstRunProfileModal = defineAsyncComponent(() => import('./components/FirstRunProfileModal.vue'))

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
// localStorage key the tour writes when the user finishes / skips.
// Duplicated as a literal here (not imported from
// './composables/useOnboardingTour') because a static `import` would
// pull the whole tour controller into the initial JS chunk, defeating
// the lazy-load above. The pair is locked at runtime by the
// `App.lazy-views` + tour e2e tests — a divergence between the two
// keys breaks the gate and is caught by `does NOT render while the
// onboarding tour is active` in profile-delete-and-first-run.spec.ts.
const ONBOARDING_COMPLETED_KEY = 'recall.onboardingCompleted'

// GitHub repository URL — surfaced via the brandmark in the masthead.
// Centralised here so the markup, hover title, and any future references
// stay in sync. Routed through OpenURL so Wails-mode clicks open in the
// user's system browser instead of the embedded WebView.
const GITHUB_REPO_URL = 'https://github.com/sound-barrier/recall'

const records = ref<MatchRecord[]>([])
const error = ref('')
const loading = ref(false)
// `initialLoading` is true from boot until the first load() resolves
// (or fails). Drives the Matches skeleton placeholder so the view
// doesn't render its empty-state for a frame between mount and the
// first /api/v1/matches response. Distinct from `loading` (the
// parse-button busy ref) because a manual parse should NOT swap the
// real records for skeleton rows.
const initialLoading = ref(true)

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
// activeFilterCount surfaces in the matches-tab nav badge so it lives
// outside the view component too.
// "Include undated matches" toggle. Default off — records without
// data.date are hidden from the matched view until the user opts in
// via the FilterRail toggle. Persisted in localStorage so the choice
// survives across launches.
const { includeUndated } = useIncludeUndated()
const {
  minPlayPercent, minPlayMinutes,
  setMinPlayPercent, setMinPlayMinutes,
} = useMinPlayThreshold()
const { leaverHandling } = useLeaverHandling()
// "Show hidden matches" toggle. Default off — soft-deleted matches
// stay out of view until the user opts in to see them.
const { showHidden } = useShowHidden()
// "Show unknown-map matches" toggle for the Matches narrow panel.
// Default off — unknown-map records live in the Unknown tab.
const { includeUnknown } = useIncludeUnknown()
const filters = useMatchFilters(
  records,
  includeUndated,
  minPlayPercent, minPlayMinutes,
  setMinPlayPercent, setMinPlayMinutes,
  leaverHandling,
  showHidden,
  includeUnknown,
)
const { activeFilterCount } = filters
// First-day-of-week preference (Settings → Calendar).
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
  initialLoading.value = false
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
  loading.value = true
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
    loading.value = false
    parseProgress.value = null
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

// Two-step "Clear database" flow: arm → confirm → execute → reload.
const { clearingDB, clearConfirm, clearDatabase, armClear, cancelClear } = useClearDatabase({
  clearDatabase: ClearDatabase,
  afterClear: () => load(),
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
const matchesNarrowState = createMatchesNarrowState()
const matchesNarrow = useMatchesNarrow(records, matchesNarrowState)
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
const { acknowledged: firstRunAcknowledged, ack: ackFirstRun } = useFirstRunAcknowledged()
// Gate on the tour too — `it should not appear if the tour is
// starting or continuing on`. `tourActive` is seeded synchronously
// from the onboarding flag (see readTourWillOpen above), so on a
// fresh install where both flags are unset the tour wins the first
// paint; once the user finishes / skips the tour, `tourActive`
// flips false and the modal surfaces.
const firstRunModalOpen = computed(() => !firstRunAcknowledged.value && !tourActive.value)

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
// follows the first hit so the highlighted content is visible
// without an extra click. The watcher fires on every matchQuery
// change while the panel is open; when the user clears the search,
// we leave the selection where it last landed (don't snap back to
// a previous match — that would surprise the user).
watch(
  () => filters.matchQuery.value,
  () => {
    if (!selection.isOpen.value) return
    if (filters.searchClauses.value.length === 0) return
    const first = filters.filteredSorted.value[0]
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
// (NOT the legacy `filters.filteredSorted`) so this stays in sync with
// the MatchesView dossier's Record KPI tile — the legacy pipeline
// silently drops undated rows, which would surface the same data as
// two different W/L/D readings between the masthead and the Record
// tile when a rank-inferred result has no SUMMARY-supplied date.
// Honors the same `leaver-exclude-tally` rule the dossier applies.
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

// Per-filename screenshot preview expansion. Keyed by filename so the
// same screenshot stays open if you collapse and re-open the source
// list. Image bytes come from the Go ScreenshotHandler at
// /_screenshot/<filename> — no IPC round-trip.
const previewOpen = ref<Record<string, boolean>>({})
const previewError = ref<Record<string, boolean>>({})
function togglePreview(filename: string) {
  previewError.value = { ...previewError.value, [filename]: false }
  previewOpen.value = { ...previewOpen.value, [filename]: !previewOpen.value[filename] }
}
function onPreviewError(filename: string) {
  previewError.value = { ...previewError.value, [filename]: true }
}

// Fullscreen screenshot lightbox state. null = closed. Opened from
// the inline preview img in MatchCardExpanded (event bubbles up
// through MatchDetailPanel); closed via × / Esc / backdrop click
// inside MatchScreenshotLightbox itself. Lives at App.vue root so
// the modal stacks above the detail panel.
//
// `lightboxFiles` carries a snapshot of the owning record's
// `source_files` at the time the user opened the lightbox — the
// lightbox uses it for prev/next navigation (←/→ + h/l + < / >
// buttons) without having to reach back into the Vue tree for the
// owning record. Snapshotting protects against the underlying
// record changing mid-view (e.g. an SSE-driven reload of the matches
// list) — the user keeps walking the set they actually opened.
const lightboxFilename = ref<string | null>(null)
const lightboxFiles    = ref<string[]>([])
// Filename → dir-id map snapshot for the lightbox session. Captured
// at open time from the owning record's source_dir_ids so the
// fullscreen URL stays accurate as the user paginates with ←/→
// even if the underlying record refreshes mid-view.
const lightboxDirIDs   = ref<Record<string, number>>({})
const lightboxSrc = computed(() => {
  const f = lightboxFilename.value
  if (!f) return null
  return screenshotURL(f, lightboxDirIDs.value[f] ?? 0)
})
const lightboxIndex = computed(() =>
  lightboxFilename.value
    ? lightboxFiles.value.indexOf(lightboxFilename.value)
    : -1,
)
function openLightbox(
  filename: string,
  files: readonly string[] = [filename],
  dirIDs: Record<string, number> = {},
) {
  lightboxFilename.value = filename
  lightboxFiles.value = files.length > 0 ? [...files] : [filename]
  lightboxDirIDs.value = { ...dirIDs }
}
function closeLightbox() {
  lightboxFilename.value = null
  lightboxFiles.value = []
}
function lightboxPrev() {
  const i = lightboxIndex.value
  if (i > 0) lightboxFilename.value = lightboxFiles.value[i - 1]!
}
function lightboxNext() {
  const i = lightboxIndex.value
  if (i >= 0 && i < lightboxFiles.value.length - 1)
    lightboxFilename.value = lightboxFiles.value[i + 1]!
}

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

// CardStateApi exposed as all-functions (post item-8). The underlying
// state (previewOpen, previewError refs) is still owned here at the
// App.vue scope so the same preview-open state survives a tab swap
// from Unknown → Matches → Unknown; the getter functions just close
// over those refs.
const cardState = {
  isSelected: isUnknownExpanded,
  isSourcesOpen,
  isPreviewOpen:   (filename: string) => !!previewOpen.value[filename],
  hasPreviewError: (filename: string) => !!previewError.value[filename],
  toggleExpand: toggleUnknownExpand,
  toggleSources,
  togglePreview,
  onPreviewError,
}

// ── Keyboard shortcuts — full registry ─────────────────────────
// Wired here (after filters + toggleExpand + goToView are all in
// scope) rather than alongside the focusedCardIndex ref above so
// every handler can capture stable references. The dispatcher
// installs ONE capture-phase document listener; per-binding `when`
// predicates gate view-specific shortcuts. See UI_RECOMMENDATIONS.md
// item 4 for the design + FEATURES.md for the cheatsheet contract.
useKeyboardShortcuts([
  // Global: open the Narrow panel and focus its search input. The
  // search lives inside the narrow popover (#np-search) — clicking
  // the dossier trigger surfaces it; we then wait a tick for the
  // teleported popover to mount before stealing focus. Input-gated
  // so typing `/` in any input is a literal character, and
  // suppressed while the detail panel is open (modal contract).
  {
    key: '/',
    when: () => !selection.isOpen.value,
    handler: () => {
      void (async () => {
        if (view.value !== 'matches') await goToView('matches')
        await nextTick()
        // If the narrow popover isn't open, click its dossier
        // trigger to open it.
        if (!document.getElementById('narrow-popover')) {
          const trigger = document.querySelector<HTMLButtonElement>(
            '.dossier-actions .dossier-btn.primary',
          )
          trigger?.click()
          await nextTick()
        }
        const el = document.getElementById('np-search')
        if (el instanceof HTMLInputElement) el.focus()
      })()
    },
  },
  // Global: open the cheatsheet. allowInInput so the user can hit
  // `?` from anywhere — including while typing in a search box.
  {
    key: '?',
    allowInInput: true,
    handler: () => { openCheatsheet.value = true },
  },
  // Global: vim-style view navigation (`g` then a/m/i/s/u).
  ...(['m', 'i', 's', 'u', 'a'] as const).map((follow): Shortcut => {
    const target: TabId = (
      follow === 'm' ? 'matches'  :
      follow === 'i' ? 'ingest'   :
      follow === 's' ? 'settings' :
      follow === 'a' ? 'analysis' : 'unknown'
    )
    return {
      key: follow,
      prefix: 'g',
      handler: () => { void goToView(target) },
    }
  }),
  // Matches view: j/k move card focus, no wrap. Suppressed when the
  // detail panel is open — the panel's own keydown listener takes
  // over (j/k paginates within the open panel). The list driving the
  // index is the same narrowedRecords MatchesView renders, so the
  // index always points at the row the user sees.
  {
    key: 'j',
    when: () => view.value === 'matches' && !selection.isOpen.value,
    handler: () => {
      const len = matchesNarrow.narrowedRecords.value.length
      if (len === 0) return
      const next = Math.min(focusedCardIndex.value + 1, len - 1)
      if (next === focusedCardIndex.value && focusedCardIndex.value !== -1) return
      void focusCardByIndex(Math.max(0, next))
    },
  },
  {
    key: 'k',
    when: () => view.value === 'matches' && !selection.isOpen.value,
    handler: () => {
      const len = matchesNarrow.narrowedRecords.value.length
      if (len === 0) return
      // First k from "no card focused" lands on card 0; otherwise
      // step back, clamped at 0.
      const next = focusedCardIndex.value === -1 ? 0 : Math.max(0, focusedCardIndex.value - 1)
      void focusCardByIndex(next)
    },
  },
  // Matches view: open / close the detail panel for the focused card.
  // From the closed state this is the keyboard alternative to clicking
  // the card. With the panel already open `e` closes it (the panel's
  // own Esc handler does the same).
  {
    key: 'e',
    when: () => view.value === 'matches' && focusedCardIndex.value >= 0,
    handler: () => {
      const rec = matchesNarrow.narrowedRecords.value[focusedCardIndex.value]
      if (!rec) return
      if (selection.isOpen.value && selection.selectedKey.value === rec.match_key) {
        selection.close()
      } else {
        void toggleExpand(rec.match_key)
      }
    },
  },
  // Matches view: open the detail panel for the focused card AND
  // focus its tags input. Tags input has id="tags-<match_key>" per
  // MatchCardExpanded.vue.
  {
    key: 't',
    when: () => view.value === 'matches' && focusedCardIndex.value >= 0,
    handler: async () => {
      const rec = matchesNarrow.narrowedRecords.value[focusedCardIndex.value]
      if (!rec) return
      if (selection.selectedKey.value !== rec.match_key) {
        await toggleExpand(rec.match_key)
      }
      await nextTick()
      const input = document.getElementById(`tags-${rec.match_key}`)
      if (input instanceof HTMLInputElement) input.focus()
    },
  },
], { suppressed: openCheatsheet })

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
})

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
  },
})
</script>

<template>
  <div class="app">
    <!-- Skip-link: first focusable on the page so keyboard users can
         bypass the masthead and nav tabs on every load. Visually hidden
         until focused, then snaps in over the top-left corner. -->
    <a class="skip-link" href="#main-content" @click="focusMain">Skip to main content</a>
    <div class="atmos" aria-hidden="true" />
    <div class="grid-lines" aria-hidden="true" />

    <div class="container" :inert="(firstRunModalOpen || showUnsupportedModal || selection.isOpen.value || matchesNarrowOpen) || undefined" :aria-hidden="(firstRunModalOpen || showUnsupportedModal || selection.isOpen.value || matchesNarrowOpen) ? 'true' : undefined">
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
          :loading="loading"
          :theme-mode="themeMode"
          :week-start="weekStart"
          :data-location="dataLocation"
          :probing="probing"
          :probe-message="probeMessage"
          :probe-status="probeStatus"
          :probe-tried="probeTried"
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
          @pick-screenshots-dir="pickDir"
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
          @clear-database="clearDatabase"
          @cancel-clear="cancelClear"
        />

        <!-- ─── PARSE VIEW (Watch + Manual Parse + Progress) ─────── -->
        <IngestView
          v-if="view === 'ingest'"
          :tesseract-ready="tesseractReady"
          :screenshots-dir="screenshotsDir"
          :watch-enabled="watchEnabled"
          :loading="loading"
          :new-screenshot-count="newScreenshotCount"
          :last-parsed-at="lastParsedAt"
          :parse-progress="parseProgress"
          :parse-log="parseLog"
          :parse-progress-open="parseProgressOpen"
          :matched-count="records.length"
          :unknown-count="unknownRecords.length"
          @toggle-watch="toggleWatch"
          @parse="parse"
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
          @go-to-view="goToView"
          @resolve-ambiguous="onResolveAmbiguous"
          @open-lightbox="openLightbox"
        />

        <!-- ─── MATCHES VIEW ───────────────────────────────────── -->
        <!-- First paint: render skeleton leaf-rows until the initial
             /api/v1/matches roundtrip lands. The skeleton mirrors the
             real .leaf-row grid so the page geometry doesn't shift. -->
        <MatchesSkeleton
          v-if="view === 'matches' && initialLoading && records.length === 0"
        />
        <MatchesView
          v-else-if="view === 'matches'"
          :records="records"
          :loading="loading"
          :narrow="matchesNarrow"
          :focused-card-index="focusedCardIndex"
          @open-match="(k: string) => selection.open(k)"
          @narrow-open="onMatchesNarrowOpen"
          @hide-matches="onHideMatches"
          @unhide-match="(k: string) => onSetMatchHidden(k, false)"
          @hard-delete-match="onHardDeleteMatch"
          @unhide-matches="onUnhideMatches"
          @hard-delete-matches="onHardDeleteMatches"
          @move-matches="onMoveMatches"
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
      :inert="(firstRunModalOpen || showUnsupportedModal || selection.isOpen.value || matchesNarrowOpen) || undefined"
      :aria-hidden="(firstRunModalOpen || showUnsupportedModal || selection.isOpen.value || matchesNarrowOpen) ? 'true' : undefined"
      @go-to-view="goToView"
    />

    <!-- Match detail panel — replaces inline expansion. Slides in
         from the right when a match is selected; j/k paginates
         within the panel, Esc / click-outside closes. -->
    <MatchDetailPanel
      :record="selection.selectedRecord.value"
      :is-open="selection.isOpen.value"
      :is-sources-open="isSourcesOpen(selection.selectedKey.value)"
      :preview-open="previewOpen"
      :preview-error="previewError"
      :is-active="filters.isActive"
      :search-clauses="filters.searchClauses.value"
      :can-prev="selection.canPrev.value"
      :can-next="selection.canNext.value"
      :position-index="selection.selectedIndex.value + 1"
      :position-total="filters.filteredSorted.value.length"
      :has-lightbox="lightboxFilename !== null"
      @close="selection.close"
      @prev="selection.openPrev"
      @next="selection.openNext"
      @toggle-sources="toggleSources(selection.selectedKey.value)"
      @toggle-preview="togglePreview"
      @preview-error="onPreviewError"
      @open-lightbox="openLightbox"
      @filter-toggle="filters.toggleFilter"
      @set-leaver-annotation="onSetLeaverAnnotation"
      @set-match-annotation="onSetMatchAnnotation"
      @set-match-hidden="onSetMatchHidden"
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
  </div>
</template>

