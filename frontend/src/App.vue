<script setup lang="ts">
// App-wide styles — extracted from this SFC to keep App.vue navigable
// (~890 lines of template + script vs. ~4 600 lines when the 3 698-line
// <style> block was inline). Imported here rather than via main.ts so
// the dependency lives next to the component that anchors the cascade.
// Still globally scoped (matches the historical behaviour); component-
// specific selectors are tracked for a follow-up extraction into
// per-SFC scoped <style> blocks.
import './styles/app.css'

import { ref, computed, onMounted, nextTick, defineAsyncComponent } from 'vue'
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
  SetScreenshotsDir,
  GetPrometheusEnabled,
  SetPrometheusEnabled,
  GetWatchEnabled,
  SetWatchEnabled,
  GetTesseractStatus,
  PickTesseractBinary,
  ResetTesseractPath,
  ClearDatabase,
  GetNewScreenshotCount,
  GetDataLocation,
  ExportData,
  ExportDataCSV,
  ImportData,
  SetLeaverAnnotation,
  ClearLeaverAnnotation,
  SetMatchAnnotation,
  SetMatchVisibility,
} from './api'
import type { LeaverKind, MatchAnnotationInput } from './api'
import { computeEarliestMatchDateTime, tallyWLD } from './match-helpers'
import { useIncludeUndated } from './composables/useIncludeUndated'
import { useMinPlayThreshold } from './composables/useMinPlayThreshold'
import { useDensityMode } from './composables/useDensityMode'
import { useLeaverHandling } from './composables/useLeaverHandling'
import { useShowHidden } from './composables/useShowHidden'
import { useTabKeyboardNav, TAB_ORDER, type TabId } from './composables/useTabKeyboardNav'
import { useKeyboardShortcuts, type Shortcut } from './composables/useKeyboardShortcuts'
import KeyboardShortcutsModal from './components/KeyboardShortcutsModal.vue'
import { useModalFocusTrap } from './composables/useModalFocusTrap'
import { useBackupRestore } from './composables/useBackupRestore'
import { useClearDatabase } from './composables/useClearDatabase'
import { useTesseractStatus } from './composables/useTesseractStatus'
import { useScreenshotsDir } from './composables/useScreenshotsDir'
import { useFeatureToggle } from './composables/useFeatureToggle'
import { useEventStream } from './composables/useEventStream'
import { useTheme } from './composables/useTheme'
import { useWeekStart } from './composables/useWeekStart'
import { useFilterPanel } from './composables/useFilterPanel'
import { useMatchFilters } from './composables/useMatchFilters'
import { useMatchGrouping } from './composables/useMatchGrouping'
import { useFilterPresets, type FilterPresetSnapshot } from './composables/useFilterPresets'
import type { ParseProgressEvent } from './components/ParseProgressPanel.vue'
import ParseStatusBar from './components/ParseStatusBar.vue'

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

// OnboardingTour is mounted eagerly (not lazy) because it auto-opens
// on first launch and the localStorage gate runs inside its
// onMounted — fetching a separate chunk would briefly show the
// landing view first, then pop the briefing overlay in late. Cost:
// ~3KB to the initial bundle, comfortably under the budget.
import OnboardingTour from './components/OnboardingTour.vue'

// GitHub repository URL — surfaced via the brandmark in the masthead.
// Centralised here so the markup, hover title, and any future references
// stay in sync. Routed through OpenURL so Wails-mode clicks open in the
// user's system browser instead of the embedded WebView.
const GITHUB_REPO_URL = 'https://github.com/sound-barrier/recall'

const records = ref<MatchRecord[]>([])
const error = ref('')
const loading = ref(false)

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
const view = ref('matches')

// goToView switches the active tab AND moves focus into the newly visible
// panel so keyboard users land in the new content rather than staying on
// the nav button. Each <section> has tabindex="-1" so it can receive
// programmatic focus without entering the natural tab order.
async function goToView(next: string) {
  view.value = next
  await nextTick()
  const panel = document.getElementById(`panel-${next}`)
  if (panel) panel.focus({ preventScroll: true })
}

const { onTabKeydown, focusMain } = useTabKeyboardNav(view, goToView)

// ── Keyboard-shortcut state ───────────────────────────────────
// `focusedCardIndex` is the flat index (across the filteredSorted
// list) of the card the j/k/e/t bindings target. -1 = no card
// focused; the MatchCard wrapper's roving tabindex reads this and
// flips between 0 / -1. `openCheatsheet` toggles the `?` modal.
const focusedCardIndex = ref(-1)
const openCheatsheet = ref(false)

// Programmatically focus the card at the given index in the
// filteredSorted list. Used by the j/k handlers below; we
// queryselector by data-card-index because the card lives several
// levels deep inside MatchGroupSection's recursive render and
// template refs would be awkward.
async function focusCardByIndex(idx: number) {
  focusedCardIndex.value = idx
  await nextTick()
  const el = document.querySelector<HTMLElement>(
    `article.match[data-card-index="${idx}"]`,
  )
  el?.focus({ preventScroll: false })
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'auto' })
}

// Wall-clock time of the last successful manual parse, used to render
// "Last run · X ago" feedback under the Parse button on the settings
// page. Persisted to localStorage so the timestamp survives reloads.
const lastParsedAt = ref<number | null>(null)
const appVersion = ref('')
const updateInfo = ref<UpdateInfo | null>(null)

// Tesseract status (path / found / version / supported flag) + the
// "Browse for binary…" + "Reset to default" pickers + the System Alert
// CTA that deep-links into Settings → Engine.
const {
  tesseractStatus,
  tesseractReady,
  tesseractSupported,
  tesseractPickerBusy,
  setTesseractStatus,
  pickTesseractBinary,
  resetTesseractPath,
  gotoEngineSettings,
} = useTesseractStatus({
  pickTesseractBinary: PickTesseractBinary,
  resetTesseractPath: ResetTesseractPath,
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
} = useScreenshotsDir({
  pickScreenshotsDir: PickScreenshotsDir,
  probeScreenshotsDir: ProbeScreenshotsDir,
  setScreenshotsDir: SetScreenshotsDir,
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
const filterPanel = useFilterPanel()
// "Include undated matches" toggle. Default off — records without
// data.date are hidden from the matched view until the user opts in
// via the FilterRail toggle. Persisted in localStorage so the choice
// survives across launches.
const { includeUndated, setIncludeUndated } = useIncludeUndated()
const {
  minPlayPercent, minPlayMinutes,
  setMinPlayPercent, setMinPlayMinutes,
} = useMinPlayThreshold()
const { densityMode, toggleDensityMode } = useDensityMode()
const { leaverHandling, setLeaverHandling } = useLeaverHandling()
// "Show hidden matches" toggle. Default off — soft-deleted matches
// stay out of view until the user opts in to see them.
const { showHidden, setShowHidden } = useShowHidden()
const filters = useMatchFilters(
  records,
  includeUndated,
  minPlayPercent, minPlayMinutes,
  setMinPlayPercent, setMinPlayMinutes,
  leaverHandling,
  showHidden,
)
const { activeFilterCount } = filters
// First-day-of-week preference (Settings → Calendar). Threaded into
// useMatchGrouping so the "Week of <date>" labels honor the user's
// choice across page loads.
const { weekStart, setWeekStart } = useWeekStart()
// Tallies skip annotated leaver matches when the user picks
// 'exclude-tally' (or 'hide' — those records are already gone from
// filteredSorted but excluding them belt-and-suspenders).
const skipAnnotatedInTally = computed(
  () => leaverHandling.value === 'exclude-tally' || leaverHandling.value === 'hide',
)
const grouping = useMatchGrouping<MatchRecord>(
  filters.filteredSorted, filters.sortDir, weekStart, skipAnnotatedInTally,
)

// Filter-preset storage. The composable persists in localStorage; this
// shell owns the snapshot collect + apply because the underlying state
// is owned here (filter refs from useMatchFilters, plus the
// persisted-preference composables for thresholds / undated / leaver /
// hidden). Threaded through MatchesView → FilterRail → FilterPresetsMenu.
const { presets: filterPresets, savePreset, getPreset, deletePreset } = useFilterPresets()

function buildFilterPresetSnapshot(): FilterPresetSnapshot {
  return {
    filters: {
      mode:   [...filters.filterMode.value],
      type:   [...filters.filterType.value],
      role:   [...filters.filterRole.value],
      map:    [...filters.filterMap.value],
      hero:   [...filters.filterHero.value],
      result: [...filters.filterResult.value],
      sshot:  [...filters.filterSshot.value],
      tags:   [...filters.filterTags.value],
    },
    noteSearch:     filters.noteSearch.value,
    filterFrom:     filters.filterFrom.value,
    filterTo:       filters.filterTo.value,
    sortDir:        filters.sortDir.value === 'asc' ? 'asc' : 'desc',
    minPlayPercent: minPlayPercent.value,
    minPlayMinutes: minPlayMinutes.value,
    includeUndated: includeUndated.value,
    leaverHandling: leaverHandling.value,
    showHidden:     showHidden.value,
  }
}

function applyFilterPresetSnapshot(s: FilterPresetSnapshot) {
  filters.filterMode.value   = [...s.filters.mode]
  filters.filterType.value   = [...s.filters.type]
  filters.filterRole.value   = [...s.filters.role]
  filters.filterMap.value    = [...s.filters.map]
  filters.filterHero.value   = [...s.filters.hero]
  filters.filterResult.value = [...s.filters.result]
  filters.filterSshot.value  = [...s.filters.sshot]
  filters.filterTags.value   = [...s.filters.tags]
  filters.noteSearch.value   = s.noteSearch
  filters.filterFrom.value   = s.filterFrom
  filters.filterTo.value     = s.filterTo
  filters.sortDir.value      = s.sortDir
  // Threshold setters write to localStorage; assigning the raw refs
  // would leave the persisted preference out of sync.
  setMinPlayPercent(s.minPlayPercent)
  setMinPlayMinutes(s.minPlayMinutes)
  setIncludeUndated(s.includeUndated)
  setLeaverHandling(s.leaverHandling)
  setShowHidden(s.showHidden)
}

function onSavePreset(name: string) {
  savePreset(name, buildFilterPresetSnapshot())
}

function onApplyPreset(name: string) {
  const p = getPreset(name)
  if (!p) return
  applyFilterPresetSnapshot(p.snapshot)
}

function onDeletePreset(name: string) {
  deletePreset(name)
}

// Per-card expand/collapse state. Object keyed by match_key; truthy =
// expanded. Plain object (not a Set) so Vue's reactivity sees each
// toggle naturally without needing to reassign the whole container.
const expanded = ref<Record<string, boolean>>({})

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
    records.value = recs.value ?? []
    if (before > 0 && records.value.length > before) flashRecordsPulse()
  } else {
    error.value = `Could not load matches: ${String(recs.reason)}`
  }
  if (dir.status === 'fulfilled')      setScreenshotsDir(dir.value || '')
  if (promOn.status === 'fulfilled')   setPrometheusEnabled(!!promOn.value)
  if (watchOn.status === 'fulfilled')  setWatchEnabled(!!watchOn.value)
  if (tess.status === 'fulfilled')     setTesseractStatus(tess.value)
  else                                 setTesseractStatus({ path: '', found: false, version: '', supported: false, error: String(tess.reason), default: '' })
  newScreenshotCount.value = newCount.status === 'fulfilled' ? newCount.value : null
  dataLocation.value      = loc.status === 'fulfilled' ? loc.value : null
}

async function refreshNewCount() {
  try { newScreenshotCount.value = await GetNewScreenshotCount() } catch (_) {}
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

// User-curated per-match leaver annotation. Pass-through to
// SetLeaverAnnotation / ClearLeaverAnnotation; reload records on
// success so the new annotation propagates to the rendered list.
// Errors bubble to the global error banner so the user knows the
// click didn't take.
async function onSetLeaverAnnotation(matchKey: string, leaver: '' | 'self' | 'team' | 'enemy') {
  try {
    if (leaver === '') {
      await ClearLeaverAnnotation(matchKey)
    } else {
      await SetLeaverAnnotation(matchKey, leaver as LeaverKind)
    }
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

// Bounds for the date pickers.
const earliestMatchDateTime = computed(() => computeEarliestMatchDateTime(records.value))

// Local-time "now" formatted as YYYY-MM-DDTHH:MM for the input's max
// attribute. Recomputed on every render — Vue treats this as a getter
// without a reactive dep, but in practice the user reopens the dropdown
// often enough that minute-level staleness isn't visible.
const nowDateTime = computed(() => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
})

// Card collapse/expand.
async function toggleExpand(id: string) {
  const wasExpanded = !!expanded.value[id]
  // Reassign the object so Vue sees a new reference. Mutating in place
  // works for plain objects with Vue 3 deep reactivity, but being
  // explicit avoids surprises if `expanded` later becomes a shallowRef.
  expanded.value = { ...expanded.value, [id]: !wasExpanded }
  // On expand, keep the card header in view — long expansions otherwise
  // push the header off-screen and the user loses their place. nearest
  // block alignment avoids scrolling if the header is already visible.
  if (!wasExpanded) {
    await nextTick()
    const el = document.getElementById(`match-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}
function isExpanded(id: string) {
  return !!expanded.value[id]
}
// Bulk toggle: if any visible card is expanded, collapse all; otherwise
// expand all. Operates over the currently-filtered set so it doesn't
// affect rows the user can't see.
function toggleAll() {
  const visible = filters.filteredSorted.value
  const anyOpen = visible.some(r => isExpanded(r.match_key))
  const next = { ...expanded.value }
  for (const r of visible) next[r.match_key] = !anyOpen
  expanded.value = next
}
const allExpanded = computed(() =>
  filters.filteredSorted.value.length > 0 && filters.filteredSorted.value.every(r => isExpanded(r.match_key))
)

// W-L-D summary that reflects the *currently filtered* set so the user
// can see, for instance, "support role on Aatlis: 6W 2L 0D" by setting
// the matching filters. Using `filteredSorted` (not raw `records`) keeps
// this synced with the visible cards below.
const wld = computed(() => tallyWLD(filters.filteredSorted.value))

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

// Bundle the per-card UI state into one object so MatchesView /
// UnknownMapsView can consume it as a single prop — keeps their
// signatures readable and lets them share the SAME expand / preview
// state without forking.
const cardState = {
  isExpanded, isSourcesOpen, previewOpen, previewError, allExpanded,
  toggleAll, toggleExpand, toggleSources, togglePreview, onPreviewError,
}

// ── Keyboard shortcuts — full registry ─────────────────────────
// Wired here (after filters + toggleExpand + goToView are all in
// scope) rather than alongside the focusedCardIndex ref above so
// every handler can capture stable references. The dispatcher
// installs ONE capture-phase document listener; per-binding `when`
// predicates gate view-specific shortcuts. See UI_RECOMMENDATIONS.md
// item 4 for the design + FEATURES.md for the cheatsheet contract.
useKeyboardShortcuts([
  // Global: focus the FilterRail's note-search input. Input-gated:
  // only fires OUTSIDE inputs (so typing `/` in a search field
  // doesn't recursively re-focus).
  {
    key: '/',
    handler: () => {
      const el = document.getElementById('note-search')
      if (el instanceof HTMLInputElement) el.focus()
    },
  },
  // Global: open the cheatsheet. allowInInput so the user can hit
  // `?` from anywhere — including while typing in a search box.
  {
    key: '?',
    allowInInput: true,
    handler: () => { openCheatsheet.value = true },
  },
  // Global: vim-style view navigation (`g` then m/i/s/u).
  ...(['m', 'i', 's', 'u'] as const).map((follow): Shortcut => {
    const target: TabId = (
      follow === 'm' ? 'matches' :
      follow === 'i' ? 'ingest'  :
      follow === 's' ? 'settings' : 'unknown'
    )
    return {
      key: follow,
      prefix: 'g',
      handler: () => { void goToView(target) },
    }
  }),
  // Matches view: j/k move card focus, no wrap.
  {
    key: 'j',
    when: () => view.value === 'matches',
    handler: () => {
      const len = filters.filteredSorted.value.length
      if (len === 0) return
      const next = Math.min(focusedCardIndex.value + 1, len - 1)
      if (next === focusedCardIndex.value && focusedCardIndex.value !== -1) return
      void focusCardByIndex(Math.max(0, next))
    },
  },
  {
    key: 'k',
    when: () => view.value === 'matches',
    handler: () => {
      const len = filters.filteredSorted.value.length
      if (len === 0) return
      // First k from "no card focused" lands on card 0; otherwise
      // step back, clamped at 0.
      const next = focusedCardIndex.value === -1 ? 0 : Math.max(0, focusedCardIndex.value - 1)
      void focusCardByIndex(next)
    },
  },
  // Matches view: expand/collapse the focused card.
  {
    key: 'e',
    when: () => view.value === 'matches' && focusedCardIndex.value >= 0,
    handler: () => {
      const rec = filters.filteredSorted.value[focusedCardIndex.value]
      if (!rec) return
      void toggleExpand(rec.match_key)
    },
  },
  // Matches view: auto-expand the focused card AND focus its tags
  // input. Tags input has id="tags-<match_key>" per
  // MatchCardExpanded.vue.
  {
    key: 't',
    when: () => view.value === 'matches' && focusedCardIndex.value >= 0,
    handler: async () => {
      const rec = filters.filteredSorted.value[focusedCardIndex.value]
      if (!rec) return
      if (!expanded.value[rec.match_key]) await toggleExpand(rec.match_key)
      await nextTick()
      const input = document.getElementById(`tags-${rec.match_key}`)
      if (input instanceof HTMLInputElement) input.focus()
    },
  },
])

// Keep TAB_ORDER referenced so a future tab addition can lint-check
// the g-prefix coverage above. (Each entry in TAB_ORDER must have a
// matching g+x handler.)
void TAB_ORDER

// Records that couldn't be resolved to a named match — either the
// screenshot filename had no parseable OW timestamp ("unmatched:…")
// or OCR failed to determine a map name. These surface in the
// Unknown Maps view for triage.
const unknownRecords = computed(() =>
  records.value.filter(r => !r.data?.map)
)


// Pure helpers (detectScreenshotSlots, screenshotURL, etc.) live in
// ./match-helpers.ts so they can be unit-tested in isolation.

// fmtTime is imported from ./match-helpers.js (extracted for testing).

// Subscribe to the watcher's parse-complete event so the records list
// auto-refreshes when an auto-parse runs in the background. Without
// this the user would have to click Parse manually to see new matches
// land in the UI even though the data is already in SQLite.

const { themeMode, toggleTheme } = useTheme()

onMounted(() => {
  // Restore last-parse timestamp so the Settings page shows the right
  // "Last run · …" hint immediately on launch, not just after a fresh
  // parse in the current session.
  try {
    const v = localStorage.getItem('recall.lastParsedAt')
    if (v) lastParsedAt.value = Number(v) || null
  } catch (_) {}

  GetVersion().then(v => { appVersion.value = v }).catch(() => {})
  CheckForUpdate().then(u => { if (u.checked) updateInfo.value = u }).catch(() => {})
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

    <div class="container" :inert="showUnsupportedModal || undefined" :aria-hidden="showUnsupportedModal ? 'true' : undefined">
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
          </nav>
        </div>
        <div class="masthead-right">
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
          <div class="ver-block">
            <span v-if="appVersion" class="app-version">v{{ appVersion }}</span>
            <button
              v-if="updateInfo?.dev_build"
              class="ver-btn ver-btn-dev"
              :title="`Open release page for v${updateInfo.latest}`"
              @click="OpenURL(updateInfo.url)"
            >
              ↗ view release v{{ updateInfo.latest }}
            </button>
            <button
              v-else-if="updateInfo?.available"
              class="ver-btn ver-btn-update"
              :title="`Download v${updateInfo.latest}`"
              @click="OpenURL(updateInfo.url)"
            >
              ↑ update to v{{ updateInfo.latest }}
            </button>
            <span
              v-else-if="updateInfo?.checked"
              class="ver-btn ver-btn-current"
            >✓ up to date</span>
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
          @toggle-theme="toggleTheme"
          @set-week-start="setWeekStart"
          @go-to-view="goToView"
          @pick-tesseract="pickTesseractBinary"
          @reset-tesseract="resetTesseractPath"
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
          :card-state="cardState"
          @go-to-view="goToView"
        />

        <!-- ─── MATCHES VIEW (default) ───────────────────────────── -->
        <MatchesView
          v-if="view === 'matches'"
          :records="records"
          :loading="loading"
          :filters="filters"
          :filter-panel="filterPanel"
          :grouping="grouping"
          :card-state="cardState"
          :earliest-match-date-time="earliestMatchDateTime"
          :now-date-time="nowDateTime"
          :include-undated="includeUndated"
          :min-play-percent="minPlayPercent"
          :min-play-minutes="minPlayMinutes"
          :density-mode="densityMode"
          :leaver-handling="leaverHandling"
          :show-hidden="showHidden"
          :focused-card-index="focusedCardIndex"
          :filter-presets="filterPresets"
          @go-to-view="goToView"
          @card-focus="(i: number) => focusedCardIndex = i"
          @set-include-undated="setIncludeUndated"
          @set-min-play-percent="setMinPlayPercent"
          @set-min-play-minutes="setMinPlayMinutes"
          @toggle-density="toggleDensityMode"
          @set-leaver-handling="setLeaverHandling"
          @set-leaver-annotation="onSetLeaverAnnotation"
          @set-match-annotation="onSetMatchAnnotation"
          @set-show-hidden="setShowHidden"
          @set-match-hidden="onSetMatchHidden"
          @save-preset="onSavePreset"
          @apply-preset="onApplyPreset"
          @delete-preset="onDeletePreset"
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
      @go-to-view="goToView"
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
      @close="openCheatsheet = false"
    />

    <!-- First-launch briefing overlay. Self-gates via
         localStorage; renders nothing once dismissed. Navigation
         events drive the underlying tab via goToView so the visible
         view follows along with each step. -->
    <OnboardingTour @navigate="goToView" />
  </div>
</template>

