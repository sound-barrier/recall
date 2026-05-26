<script setup lang="ts">
// App-wide styles — extracted from this SFC to keep App.vue navigable
// (~890 lines of template + script vs. ~4 600 lines when the 3 698-line
// <style> block was inline). Imported here rather than via main.ts so
// the dependency lives next to the component that anchors the cascade.
// Still globally scoped (matches the historical behaviour); component-
// specific selectors are tracked for a follow-up extraction into
// per-SFC scoped <style> blocks (TECHNICAL_DEBT.md #1).
import './styles/app.css'

import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch, defineAsyncComponent } from 'vue'
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
  EventsOn,
  EventsOff,
} from './api'
import type { LeaverKind, MatchAnnotationInput } from './api'
import { computeEarliestMatchDateTime, tallyWLD } from './match-helpers'
import { useIncludeUndated } from './composables/useIncludeUndated'
import { useMinPlayThreshold } from './composables/useMinPlayThreshold'
import { useDensityMode } from './composables/useDensityMode'
import { useLeaverHandling } from './composables/useLeaverHandling'
import { useTheme } from './composables/useTheme'
import { useWeekStart } from './composables/useWeekStart'
import { useFilterPanel } from './composables/useFilterPanel'
import { useMatchFilters } from './composables/useMatchFilters'
import { useMatchGrouping } from './composables/useMatchGrouping'
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

// Skip-link target. The native href="#main-content" works in most
// browsers, but some don't move focus to the target on hash navigation —
// only scroll. Explicitly focus the <main> for keyboard parity.
function focusMain(e: MouseEvent) {
  e.preventDefault()
  const main = document.getElementById('main-content')
  if (main) main.focus({ preventScroll: false })
}

// WAI-ARIA tab-pattern keyboard navigation. Left/Right cycle through
// the tabs (with wrap-around); Home/End jump to ends. We use
// "automatic activation" — focusing a tab also switches the view, the
// same as a click. The four tabs are listed in nav order; goToView
// handles the actual view swap + panel focus.
const TAB_ORDER = ['settings', 'ingest', 'matches', 'unknown'] as const

function onTabKeydown(e: KeyboardEvent) {
  const key = e.key
  if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
  e.preventDefault()
  const current = TAB_ORDER.indexOf(view.value as typeof TAB_ORDER[number])
  if (current === -1) return
  let next = current
  if (key === 'ArrowLeft')  next = (current - 1 + TAB_ORDER.length) % TAB_ORDER.length
  if (key === 'ArrowRight') next = (current + 1) % TAB_ORDER.length
  if (key === 'Home')       next = 0
  if (key === 'End')        next = TAB_ORDER.length - 1
  const target = TAB_ORDER[next]!
  goToView(target)
  // Move focus from the now-inactive tab to the newly-active one so the
  // tab pattern's "automatic activation" matches the focus ring.
  nextTick(() => {
    const btn = document.getElementById(`tab-${target}`)
    btn?.focus()
  })
}

// Wall-clock time of the last successful manual parse, used to render
// "Last run · X ago" feedback under the Parse button on the settings
// page. Persisted to localStorage so the timestamp survives reloads.
const lastParsedAt = ref<number | null>(null)
const appVersion = ref('')
const updateInfo = ref<UpdateInfo | null>(null)

// Tesseract status — mirrors the Go side's TesseractStatus struct.
// When .found is false, a System Alert banner blocks the main views
// and Parse/Watch controls disable themselves. Refreshed on mount and
// after every path-changing call.
const tesseractStatus = ref({ path: '', found: false, version: '', supported: false, error: '', default: '' })
const tesseractReady = computed(() => !!tesseractStatus.value?.found)
// True when Tesseract is found AND is a supported major version (5.x).
const tesseractSupported = computed(() => tesseractReady.value && !!tesseractStatus.value?.supported)

// Confirmation modal for parsing with an unsupported Tesseract version.
const showUnsupportedModal = ref(false)
const tesseractPickerBusy = ref(false)

// ─── Modal focus management ──────────────────────────────────────────
// WAI-ARIA dialog pattern: when the modal opens we capture the element
// that had focus (so we can restore it on close), move focus into the
// modal, trap Tab/Shift+Tab inside it, and treat Escape as a cancel.
// Without this, keyboard users tab straight back into the obscured
// background and screen readers don't have a stable focus anchor.
const lastFocusedBeforeModal = ref<HTMLElement | null>(null)

function modalFocusable(): HTMLElement[] {
  const box = document.querySelector<HTMLElement>('.modal-box')
  if (!box) return []
  const sel = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  return Array.from(box.querySelectorAll<HTMLElement>(sel))
}

function onModalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    showUnsupportedModal.value = false
    return
  }
  if (e.key !== 'Tab') return
  const focusable = modalFocusable()
  if (focusable.length === 0) return
  const first = focusable[0]!
  const last  = focusable[focusable.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey && active === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(showUnsupportedModal, async (isOpen) => {
  if (isOpen) {
    // Capture the trigger so we can return focus to it on close.
    lastFocusedBeforeModal.value = (document.activeElement instanceof HTMLElement)
      ? document.activeElement
      : null
    await nextTick()
    // Initial focus goes to the *first* focusable, which by markup
    // order is Cancel — never put initial focus on a destructive
    // primary action (Continue Anyway).
    modalFocusable()[0]?.focus()
    document.addEventListener('keydown', onModalKeydown)
  } else {
    document.removeEventListener('keydown', onModalKeydown)
    const prev = lastFocusedBeforeModal.value
    lastFocusedBeforeModal.value = null
    // Defer focus restore one tick so the modal's DOM is gone first;
    // restoring before the focused element is removed can be a no-op
    // in some browsers.
    await nextTick()
    prev?.focus()
  }
})

// Directory the parser reads from. Persisted in data/settings.json on
// the Go side; we mirror the value here so the UI can render it next
// to the Parse button.
const screenshotsDir = ref('')

// Platform-resolved data paths — surfaced read-only in Settings →
// Directories so the user can see where the DB lives. Null until the
// first load() completes.
const dataLocation = ref<DataLocation | null>(null)

// Prometheus endpoint enable/disable. The Go side actually binds
// the port (or doesn't); this ref is just a UI mirror, written via
// SetPrometheusEnabled so the change persists.
const prometheusEnabled = ref(false)

// Directory watch toggle. When on, the Go side watches the
// screenshots directory; new files trigger a debounced auto-parse
// (1 minute after the last new file).
const watchEnabled = ref(false)

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
const filters = useMatchFilters(
  records,
  includeUndated,
  minPlayPercent, minPlayMinutes,
  setMinPlayPercent, setMinPlayMinutes,
  leaverHandling,
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

// Per-card expand/collapse state. Object keyed by match_key; truthy =
// expanded. Plain object (not a Set) so Vue's reactivity sees each
// toggle naturally without needing to reassign the whole container.
const expanded = ref<Record<string, boolean>>({})

async function load() {
  const before = records.value.length
  const [recs, dir, promOn, watchOn, tess, newCount, loc] = await Promise.all([
    GetMatchResults(),
    GetScreenshotsDir(),
    GetPrometheusEnabled(),
    GetWatchEnabled(),
    GetTesseractStatus(),
    GetNewScreenshotCount().catch(() => null),
    GetDataLocation().catch(() => null),
  ])
  records.value = recs ?? []
  dataLocation.value = loc
  // If the record count grew, briefly pulse the scoreboard so the user
  // notices the auto-refresh — otherwise watcher-driven loads are
  // entirely silent and records "just appear". Skip on the very first
  // load (before === 0) since that's startup, not a refresh.
  if (before > 0 && records.value.length > before) {
    flashRecordsPulse()
  }
  screenshotsDir.value = dir || ''
  prometheusEnabled.value = !!promOn
  watchEnabled.value = !!watchOn
  tesseractStatus.value = tess || { path: '', found: false, error: 'No status returned.' }
  newScreenshotCount.value = newCount
}

async function refreshNewCount() {
  try { newScreenshotCount.value = await GetNewScreenshotCount() } catch (_) {}
}

// Pick a Tesseract binary via the native file dialog. The Go side
// handles persistence + re-validation; we only need to mirror the new
// status into the UI.
async function pickTesseractBinary() {
  if (tesseractPickerBusy.value) return
  tesseractPickerBusy.value = true
  try {
    const next = await PickTesseractBinary()
    if (next) tesseractStatus.value = next
  } catch (e) {
    error.value = String(e)
  } finally {
    tesseractPickerBusy.value = false
  }
}

// Reset to the platform default location (resolved server-side).
async function resetTesseractPath() {
  try {
    const next = await ResetTesseractPath()
    if (next) tesseractStatus.value = next
  } catch (e) {
    error.value = String(e)
  }
}

// Jump to Settings and scroll the Engine section into view. Wired
// from the System Alert banner's "Fix in Settings →" CTA.
async function gotoEngineSettings() {
  view.value = 'settings'
  await nextTick()
  const el = document.getElementById('sec-engine')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Toggle directory watching. Same pattern as Prometheus: Go owns the
// actual side effect (fsnotify watcher start/stop), this just mirrors
// state and rolls back on error. Enabling is gated on Tesseract being
// available — turning Watch on with a broken OCR setup would just
// queue silent failures.
async function toggleWatch() {
  const next = !watchEnabled.value
  if (next && !tesseractReady.value) {
    error.value = 'Configure Tesseract in Settings → Engine before enabling Watch.'
    return
  }
  try {
    await SetWatchEnabled(next)
    watchEnabled.value = next
  } catch (err) {
    error.value = String(err)
  }
}

// Toggle the Prometheus endpoint. We call the Go method first so the
// persisted setting drives both the actual server lifecycle and the UI
// state; if the call fails, fall back to the previous local value.
async function togglePrometheus() {
  const next = !prometheusEnabled.value
  try {
    await SetPrometheusEnabled(next)
    prometheusEnabled.value = next
  } catch (err) {
    error.value = String(err)
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

// Clear all parse records from the database. Two-step: first click
// arms clearConfirm (shows the destructive confirm UI); second click
// executes. cancelClear resets without deleting.
const clearingDB  = ref(false)
const clearConfirm = ref(false)

async function clearDatabase() {
  clearingDB.value = true
  clearConfirm.value = false
  try {
    await ClearDatabase()
    await load()
    lastParsedAt.value = null
    try { localStorage.removeItem('recall.lastParsedAt') } catch (_) {}
  } catch (e) {
    error.value = String(e)
  } finally {
    clearingDB.value = false
  }
}

function armClear() {
  clearConfirm.value = true
}

function cancelClear() {
  clearConfirm.value = false
}

// Export the parsed database as a JSON file. In Wails mode the native
// save dialog handles writing; in server mode the api shim triggers a
// browser download. The exportStatus ref drives the inline result chip
// in IngestView (e.g. "Saved to: /path/...json") that flashes for a
// few seconds after success.
// `exporting` is a string discriminator ('json'|'csv') so IngestView
// can show "Saving…" on the specific button the user clicked while
// the other one stays selectable. `false` = idle.
const exporting   = ref<false | 'json' | 'csv'>(false)
const importing   = ref(false)
const importArmed = ref(false) // first-click confirm (mirrors clearConfirm)
const exportStatus = ref<{ ok: boolean; message: string } | null>(null)

async function exportData(format: 'json' | 'csv' = 'json') {
  if (exporting.value) return
  exporting.value = format
  exportStatus.value = null
  try {
    const path = format === 'csv' ? await ExportDataCSV() : await ExportData()
    if (path) {
      exportStatus.value = { ok: true, message: `Saved: ${path}` }
    }
    // cancel → silent
  } catch (e) {
    exportStatus.value = { ok: false, message: `Export failed: ${e}` }
  } finally {
    exporting.value = false
    // Auto-clear the chip after a few seconds so it doesn't linger
    // forever on a navigation-less tab.
    if (exportStatus.value) {
      const captured = exportStatus.value
      setTimeout(() => {
        if (exportStatus.value === captured) exportStatus.value = null
      }, 5000)
    }
  }
}

function exportDataCSV() { return exportData('csv') }

function armImport() { importArmed.value = true; exportStatus.value = null }
function cancelImport() { importArmed.value = false }

async function importData() {
  if (importing.value) return
  importing.value = true
  importArmed.value = false
  try {
    const path = await ImportData()
    if (path) {
      exportStatus.value = { ok: true, message: `Imported: ${path}` }
      await load() // refresh records + everything else
    }
  } catch (e) {
    exportStatus.value = { ok: false, message: `Import failed: ${e}` }
  } finally {
    importing.value = false
    if (exportStatus.value) {
      const captured = exportStatus.value
      setTimeout(() => {
        if (exportStatus.value === captured) exportStatus.value = null
      }, 5000)
    }
  }
}

// Open the native folder picker via Wails. The Go side persists the
// choice so subsequent app launches pick up the same directory; we
// just need to refresh our local mirror.
//
// Guard: if Watch is currently armed, confirm before re-targeting the
// watcher to a new folder. The watcher otherwise silently switches and
// (if the new folder is empty or invalid) keeps running against nothing
// with no feedback to the user.
async function pickDir() {
  if (watchEnabled.value) {
    const ok = window.confirm(
      'Watch Folder is currently armed.\n\n' +
      'Switching the screenshots folder will re-target the watcher to the new directory. ' +
      'Continue?',
    )
    if (!ok) return
  }
  try {
    const dir = await PickScreenshotsDir()
    if (dir) screenshotsDir.value = dir
    await refreshNewCount()
  } catch (e) {
    error.value = String(e)
  }
}

// "Detect Overwatch Folder" — runs the backend probe + persists the
// first hit when one exists. Probe state is mirrored into SettingsView
// via props so the button's in-flight + result chip is purely
// reactive. `probeStatus` is split from `probeMessage` so the styling
// (accent vs muted) doesn't depend on string parsing.
const probing      = ref(false)
const probeMessage = ref('')
const probeStatus  = ref<'' | 'success' | 'blocked'>('')
const probeTried   = ref<string[]>([])

async function detectDir() {
  probing.value = true
  probeMessage.value = ''
  probeStatus.value = ''
  probeTried.value = []
  try {
    const res = await ProbeScreenshotsDir()
    probeTried.value = res.tried || []
    if (res.found && res.path) {
      await SetScreenshotsDir(res.path)
      screenshotsDir.value = res.path
      probeStatus.value = 'success'
      probeMessage.value = `Detected · ${res.path}`
      await refreshNewCount()
    } else {
      probeStatus.value = 'blocked'
      probeMessage.value = 'No default Overwatch folder on this machine. Use Change Folder… to point at it.'
    }
  } catch (e) {
    probeStatus.value = 'blocked'
    probeMessage.value = `Detect failed: ${String(e)}`
  } finally {
    probing.value = false
  }
}

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
  EventsOn('parse-complete', () => { load(); lastParsedAt.value = Date.now(); try { localStorage.setItem('recall.lastParsedAt', String(lastParsedAt.value)) } catch (_) {} })
  EventsOn('parse-progress', (data: ParseProgressEvent) => {
    if (!data) return
    parseProgress.value = data
    parseLog.value = [...parseLog.value, data].slice(-50)
  })
  // Live-stream individual MatchRecords as each screenshot's insert
  // resolves a match_key. Upsert by match_key into the same records
  // ref the static load() populates — every downstream filter, group,
  // and card-render computed recomputes for free. The post-batch
  // parse-complete handler still calls load() as the authoritative
  // reconciliation in case any of these events were dropped on a slow
  // SSE connection.
  EventsOn<MatchRecord>('match-updated', (rec) => {
    if (!rec || !rec.match_key) return
    const i = records.value.findIndex(r => r.match_key === rec.match_key)
    if (i >= 0) {
      records.value = [
        ...records.value.slice(0, i),
        rec,
        ...records.value.slice(i + 1),
      ]
    } else {
      records.value = [...records.value, rec]
    }
  })

})
onBeforeUnmount(() => {
  EventsOff('parse-complete')
  EventsOff('parse-progress')
  EventsOff('match-updated')
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
          @go-to-view="goToView"
          @set-include-undated="setIncludeUndated"
          @set-min-play-percent="setMinPlayPercent"
          @set-min-play-minutes="setMinPlayMinutes"
          @toggle-density="toggleDensityMode"
          @set-leaver-handling="setLeaverHandling"
          @set-leaver-annotation="onSetLeaverAnnotation"
          @set-match-annotation="onSetMatchAnnotation"
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
  </div>
</template>

