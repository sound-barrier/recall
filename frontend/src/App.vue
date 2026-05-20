<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type { MatchRecord } from './api'
import {
  GetVersion,
  CheckForUpdate,
  OpenURL,
  type UpdateInfo,
  ParseScreenshots,
  GetMatchResults,
  GetScreenshotsDir,
  PickScreenshotsDir,
  GetPrometheusEnabled,
  SetPrometheusEnabled,
  GetWatchEnabled,
  SetWatchEnabled,
  GetTesseractStatus,
  PickTesseractBinary,
  ResetTesseractPath,
  ClearDatabase,
  GetNewScreenshotCount,
  EventsOn,
  EventsOff,
} from './api'
import {
  sshotTypeLabel,
  sourceType,
  detectScreenshotSlots,
  missingRequiredSlots,
  missingOptionalSlots,
  heroesForHeader,
  fmtTime,
  formatRelativeTime,
  screenshotURL,
  computeEarliestMatchDateTime,
} from './match-helpers'
import { useTheme } from './composables/useTheme'
import { useFilterPanel } from './composables/useFilterPanel'
import { useMatchFilters } from './composables/useMatchFilters'

interface ParseProgressEvent {
  done: number
  total: number
  filename: string
  screenshot_type?: string
  data?: MatchRecord['data']
}

const records = ref<MatchRecord[]>([])
const error = ref('')
const loading = ref(false)

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

// Directory the parser reads from. Persisted in data/settings.json on
// the Go side; we mirror the value here so the UI can render it next
// to the Parse button.
const screenshotsDir = ref('')

// Prometheus endpoint enable/disable. The Go side actually binds
// the port (or doesn't); this ref is just a UI mirror, written via
// SetPrometheusEnabled so the change persists.
const prometheusEnabled = ref(false)

// Directory watch toggle. When on, the Go side watches the
// screenshots directory; new files trigger a debounced auto-parse
// (1 minute after the last new file).
const watchEnabled = ref(false)

const { openFilter, filterSearch, toggleFilterPanel, closeFilterPanel } = useFilterPanel()

const {
  filterFrom, filterTo, sortDir,
  filterList,
  modes, types, roles, maps, results, sshotTypes, heroes,
  filteredSorted,
  anyFilter, activeFilterCount, undatedMatchCount,
  toggleFilter, isActive, selectAllFilter, clearFilterField,
  clearFilters: clearFilterState,
  resetDateRange, toggleSort,
} = useMatchFilters(records)

// Per-card expand/collapse state. Object keyed by record id; truthy =
// expanded. Plain object (not a Set) so Vue's reactivity sees each
// toggle naturally without needing to reassign the whole container.
const expanded = ref<Record<number, boolean>>({})

function filterSearchStr(field: string): string { return filterSearch.value[field] ?? '' }

async function load() {
  const [recs, dir, promOn, watchOn, tess, newCount] = await Promise.all([
    GetMatchResults(),
    GetScreenshotsDir(),
    GetPrometheusEnabled(),
    GetWatchEnabled(),
    GetTesseractStatus(),
    GetNewScreenshotCount().catch(() => null),
  ])
  records.value = recs ?? []
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

// Jump to the Ingest view and scroll the Engine section into view.
// Wired from the System Alert banner's "Fix in Ingest →" CTA and
// from the empty-state shortcut. (Engine config lives in Ingest, not
// Settings — Settings is reserved for screenshot folder + theme.)
async function gotoEngineSettings() {
  view.value = 'ingest'
  await nextTick()
  const el = document.getElementById('sec-engine')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Toggle directory watching. Same pattern as Prometheus: Go owns the
// actual side effect (fsnotify watcher start/stop), this just mirrors
// state and rolls back on error. Enabling is gated on Tesseract being
// available — turning Watch on with a broken OCR setup would just
// queue silent failures.
async function toggleWatch(e: Event) {
  const el = e.target as HTMLInputElement
  const next = el.checked
  if (next && !tesseractReady.value) {
    el.checked = false
    error.value = 'Configure Tesseract in Ingest → Engine before enabling Watch.'
    return
  }
  try {
    await SetWatchEnabled(next)
    watchEnabled.value = next
  } catch (err) {
    error.value = String(err)
    el.checked = watchEnabled.value
  }
}

// Toggle the Prometheus endpoint. We call the Go method first so the
// persisted setting drives both the actual server lifecycle and the UI
// state; if the call fails, fall back to the previous local value.
async function togglePrometheus(e: Event) {
  const el = e.target as HTMLInputElement
  const next = el.checked
  try {
    await SetPrometheusEnabled(next)
    prometheusEnabled.value = next
  } catch (err) {
    error.value = String(err)
    el.checked = prometheusEnabled.value
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
    error.value = 'Tesseract is not configured. Fix it in Ingest → Engine.'
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

// clearFilters resets all filter state AND closes any open popover.
function clearFilters() { clearFilterState(); closeFilterPanel() }

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
async function toggleExpand(id: number) {
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
function isExpanded(id: number) {
  return !!expanded.value[id]
}
// Bulk toggle: if any visible card is expanded, collapse all; otherwise
// expand all. Operates over the currently-filtered set so it doesn't
// affect rows the user can't see.
function toggleAll() {
  const visible = filteredSorted.value
  const anyOpen = visible.some(r => isExpanded(r.id))
  const next = { ...expanded.value }
  for (const r of visible) next[r.id] = !anyOpen
  expanded.value = next
}
const allExpanded = computed(() =>
  filteredSorted.value.length > 0 && filteredSorted.value.every(r => isExpanded(r.id))
)

// W-L-D summary that reflects the *currently filtered* set so the user
// can see, for instance, "support role on Aatlis: 6W 2L 0D" by setting
// the matching filters. Using `filteredSorted` (not raw `records`) keeps
// this synced with the visible cards below.
const wld = computed(() => {
  const c: Record<string, number> = { victory: 0, defeat: 0, draw: 0 }
  for (const r of filteredSorted.value) {
    const k = r.data?.result
    if (k && k in c) c[k] = (c[k] ?? 0) + 1
  }
  return c
})

// Per-card "source screenshots" sub-panel expansion. Independent of the
// main card expand state — most users don't care which screenshots fed
// a row, so we keep this folded by default even when the card itself
// is open.
const sourcesExpanded = ref<Record<number, boolean>>({})
function toggleSources(id: number) {
  sourcesExpanded.value = { ...sourcesExpanded.value, [id]: !sourcesExpanded.value[id] }
}
function isSourcesOpen(id: number) {
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
function isPreviewOpen(filename: string) {
  return !!previewOpen.value[filename]
}
function isPreviewError(filename: string) {
  return !!previewError.value[filename]
}
function onPreviewError(filename: string) {
  previewError.value = { ...previewError.value, [filename]: true }
}

// Records that couldn't be resolved to a named match — either the
// screenshot filename had no parseable OW timestamp ("unmatched:…")
// or OCR failed to determine a map name. These surface in the
// Unknown Maps view for triage.
const unknownRecords = computed(() =>
  records.value.filter(r => !r.data?.map)
)

// Per-card expand state for the Unknown Maps view. Separate from
// the main `expanded` store so collapsing all matches doesn't also
// reset the unknown cards the user is reviewing.
const unknownExpanded = ref<Record<number, boolean>>({})
function toggleUnknownExpand(id: number) {
  unknownExpanded.value = { ...unknownExpanded.value, [id]: !unknownExpanded.value[id] }
}
function isUnknownExpanded(id: number) {
  return !!unknownExpanded.value[id]
}

const unknownPreviewOpen = ref<Record<string, boolean>>({})
const unknownPreviewError = ref<Record<string, boolean>>({})
function toggleUnknownPreview(filename: string) {
  unknownPreviewError.value = { ...unknownPreviewError.value, [filename]: false }
  unknownPreviewOpen.value = { ...unknownPreviewOpen.value, [filename]: !unknownPreviewOpen.value[filename] }
}
function isUnknownPreviewOpen(filename: string) {
  return !!unknownPreviewOpen.value[filename]
}
function isUnknownPreviewError(filename: string) {
  return !!unknownPreviewError.value[filename]
}
function onUnknownPreviewError(filename: string) {
  unknownPreviewError.value = { ...unknownPreviewError.value, [filename]: true }
}

// Pure helpers (detectScreenshotSlots, missingRequiredSlots,
// missingOptionalSlots, heroesForHeader) live in ./match-helpers.js
// so they can be unit-tested in isolation. Imported at the top of
// this file.

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

})
onBeforeUnmount(() => {
  EventsOff('parse-complete')
  EventsOff('parse-progress')
})
</script>

<template>
  <div class="app">
    <div class="atmos" aria-hidden="true" />
    <div class="grid-lines" aria-hidden="true" />

    <div class="container">
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
            {{ tesseractStatus.error || 'Recall cannot OCR screenshots without Tesseract. Install it, or point Recall at the existing binary in Ingest → Engine.' }}
          </p>
        </div>
        <div class="system-alert-actions">
          <button class="btn alert-cta" @click="gotoEngineSettings">
            <span class="alert-cta-arrow" aria-hidden="true">→</span>
            Fix in Ingest → Engine
          </button>
        </div>
      </div>

      <header class="masthead">
        <div class="masthead-left">
          <div class="brandmark-tile">
            <span class="brand-tick">↺</span>
            <h1 class="brand">
              RE<span class="brand-accent">CALL</span>
            </h1>
            <span class="brand-corner" aria-hidden="true" />
          </div>
          <p class="tagline">
            Personal Telemetry · Match Almanac
          </p>
          <!-- Workflow order: configure → ingest → view → triage. Matches
               stays the default landing tab even though it sits at position
               03 — the numbering communicates the intended user flow. -->
          <nav class="page-nav" role="tablist" aria-label="Primary">
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
              <span class="nav-tab-label">Ingest</span>
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
            title="Wins · Losses · Draws across the currently filtered matches"
          >
            <div class="score-cell">
              <span class="score-num win">{{ wld.victory }}</span>
              <span class="score-label">Won</span>
            </div>
            <div class="score-cell">
              <span class="score-num loss">{{ wld.defeat }}</span>
              <span class="score-label">Lost</span>
            </div>
            <div class="score-cell">
              <span class="score-num draw">{{ wld.draw }}</span>
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
            >↗ view release v{{ updateInfo.latest }}</button>
            <button
              v-else-if="updateInfo?.available"
              class="ver-btn ver-btn-update"
              :title="`Download v${updateInfo.latest}`"
              @click="OpenURL(updateInfo.url)"
            >↑ update to v{{ updateInfo.latest }}</button>
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

      <!-- ─── SETTINGS VIEW (folder + theme — minimal config) ──── -->
      <section v-if="view === 'settings'" id="panel-settings" key="settings" role="tabpanel" aria-labelledby="tab-settings" tabindex="-1" class="settings">
        <header class="settings-intro">
          <p class="settings-eyebrow">
            System Configuration
          </p>
          <h2 v-if="!screenshotsDir" class="settings-heading">
            Choose a <em>screenshots folder</em> to begin.
          </h2>
          <h2 v-else class="settings-heading">
            Where Recall reads from, and how it looks.
          </h2>
          <p class="settings-sub">
            OCR engine, parsing, exports, and data management live in
            <strong class="empty-link" @click="view = 'ingest'">Ingest →</strong>.
          </p>
        </header>

        <div id="sec-directories" class="settings-section">
          <div class="section-header">
            <span class="section-num">01</span>
            <span class="section-slash" aria-hidden="true">/</span>
            <h3 class="section-title">
              Directories
            </h3>
          </div>
          <div class="setting-rows">
            <div class="setting-row">
              <div class="setting-info">
                <h4 class="setting-label">
                  Screenshots Folder
                </h4>
                <p class="setting-desc">
                  Where Recall watches for new Overwatch screenshots. Click <strong>Change Folder</strong> to point it at a different directory.
                </p>
              </div>
              <div class="setting-control">
                <span class="setting-value mono" :title="screenshotsDir">{{ screenshotsDir || '— Not selected —' }}</span>
                <button class="btn ghost" :disabled="loading" @click="pickDir">
                  Change Folder…
                </button>
              </div>
            </div>
          </div>
        </div>

        <div id="sec-appearance" class="settings-section">
          <div class="section-header">
            <span class="section-num">02</span>
            <span class="section-slash" aria-hidden="true">/</span>
            <h3 class="section-title">
              Appearance
            </h3>
          </div>
          <div class="setting-rows">
            <div class="setting-row">
              <div class="setting-info">
                <h4 class="setting-label">
                  Theme
                </h4>
                <p class="setting-desc">
                  Switch between Day and Night palettes. Preference is remembered across launches.
                </p>
              </div>
              <div class="setting-control">
                <button
                  class="theme-toggle"
                  :title="themeMode === 'dark' ? 'Switch to Day' : 'Switch to Night'"
                  :aria-label="themeMode === 'dark' ? 'Switch to Day' : 'Switch to Night'"
                  @click="toggleTheme"
                >
                  <span class="theme-seg" :class="{ active: themeMode === 'light' }">
                    <svg viewBox="0 0 24 24" class="theme-icon" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" fill="currentColor" />
                      <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                        <line x1="12" y1="2" x2="12" y2="5" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                        <line x1="2" y1="12" x2="5" y2="12" />
                        <line x1="19" y1="12" x2="22" y2="12" />
                        <line x1="4.6" y1="4.6" x2="6.7" y2="6.7" />
                        <line x1="17.3" y1="17.3" x2="19.4" y2="19.4" />
                        <line x1="4.6" y1="19.4" x2="6.7" y2="17.3" />
                        <line x1="17.3" y1="6.7" x2="19.4" y2="4.6" />
                      </g>
                    </svg>
                    <span class="theme-label">Day</span>
                  </span>
                  <span class="theme-divider" aria-hidden="true" />
                  <span class="theme-seg" :class="{ active: themeMode === 'dark' }">
                    <svg viewBox="0 0 24 24" class="theme-icon" aria-hidden="true">
                      <path d="M21 12.8A8.5 8.5 0 0 1 11.2 3a7 7 0 1 0 9.8 9.8z" fill="currentColor" />
                    </svg>
                    <span class="theme-label">Night</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ─── INGEST VIEW (engine → parse → export → data) ─────── -->
      <section v-if="view === 'ingest'" id="panel-ingest" key="ingest" role="tabpanel" aria-labelledby="tab-ingest" tabindex="-1" class="settings ingest-view">
        <header class="settings-intro">
          <p class="settings-eyebrow">
            Parse Pipeline
          </p>
          <h2 v-if="!tesseractReady" class="settings-heading missing">
            Recall can't OCR until <em>Tesseract is located</em>.
          </h2>
          <h2 v-else-if="!screenshotsDir" class="settings-heading">
            Set a <em>screenshots folder</em> in
            <strong class="empty-link" @click="view = 'settings'">Settings →</strong> first.
          </h2>
          <h2 v-else-if="watchEnabled" class="settings-heading">
            Watching <em>{{ screenshotsDir }}/</em> for new screenshots.
          </h2>
          <h2 v-else-if="records.length" class="settings-heading">
            <em>{{ records.length }} {{ records.length === 1 ? 'match' : 'matches' }}</em> parsed from <em>{{ screenshotsDir }}/</em>
          </h2>
          <h2 v-else class="settings-heading">
            Ready to parse from <em>{{ screenshotsDir }}/</em> — click <em>Run Parse</em> below.
          </h2>
        </header>

        <div id="sec-engine" class="settings-section">
          <div class="section-header">
            <span class="section-num">01</span>
            <span class="section-slash" aria-hidden="true">/</span>
            <h3 class="section-title">
              Engine
            </h3>
          </div>
          <div class="setting-rows">
            <div class="setting-row engine-row" :class="{ alert: !tesseractReady }">
              <div class="setting-info">
                <h4 class="setting-label">
                  Tesseract Binary
                </h4>
                <p class="setting-desc">
                  Recall shells out to Tesseract to read text from your Overwatch screenshots. On macOS the Homebrew install lives under <code>/opt/homebrew/bin</code> (Apple Silicon) or <code>/usr/local/bin</code> (Intel); apt installs to <code>/usr/bin</code>; Windows installers put it in <code>Program Files\Tesseract-OCR</code>.
                </p>
                <div class="engine-status" :class="{ ok: tesseractReady, fail: !tesseractReady }">
                  <span class="engine-dot" aria-hidden="true" />
                  <span class="engine-state">{{ tesseractReady ? 'Detected' : 'Not Found' }}</span>
                  <span v-if="tesseractReady && tesseractStatus.version" class="engine-version">v{{ tesseractStatus.version }}</span>
                  <span class="engine-path mono" :title="tesseractStatus.path || ''">{{ tesseractStatus.path || '—' }}</span>
                </div>
                <p v-if="!tesseractReady && tesseractStatus.error" class="engine-error">
                  {{ tesseractStatus.error }}
                </p>
                <div v-if="tesseractReady && !tesseractSupported" class="engine-unsupported-warn" role="alert">
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" class="warn-icon">
                    <path d="M12 2.6 L22.4 20.5 L1.6 20.5 Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                    <line x1="12" y1="10" x2="12" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                    <circle cx="12" cy="17.5" r="1.2" fill="currentColor" />
                  </svg>
                  <span>
                    Tesseract {{ tesseractStatus.version }} is not officially supported. Only version 5.x is tested with Recall.
                    Proceed at your own caution — results may be incorrect.
                  </span>
                </div>
                <p
                  v-if="tesseractStatus.default && tesseractStatus.default !== tesseractStatus.path"
                  class="engine-meta"
                >
                  Default for this platform · <code>{{ tesseractStatus.default }}</code>
                  · <button class="link-btn" @click="resetTesseractPath">
                    Use default
                  </button>
                </p>
              </div>
              <div class="setting-control engine-control">
                <button
                  class="btn"
                  :class="tesseractReady ? 'ghost' : 'primary'"
                  :disabled="tesseractPickerBusy"
                  @click="pickTesseractBinary"
                >
                  <span v-if="tesseractPickerBusy">Locating…</span>
                  <span v-else>{{ tesseractReady ? 'Change Binary…' : 'Locate Tesseract…' }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div id="sec-ingest" class="settings-section">
          <div class="section-header">
            <span class="section-num">02</span>
            <span class="section-slash" aria-hidden="true">/</span>
            <h3 class="section-title">
              Parse
            </h3>
          </div>
          <div class="setting-rows">
            <div class="setting-row">
              <div class="setting-info">
                <h4 class="setting-label">
                  Watch Folder
                </h4>
                <p class="setting-desc">
                  Auto-parse new screenshots as they appear. Recall waits 60 seconds after the last new file, so a 3–4-screenshot post-match session collapses into a single parse.
                </p>
                <p v-if="!tesseractReady" class="setting-meta blocked">
                  <span class="block-mark" aria-hidden="true">⛔</span>
                  Blocked — needs Tesseract.
                </p>
              </div>
              <div class="setting-control">
                <label class="big-switch" :class="{ on: watchEnabled, disabled: !tesseractReady }">
                  <input
                    type="checkbox"
                    :checked="watchEnabled"
                    :disabled="!tesseractReady"
                    @change="toggleWatch"
                  >
                  <span class="big-switch-track"><span class="big-switch-knob" /></span>
                  <span class="big-switch-state">{{ watchEnabled ? 'Armed' : 'Off' }}</span>
                </label>
              </div>
            </div>

            <div class="setting-row">
              <div class="setting-info">
                <h4 class="setting-label">
                  Manual Parse
                </h4>
                <p class="setting-desc">
                  Scan the folder now, outside the watcher cycle. Idempotent — re-running won't duplicate matches you've already parsed.
                </p>
                <p v-if="!tesseractReady" class="setting-meta" :class="{ blocked: true }">
                  <span class="block-mark" aria-hidden="true">⛔</span>
                  Blocked — needs Tesseract.
                </p>
                <p v-else-if="newScreenshotCount === 0 && !loading" class="setting-meta blocked">
                  <span class="block-mark" aria-hidden="true">◎</span>
                  All screenshots already parsed — nothing new in the folder.
                </p>
                <p v-else-if="lastParsedAt && !loading" class="setting-meta">
                  <span class="meta-dot" />
                  Last run · {{ formatRelativeTime(lastParsedAt) }} · {{ records.length + unknownRecords.length }} record{{ (records.length + unknownRecords.length) === 1 ? '' : 's' }} on record
                </p>
              </div>
              <div class="setting-control">
                <button
                  class="btn primary big"
                  :disabled="loading || !tesseractReady || newScreenshotCount === 0"
                  :title="!tesseractReady ? 'Locate Tesseract in section 01 / Engine first.' : newScreenshotCount === 0 ? 'All screenshots in the folder have already been parsed.' : ''"
                  @click="parse"
                >
                  <span class="btn-dot" />
                  <span v-if="loading">Parsing…</span>
                  <span v-else-if="(newScreenshotCount ?? 0) > 0">Run Parse · {{ newScreenshotCount }}</span>
                  <span v-else>Run Parse</span>
                </button>
              </div>
            </div>

            <!-- Parse progress panel — visible while loading -->
            <div v-if="loading" class="parse-progress-panel" :class="{ 'pp-open': parseProgressOpen }">
              <!-- Summary row: always visible. Click to expand/collapse details. -->
              <div class="pp-summary" @click="parseProgressOpen = !parseProgressOpen">
                <div class="pp-scan-label">
                  <span class="pp-scan-dot" aria-hidden="true" />
                  <span class="pp-scan-text">Parsing</span>
                </div>
                <div class="pp-bar-track">
                  <div
                    class="pp-bar-fill"
                    :style="parseProgress && parseProgress.total
                      ? { width: `${(parseProgress.done / parseProgress.total) * 100}%` }
                      : { width: '0%' }"
                  />
                </div>
                <div class="pp-fraction mono">
                  <span class="pp-done">{{ parseProgress?.done ?? 0 }}</span>
                  <span class="pp-sep">&nbsp;/&nbsp;</span>
                  <span class="pp-total">{{ parseProgress?.total ?? '…' }}</span>
                </div>
                <span class="chev pp-chev" :class="{ open: parseProgressOpen }" aria-hidden="true">›</span>
              </div>

              <!-- Expanded details: current file + rolling log -->
              <template v-if="parseProgressOpen">
                <!-- Current file being processed -->
                <div v-if="parseProgress" class="pp-current">
                  <span class="pp-arrow" aria-hidden="true">▶</span>
                  <span class="pp-cur-filename mono">{{ parseProgress.filename }}</span>
                  <span
                    class="pp-type-badge"
                    :class="parseProgress.screenshot_type"
                  >{{ parseProgress.screenshot_type?.toUpperCase() }}</span>
                  <div class="pp-cur-fields">
                    <template v-if="parseProgress.screenshot_type === 'summary'">
                      <span v-if="parseProgress.data?.map" class="pp-field">
                        <span class="pp-fl">map</span><span class="pp-fv">{{ parseProgress.data.map }}</span>
                      </span>
                      <span v-if="parseProgress.data?.result" class="pp-field" :class="parseProgress.data.result">
                        <span class="pp-fl">result</span><span class="pp-fv">{{ parseProgress.data.result }}</span>
                      </span>
                      <span v-if="parseProgress.data?.date" class="pp-field">
                        <span class="pp-fl">date</span><span class="pp-fv">{{ parseProgress.data.date }}</span>
                      </span>
                      <span v-if="parseProgress.data?.game_length" class="pp-field">
                        <span class="pp-fl">length</span><span class="pp-fv">{{ parseProgress.data.game_length }}</span>
                      </span>
                    </template>
                    <template v-else-if="parseProgress.screenshot_type === 'scoreboard'">
                      <span class="pp-field">
                        <span class="pp-fl">elims</span><span class="pp-fv">{{ parseProgress.data?.eliminations ?? '—' }}</span>
                      </span>
                      <span class="pp-field">
                        <span class="pp-fl">assists</span><span class="pp-fv">{{ parseProgress.data?.assists ?? '—' }}</span>
                      </span>
                      <span class="pp-field">
                        <span class="pp-fl">deaths</span><span class="pp-fv">{{ parseProgress.data?.deaths ?? '—' }}</span>
                      </span>
                      <span v-if="parseProgress.data?.damage" class="pp-field">
                        <span class="pp-fl">dmg</span><span class="pp-fv">{{ parseProgress.data.damage.toLocaleString() }}</span>
                      </span>
                      <span v-if="parseProgress.data?.mitigation" class="pp-field">
                        <span class="pp-fl">mit</span><span class="pp-fv">{{ parseProgress.data.mitigation.toLocaleString() }}</span>
                      </span>
                    </template>
                    <template v-else-if="parseProgress.screenshot_type === 'personal'">
                      <span v-if="parseProgress.data?.hero" class="pp-field">
                        <span class="pp-fl">hero</span><span class="pp-fv">{{ parseProgress.data.hero }}</span>
                      </span>
                      <span v-if="parseProgress.data?.heroes_played?.length" class="pp-field">
                        <span class="pp-fl">played</span>
                        <span class="pp-fv">{{ parseProgress.data.heroes_played.map(h => h.hero).join(' · ') }}</span>
                      </span>
                    </template>
                    <template v-else-if="parseProgress.screenshot_type === 'rank'">
                      <span v-if="parseProgress.data?.rank" class="pp-field">
                        <span class="pp-fl">rank</span>
                        <span class="pp-fv">{{ parseProgress.data.rank }} {{ parseProgress.data.level }}</span>
                      </span>
                      <span v-if="parseProgress.data?.sr?.length" class="pp-field">
                        <span class="pp-fl">SR</span>
                        <span class="pp-fv">{{ parseProgress.data.sr.map(s => `${s.hero} ${s.sr}`).join(' · ') }}</span>
                      </span>
                    </template>
                  </div>
                </div>

                <!-- Rolling log of completed files -->
                <div v-if="parseLog.length > 1" class="pp-log">
                  <div
                    v-for="entry in [...parseLog].slice(0, -1).reverse()"
                    :key="entry.done + entry.filename"
                    class="pp-log-entry"
                  >
                    <span class="pp-log-check" aria-hidden="true">✓</span>
                    <span class="pp-log-filename mono">{{ entry.filename }}</span>
                    <span class="pp-log-type" :class="entry.screenshot_type">{{ entry.screenshot_type }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>

        <div id="sec-export" class="settings-section">
          <div class="section-header">
            <span class="section-num">03</span>
            <span class="section-slash" aria-hidden="true">/</span>
            <h3 class="section-title">
              Export
            </h3>
          </div>
          <div class="setting-rows">
            <div class="setting-row">
              <div class="setting-info">
                <h4 class="setting-label">
                  Stream to Grafana
                </h4>
                <p class="setting-desc">
                  Expose match history on <code>localhost:9091/metrics</code> so the bundled Prometheus container can scrape it. Off by default — no port is opened until you enable this.
                </p>
              </div>
              <div class="setting-control">
                <label class="big-switch" :class="{ on: prometheusEnabled }">
                  <input type="checkbox" :checked="prometheusEnabled" @change="togglePrometheus">
                  <span class="big-switch-track"><span class="big-switch-knob" /></span>
                  <span class="big-switch-state">{{ prometheusEnabled ? 'Live' : 'Off' }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <div id="sec-data" class="settings-section">
          <div class="section-header">
            <span class="section-num">04</span>
            <span class="section-slash" aria-hidden="true">/</span>
            <h3 class="section-title">
              Data
            </h3>
          </div>
          <div class="setting-rows">
            <div class="setting-row" :class="{ 'danger-row': clearConfirm }">
              <div class="setting-info">
                <h4 class="setting-label">
                  Clear Parse Database
                </h4>
                <p class="setting-desc">
                  Permanently delete all {{ records.length + unknownRecords.length }} parsed match record{{ (records.length + unknownRecords.length) === 1 ? '' : 's' }} from the local database. Settings and screenshots are untouched — you can re-parse at any time to rebuild from scratch.
                </p>
                <p v-if="clearConfirm" class="setting-meta blocked">
                  <span class="block-mark" aria-hidden="true">⚠</span>
                  This cannot be undone.
                </p>
              </div>
              <div class="setting-control">
                <template v-if="!clearConfirm">
                  <button
                    class="btn danger-outline"
                    :disabled="clearingDB || (records.length + unknownRecords.length) === 0"
                    @click="armClear"
                  >
                    Clear Database…
                  </button>
                </template>
                <template v-else>
                  <div class="clear-confirm-group">
                    <button
                      class="btn danger"
                      :disabled="clearingDB"
                      @click="clearDatabase"
                    >
                      <span v-if="clearingDB">Deleting…</span>
                      <span v-else>Delete {{ records.length + unknownRecords.length }} Record{{ (records.length + unknownRecords.length) === 1 ? '' : 's' }}</span>
                    </button>
                    <button class="btn ghost" :disabled="clearingDB" @click="cancelClear">
                      Cancel
                    </button>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ─── UNKNOWN MAPS VIEW ────────────────────────────────── -->
      <section v-if="view === 'unknown'" id="panel-unknown" key="unknown" role="tabpanel" aria-labelledby="tab-unknown" tabindex="-1" class="settings unknown-view">
        <header class="settings-intro">
          <p class="settings-eyebrow">
            Diagnostic Review
          </p>
          <h2 v-if="unknownRecords.length === 0" class="settings-heading">
            All screenshots resolved.
          </h2>
          <h2 v-else class="settings-heading unknown-heading">
            <em>{{ unknownRecords.length }} record{{ unknownRecords.length === 1 ? '' : 's' }}</em>
            couldn't be matched to a map.
          </h2>
          <p v-if="unknownRecords.length > 0" class="unknown-desc">
            The slot indicators below show which screenshot types have been parsed for each record. Add the missing ones and
            <strong class="empty-link" @click="view = 'ingest'">run Parse</strong>
            again to resolve them.
          </p>
        </header>

        <div v-if="unknownRecords.length === 0" class="empty">
          <div class="empty-mark">
            ◉
          </div>
          <p class="empty-title">
            No unresolved records.
          </p>
          <p class="empty-sub">
            Every parsed match has a map name — you're clean.
          </p>
        </div>

        <div v-else class="unknown-list">
          <article
            v-for="(rec, idx) in unknownRecords"
            :key="rec.id"
            class="unknown-card"
            :class="{ expanded: isUnknownExpanded(rec.id) }"
          >
            <!-- Card header: index + match key + slot chips + chevron -->
            <div class="unknown-card-head" @click="toggleUnknownExpand(rec.id)">
              <div class="unknown-head-lhs">
                <span class="unknown-idx">{{ String(idx + 1).padStart(2, '0') }}</span>
                <div class="unknown-key-block">
                  <span class="unknown-key mono">{{ rec.match_key }}</span>
                  <span class="unknown-src-count">{{ rec.source_files?.length || 0 }} screenshot{{ (rec.source_files?.length || 0) === 1 ? '' : 's' }}</span>
                </div>
              </div>
              <div class="unknown-head-rhs">
                <div class="slot-row" @click.stop>
                  <span
                    v-for="slot in detectScreenshotSlots(rec)"
                    :key="slot.key"
                    class="slot-chip"
                    :class="{ present: slot.present, absent: !slot.present }"
                    :title="slot.hint"
                  >
                    <span class="slot-dot" aria-hidden="true" />
                    {{ slot.label }}
                  </span>
                </div>
                <span class="chev" :class="{ open: isUnknownExpanded(rec.id) }" aria-hidden="true">›</span>
              </div>
            </div>

            <!-- Field diagnostic strip — always visible -->
            <div class="unknown-fields">
              <div
                v-for="fd in [
                  { label: 'Map', value: rec.data?.map },
                  { label: 'Mode', value: rec.data?.mode },
                  { label: 'Type', value: rec.data?.type },
                  { label: 'Result', value: rec.data?.result },
                  { label: 'Date', value: rec.data?.date },
                  { label: 'Time', value: rec.data?.finished_at },
                  { label: 'Length', value: rec.data?.game_length },
                  { label: 'E/A/D', value: rec.data?.eliminations != null ? `${rec.data.eliminations} / ${rec.data.assists} / ${rec.data.deaths}` : null },
                ]"
                :key="fd.label"
                class="field-cell"
                :class="{ filled: !!fd.value, vacant: !fd.value }"
              >
                <span class="field-label">{{ fd.label }}</span>
                <span class="field-value">{{ fd.value || '—' }}</span>
              </div>
            </div>

            <!-- Expanded: source files + previews + any stats that parsed -->
            <template v-if="isUnknownExpanded(rec.id)">
              <div class="unknown-expanded">
                <div v-if="rec.source_files?.length" class="unknown-sources">
                  <div class="block-eyebrow">
                    Source Files
                  </div>
                  <div v-for="f in rec.source_files" :key="f" class="source-file">
                    <a
                      class="source-name"
                      :href="screenshotURL(f)"
                      :title="isUnknownPreviewOpen(f) ? 'Hide preview' : 'Show preview'"
                      @click.prevent="toggleUnknownPreview(f)"
                    >
                      <span class="chev small" :class="{ open: isUnknownPreviewOpen(f) }">›</span>
                      <span class="source-name-text">{{ f }}</span>
                    </a>
                    <img
                      v-if="isUnknownPreviewOpen(f) && !isUnknownPreviewError(f)"
                      :src="screenshotURL(f)"
                      :alt="f"
                      class="source-preview"
                      @error="onUnknownPreviewError(f)"
                    >
                    <div v-if="isUnknownPreviewOpen(f) && isUnknownPreviewError(f)" class="source-preview-error">
                      Could not load image — check screenshots folder in Settings.
                    </div>
                  </div>
                </div>

                <div v-if="rec.data?.eliminations != null || rec.data?.damage != null" class="unknown-stats">
                  <div class="block-eyebrow">
                    Parsed Stats
                  </div>
                  <div class="stats">
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.eliminations ?? '—' }}</span>
                      <span class="stat-label">Elims</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.assists ?? '—' }}</span>
                      <span class="stat-label">Assists</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.deaths ?? '—' }}</span>
                      <span class="stat-label">Deaths</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.damage != null ? rec.data.damage.toLocaleString() : '—' }}</span>
                      <span class="stat-label">Damage</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.healing != null ? rec.data.healing.toLocaleString() : '—' }}</span>
                      <span class="stat-label">Healing</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.mitigation != null ? rec.data.mitigation.toLocaleString() : '—' }}</span>
                      <span class="stat-label">Mitigation</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </article>
        </div>
      </section>

      <!-- ─── MATCHES VIEW (default) ───────────────────────────── -->
      <div v-if="view === 'matches'" id="panel-matches" key="matches" role="tabpanel" aria-labelledby="tab-matches" tabindex="-1" class="matches-view">
        <div v-if="records.length === 0 && !loading" class="empty">
          <div class="empty-mark">
            ◌
          </div>
          <p class="empty-title">
            No matches on record.
          </p>
          <p class="empty-sub">
            First-time setup runs left-to-right across the nav tabs:
          </p>
          <ol class="empty-steps">
            <li>
              <strong class="empty-step-num">01</strong>
              <span>Set your screenshots folder under <strong class="empty-link" @click="goToView('settings')">Settings</strong>.</span>
            </li>
            <li>
              <strong class="empty-step-num">02</strong>
              <span>Locate Tesseract and click <strong class="empty-link" @click="goToView('ingest')">Ingest → Run Parse</strong>, or flip on <strong class="empty-link" @click="goToView('ingest')">Watch Folder</strong> to auto-ingest as you play.</span>
            </li>
            <li>
              <strong class="empty-step-num">03</strong>
              <span>Your matches appear here.</span>
            </li>
          </ol>
        </div>

        <section v-if="records.length > 0" class="filter-rail">
          <div class="filter-grid">
            <div
              v-for="cfg in [
                { field: 'mode', label: 'Mode', options: modes, short: 'MODES' },
                { field: 'map', label: 'Map', options: maps, short: 'MAPS' },
                { field: 'type', label: 'Type', options: types, short: 'TYPES' },
                { field: 'role', label: 'Role', options: roles, short: 'ROLES' },
                { field: 'hero', label: 'Hero', options: heroes, short: 'HEROES' },
                { field: 'result', label: 'Result', options: results, short: 'RESULTS' },
                { field: 'sshot', label: 'Source', options: sshotTypes, short: 'SOURCES', formatOption: sshotTypeLabel },
              ]"
              :key="cfg.field"
              class="filter-field multi-filter"
              :class="{ open: openFilter === cfg.field, populated: filterList(cfg.field).length > 0 }"
            >
              <span class="filter-eyebrow">
                {{ cfg.label }}
                <span v-if="filterList(cfg.field).length" class="eyebrow-count">× {{ String(filterList(cfg.field).length).padStart(2, '0') }}</span>
              </span>

              <button
                type="button"
                class="mf-trigger"
                :aria-expanded="openFilter === cfg.field"
                :aria-label="`${cfg.label} filter, ${filterList(cfg.field).length} of ${cfg.options.length} selected`"
                @click="toggleFilterPanel(cfg.field)"
              >
                <span class="mf-trigger-inner">
                  <template v-if="filterList(cfg.field).length === 0">
                    <span class="mf-placeholder">All</span>
                    <span class="mf-placeholder-meta">{{ cfg.options.length }} {{ cfg.short.toLowerCase() }}</span>
                  </template>
                  <template v-else-if="filterList(cfg.field).length <= 2">
                    <span
                      v-for="val in filterList(cfg.field)"
                      :key="val"
                      class="mf-chip"
                      :title="`Remove ${val} from filter`"
                      @click.stop="toggleFilter(cfg.field, val)"
                    >
                      <span class="mf-chip-text">{{ cfg.formatOption ? cfg.formatOption(val) : val }}</span>
                      <span class="mf-chip-x" aria-hidden="true">×</span>
                    </span>
                  </template>
                  <template v-else>
                    <span class="mf-chip mf-chip-stack">
                      <span class="mf-chip-text">{{ cfg.formatOption ? cfg.formatOption(filterList(cfg.field)[0]) : filterList(cfg.field)[0] }}</span>
                      <span class="mf-chip-x" aria-hidden="true" />
                    </span>
                    <span class="mf-more">+{{ filterList(cfg.field).length - 1 }}</span>
                  </template>
                </span>
                <span class="mf-caret" aria-hidden="true" />
              </button>

              <div v-if="openFilter === cfg.field" class="mf-panel" @click.stop>
                <div class="mf-panel-head">
                  <span class="mf-panel-title">{{ cfg.short }} ROSTER</span>
                  <span class="mf-panel-meta">{{ filterList(cfg.field).length }} / {{ cfg.options.length }}</span>
                </div>
                <p class="mf-panel-hint">
                  Picking multiple matches <em>any</em> of them.
                </p>
                <div v-if="cfg.options.length >= 8" class="mf-search">
                  <span class="mf-search-icon" aria-hidden="true">⌕</span>
                  <input
                    v-model="filterSearch[cfg.field]"
                    type="text"
                    class="mf-search-input"
                    :placeholder="`Search ${cfg.label.toLowerCase()}…`"
                    autocomplete="off"
                  >
                </div>
                <div class="mf-list" role="listbox" aria-multiselectable="true">
                  <template v-for="opt in cfg.options" :key="opt">
                    <label
                      v-if="!filterSearchStr(cfg.field) || (cfg.formatOption ? cfg.formatOption(opt) : opt).toLowerCase().includes(filterSearchStr(cfg.field).toLowerCase())"
                      class="mf-row"
                      :class="{ checked: filterList(cfg.field).includes(opt) }"
                    >
                      <input
                        type="checkbox"
                        :checked="filterList(cfg.field).includes(opt)"
                        class="mf-row-box"
                        @change="toggleFilter(cfg.field, opt)"
                      >
                      <span class="mf-row-mark" aria-hidden="true" />
                      <span class="mf-row-label">{{ cfg.formatOption ? cfg.formatOption(opt) : opt }}</span>
                    </label>
                  </template>
                  <div
                    v-if="cfg.options.length === 0"
                    class="mf-empty"
                  >
                    No {{ cfg.label.toLowerCase() }} values yet — parse some matches to populate this filter.
                  </div>
                  <div
                    v-else-if="filterSearchStr(cfg.field) && cfg.options.filter(o => o.toLowerCase().includes(filterSearchStr(cfg.field).toLowerCase())).length === 0"
                    class="mf-empty"
                  >
                    No {{ cfg.label.toLowerCase() }} matches "{{ filterSearchStr(cfg.field) }}"
                  </div>
                </div>
                <div class="mf-panel-foot">
                  <button
                    type="button"
                    class="mf-foot-btn"
                    :disabled="filterList(cfg.field).length === cfg.options.length"
                    @click="selectAllFilter(cfg.field, cfg.options)"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class="mf-foot-btn"
                    :disabled="filterList(cfg.field).length === 0"
                    @click="clearFilterField(cfg.field)"
                  >
                    None
                  </button>
                  <span class="mf-foot-spacer" />
                  <button type="button" class="mf-foot-btn primary" @click="closeFilterPanel">
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="filter-bar">
            <div class="range-group">
              <label class="range-label">
                <span>From</span>
                <input
                  v-model="filterFrom"
                  type="datetime-local"
                  :min="earliestMatchDateTime"
                  :max="nowDateTime"
                  class="dd-date"
                >
              </label>
              <span class="range-dash">→</span>
              <label class="range-label">
                <span>To</span>
                <input
                  v-model="filterTo"
                  type="datetime-local"
                  :min="earliestMatchDateTime"
                  :max="nowDateTime"
                  class="dd-date"
                >
              </label>
              <button
                class="btn ghost tiny"
                :disabled="!filterFrom && !filterTo"
                title="Clear both date pickers"
                @click="resetDateRange"
              >
                Reset
              </button>
              <span
                v-if="(filterFrom || filterTo) && undatedMatchCount > 0"
                class="range-hint"
                :title="`${undatedMatchCount} match${undatedMatchCount === 1 ? ' is' : 'es are'} missing date/time (no SUMMARY screenshot) and won't appear while a date filter is active.`"
              >
                ⓘ {{ undatedMatchCount }} undated hidden
              </span>
            </div>

            <div class="filter-tools">
              <button class="btn ghost tiny" :title="sortDir === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'" @click="toggleSort">
                {{ sortDir === 'desc' ? '↓ Newest' : '↑ Oldest' }}
              </button>
              <button class="btn ghost tiny" :title="allExpanded ? 'Collapse every visible card' : 'Expand every visible card'" @click="toggleAll">
                {{ allExpanded ? 'Collapse All' : 'Expand All' }}
              </button>
              <button v-if="anyFilter" class="btn ghost tiny danger" @click="clearFilters">
                Clear Filters
              </button>
              <span class="count"><strong>{{ filteredSorted.length }}</strong><span class="count-of">of {{ records.length }}</span></span>
            </div>
          </div>
        </section>

        <div v-if="records.length > 0" class="match-list">
          <article
            v-for="(rec, idx) in filteredSorted"
            :id="`match-${rec.id}`"
            :key="rec.id"
            class="match"
            :class="[
              { expanded: isExpanded(rec.id) },
              `result-${rec.data.result || 'unknown'}`,
            ]"
            :style="{ animationDelay: Math.min(idx, 12) * 28 + 'ms' }"
          >
            <span class="match-bar" aria-hidden="true" />
            <div class="match-body">
              <div
                class="match-header"
                role="button"
                tabindex="0"
                :aria-expanded="isExpanded(rec.id)"
                :aria-label="`${rec.data.map || 'Unknown map'} — ${isExpanded(rec.id) ? 'collapse' : 'expand'} match details`"
                @click="toggleExpand(rec.id)"
                @keydown.enter.space.prevent="toggleExpand(rec.id)"
              >
                <div class="match-title-row">
                  <div class="match-title-lhs">
                    <span class="match-index">{{ String(idx + 1).padStart(2, '0') }}</span>
                    <span
                      class="match-map clickable"
                      :class="{ active: isActive('map', rec.data.map ?? '') }"
                      title="Click to filter by this map"
                      @click.stop="toggleFilter('map', rec.data.map ?? '')"
                    >{{ rec.data.map || 'Unknown Map' }}</span>
                  </div>
                  <div class="match-title-rhs">
                    <span v-if="fmtTime(rec)" class="when">{{ fmtTime(rec) }}</span>
                    <span v-if="rec.data.game_length" class="length"><span class="length-mark">▮</span>{{ rec.data.game_length }}</span>
                    <span class="chev" :class="{ open: isExpanded(rec.id) }" aria-hidden="true">›</span>
                  </div>
                </div>

                <div class="match-tag-row">
                  <span
                    v-if="rec.data.mode"
                    class="badge mode clickable"
                    :class="{ active: isActive('mode', rec.data.mode) }"
                    title="Click to filter by this mode"
                    @click.stop="toggleFilter('mode', rec.data.mode)"
                  >{{ rec.data.mode }}</span>
                  <span
                    v-if="rec.data.type"
                    class="badge type clickable"
                    :class="{ active: isActive('type', rec.data.type) }"
                    title="Click to filter by this game type"
                    @click.stop="toggleFilter('type', rec.data.type)"
                  >{{ rec.data.type }}</span>
                  <span
                    v-if="rec.data.role"
                    class="badge role clickable"
                    :class="[rec.data.role, { active: isActive('role', rec.data.role) }]"
                    title="Click to filter by this role"
                    @click.stop="toggleFilter('role', rec.data.role)"
                  >{{ rec.data.role }}</span>
                  <template v-for="hp in heroesForHeader(rec)" :key="hp.hero">
                    <span
                      class="badge hero clickable"
                      :class="{ active: isActive('hero', hp.hero) }"
                      :title="hp.percent_played != null ? `${hp.hero} — ${hp.percent_played}% played` : 'Click to filter by this hero'"
                      @click.stop="toggleFilter('hero', hp.hero)"
                    >
                      <span class="hero-name-inline">{{ hp.hero }}</span>
                      <span v-if="hp.percent_played != null" class="hero-pct-inline">{{ hp.percent_played }}%</span>
                    </span>
                  </template>
                  <span
                    v-if="rec.data.result"
                    class="badge result clickable"
                    :class="[rec.data.result, { active: isActive('result', rec.data.result) }]"
                    title="Click to filter by this result"
                    @click.stop="toggleFilter('result', rec.data.result)"
                  >{{ rec.data.result }}</span>
                  <span
                    v-if="missingRequiredSlots(rec).length"
                    class="incomplete-badge"
                    :title="`Incomplete match — missing ${missingRequiredSlots(rec).map(s => s.label).join(', ')} screenshot${missingRequiredSlots(rec).length === 1 ? '' : 's'}. Expand for details.`"
                  >
                    <span class="incomplete-glyph" aria-hidden="true">!</span>
                    <span class="incomplete-text">missing <strong>{{ missingRequiredSlots(rec).map(s => s.label).join(' · ') }}</strong></span>
                  </span>
                </div>
              </div>

              <template v-if="isExpanded(rec.id)">
                <div class="match-expanded">
                  <!-- Data Coverage (which OW screenshot types were
                       captured for this match, with the missing-data
                       explainer when applicable) lives at the bottom of
                       the expanded card, fused into the Source Screenshots
                       section so the per-match coverage row and the
                       per-file type chips appear together. -->

                  <div v-if="rec.data.final_score" class="meta-row">
                    <span class="meta-eyebrow">Final Score</span>
                    <span class="meta-value">{{ rec.data.final_score }}</span>
                  </div>

                  <div class="stats">
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.eliminations ?? '—' }}</span>
                      <span class="stat-label">Elims</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.assists ?? '—' }}</span>
                      <span class="stat-label">Assists</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.deaths ?? '—' }}</span>
                      <span class="stat-label">Deaths</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.damage != null ? rec.data.damage.toLocaleString() : '—' }}</span>
                      <span class="stat-label">Damage</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.healing != null ? rec.data.healing.toLocaleString() : '—' }}</span>
                      <span class="stat-label">Healing</span>
                    </div>
                    <div class="stat">
                      <span class="stat-value">{{ rec.data.mitigation != null ? rec.data.mitigation.toLocaleString() : '—' }}</span>
                      <span class="stat-label">Mitigation</span>
                    </div>
                  </div>

                  <div v-if="rec.data.rank" class="rank-block">
                    <div class="block-eyebrow">
                      Rank
                    </div>
                    <div class="rank-line">
                      <span class="rank-tier" :class="rec.data.rank">{{ rec.data.rank }} {{ rec.data.level }}</span>
                      <span v-if="rec.data.rank_progress" class="rank-progress">{{ rec.data.rank_progress }}% progress</span>
                      <span v-if="rec.data.change_percent" class="rank-change">+{{ rec.data.change_percent }}%</span>
                      <span v-for="m in rec.data.modifiers" :key="m" class="rank-modifier">{{ m }}</span>
                    </div>
                    <div v-if="rec.data.sr?.length" class="sr-line">
                      <span v-for="s in rec.data.sr" :key="s.hero" class="sr-entry">
                        <span class="sr-hero">{{ s.hero }}</span>
                        <span class="sr-value">{{ s.sr }}</span>
                        <span class="sr-delta" :class="s.change >= 0 ? 'up' : 'down'">{{ s.change >= 0 ? '+' : '' }}{{ s.change }}</span>
                      </span>
                    </div>
                  </div>

                  <div v-if="rec.data.heroes_played?.length" class="heroes-played">
                    <div class="block-eyebrow">
                      Heroes Played
                    </div>
                    <div class="heroes-played-items">
                      <div v-for="hp in rec.data.heroes_played" :key="hp.hero" class="hero-block">
                        <div class="hero-header">
                          <span
                            class="hero-name clickable"
                            :class="{ active: isActive('hero', hp.hero) }"
                            @click="toggleFilter('hero', hp.hero)"
                          >{{ hp.hero }}</span>
                          <span class="hero-pct">{{ hp.percent_played }}%</span>
                          <span v-if="hp.play_time" class="hero-time">{{ hp.play_time }}</span>
                        </div>
                        <div v-if="hp.stats && Object.keys(hp.stats).length" class="personal-grid">
                          <div v-for="(v, k) in hp.stats" :key="k" class="personal-item">
                            <span class="personal-label">{{ k.replace(/_/g, ' ') }}</span>
                            <span class="personal-value">{{ v }}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div v-if="rec.source_files?.length" class="sources-block">
                    <div class="sources-toggle" @click="toggleSources(rec.id)">
                      <span class="chev small" :class="{ open: isSourcesOpen(rec.id) }">›</span>
                      <span class="sources-label">Source Screenshots</span>
                      <span class="sources-count">{{ rec.source_files.length }}</span>
                      <span class="sources-coverage" :title="`${detectScreenshotSlots(rec).filter(s => s.present).length} of ${detectScreenshotSlots(rec).length} screenshot types captured`">
                        <span
                          v-for="slot in detectScreenshotSlots(rec)"
                          :key="slot.key"
                          class="slot-chip"
                          :class="{
                            present: slot.present,
                            absent: !slot.present,
                            optional: !slot.required,
                            'absent-required': !slot.present && slot.required,
                            clickable: slot.present,
                            active: slot.present && isActive('sshot', slot.key),
                          }"
                          :title="slot.present ? `Click to filter to matches that have a ${slot.label} screenshot. ${slot.hint}` : slot.hint"
                          @click.stop="slot.present && toggleFilter('sshot', slot.key)"
                        >
                          <span class="slot-dot" aria-hidden="true" />
                          {{ slot.label }}
                          <span v-if="!slot.required" class="slot-optional-tag">opt</span>
                        </span>
                      </span>
                    </div>
                    <div v-if="isSourcesOpen(rec.id)" class="sources">
                      <div v-for="f in rec.source_files" :key="f" class="source-file">
                        <div class="source-row">
                          <a
                            class="source-name"
                            :href="screenshotURL(f)"
                            :title="isPreviewOpen(f) ? 'Hide preview' : 'Show preview'"
                            @click.prevent="togglePreview(f)"
                          >
                            <span class="chev small" :class="{ open: isPreviewOpen(f) }">›</span>
                            <span class="source-name-text">{{ f }}</span>
                          </a>
                          <span
                            v-if="sourceType(rec, f)"
                            class="source-type-chip clickable"
                            :class="[
                              `source-type-${sourceType(rec, f)}`,
                              { active: isActive('sshot', sourceType(rec, f)) },
                            ]"
                            :title="`Click to filter to matches that have a ${sshotTypeLabel(sourceType(rec, f))} screenshot`"
                            @click.stop="toggleFilter('sshot', sourceType(rec, f))"
                          >{{ sshotTypeLabel(sourceType(rec, f)) }}</span>
                          <span
                            v-else
                            class="source-type-chip unknown"
                            title="Type not yet recorded — parsed before per-file type tracking landed. Clear the database and re-parse to populate."
                          >?</span>
                        </div>
                        <img
                          v-if="isPreviewOpen(f) && !isPreviewError(f)"
                          :src="screenshotURL(f)"
                          :alt="f"
                          class="source-preview"
                          @error="onPreviewError(f)"
                        >
                        <div v-if="isPreviewOpen(f) && isPreviewError(f)" class="source-preview-error">
                          Could not load image — check screenshots folder in Settings.
                        </div>
                      </div>
                    </div>

                    <div v-if="isSourcesOpen(rec.id) && (missingRequiredSlots(rec).length || missingOptionalSlots(rec).length)" class="sources-explain">
                      <p v-for="slot in missingRequiredSlots(rec)" :key="slot.key" class="coverage-line required">
                        <span class="coverage-line-tag">⚠ {{ slot.label }} missing</span>
                        <span class="coverage-line-text">
                          Capture the post-match <strong>{{ slot.label }}</strong> tab and re-parse to recover: {{ slot.missing }}.
                        </span>
                      </p>
                      <p v-for="slot in missingOptionalSlots(rec)" :key="slot.key" class="coverage-line optional">
                        <span class="coverage-line-tag">· {{ slot.label }} not captured</span>
                        <span class="coverage-line-text">
                          Optional — recommended for ranked matches. Provides: {{ slot.missing }}.
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </article>
        </div>
      </div><!-- /.matches-view -->
    </div>

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
          <h3 id="modal-title" class="modal-title">Unsupported Tesseract Version</h3>
          <p class="modal-body">
            Tesseract <strong>{{ tesseractStatus.version }}</strong> is detected. Only version <strong>5.x</strong> is officially tested with Recall.
          </p>
          <p class="modal-body modal-caution">
            Proceed at your own caution — OCR results may be incorrect or incomplete with this version.
          </p>
          <div class="modal-actions">
            <button class="btn ghost" @click="showUnsupportedModal = false">Cancel</button>
            <button class="btn primary" @click="confirmUnsupportedParse">Continue Anyway</button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style>
:root {
  /* DARK MODE (default) — variables here are overridden by [data-theme="light"] below. */
  --bg: #0a0b0d;
  --surface: #13151a;
  --surface-2: #181b22;
  --surface-3: #1d2029;
  --border: #2c2f38;
  --border-soft: #1a1d24;
  --border-strong: #3a3e49;
  --hairline: rgb(255 255 255 / 7%);
  --text: #ecedf0;
  --text-dim: #9ca0ac;
  --text-faint: #6b6f7a;
  --text-mute: #44474f;

  /* Overwatch signature grays. Used as a structural brand element —
     the masthead branding tile, strong borders, divider blocks. */
  --brand-gray: #4A4A4A;
  --brand-gray-soft: rgb(74 74 74 / 55%);

  /* Overwatch signature orange. Single hero accent across the UI. */
  --accent: #F5A623;
  --accent-bright: #ffbf4d;
  --accent-soft: rgb(245 166 35 / 16%);
  --accent-glow: rgb(245 166 35 / 38%);
  --win: #4dff8e;
  --win-soft: rgb(77 255 142 / 12%);
  --win-line: rgb(77 255 142 / 55%);
  --loss: #ff5a73;
  --loss-soft: rgb(255 90 115 / 12%);
  --loss-line: rgb(255 90 115 / 55%);
  --draw: #ffc94d;
  --draw-soft: rgb(255 201 77 / 12%);
  --draw-line: rgb(255 201 77 / 55%);
  --unknown-line: rgb(120 124 134 / 40%);
  --tank: #6ab8ff;
  --tank-soft: rgb(106 184 255 / 14%);
  --dps: #ff7a5a;
  --dps-soft: rgb(255 122 90 / 14%);
  --support: #7dffac;
  --support-soft: rgb(125 255 172 / 14%);

  /* Theme atmosphere tunables — overridden in light mode. */
  --atmos-orange: rgb(245 166 35 / 10%);
  --atmos-blue:   rgb(106 184 255 / 6%);
  --atmos-coral:  rgb(255 90 115 / 5%);
  --grid-line:    rgb(255 255 255 / 1.8%);
  --primary-text-on-accent: #1a0a00;
  --accent-text:  #F5A623;    /* same as --accent in dark mode (good contrast on dark bg) */

  /* In-game display font for hero/map names and the big card scores. Big
     Noodle Too Oblique is intrinsically oblique — consumers pair this with
     `font-style: italic` so the Barlow Condensed fallback also renders in
     its italic cut. */
  --display: 'Big Noodle Too Oblique', 'Barlow Condensed', 'Impact', 'Oswald', sans-serif;
  --body: 'Geist', -apple-system, blinkmacsystemfont, sans-serif;
  --mono: 'Geist Mono', ui-monospace, 'SF Mono', menlo, monospace;

  /* Wordmark face — wide geometric sans inspired by the OW logo (Bank Sans
     Caps Bold EF / Agency FB Extended Black / Zekton). Used only for the
     RECALL masthead title. Russo One is the free visual fallback. */
  --brand: 'OW Wordmark', 'Russo One', 'Industry Black', 'Impact', sans-serif;

  /* Settings page typeface — OW's Futura No. 2 Demi (with Jost as the free
     Indestructible-Type clone fallback). Scoped to the Settings view only. */
  --settings: 'Futura No. 2 Demi', 'Jost', 'Futura', 'Avenir Next', 'Avenir', sans-serif;
}

/* LIGHT MODE — keep brand-gray (#4A4A4A) and brand-orange (#F5A623)
   prominent. The brand-gray now becomes the dominant structural color:
   primary text, strong borders, the wordmark tile bg, hairlines. */
[data-theme="light"] {
  --bg: #f3f0e8;
  --surface: #fbf9f3;
  --surface-2: #f5f2ea;
  --surface-3: #ebe6da;
  --border: #d4ccba;
  --border-soft: #e0d9c6;
  --border-strong: #4A4A4A;
  --hairline: rgb(74 74 74 / 16%);
  --text: #2b2a26;
  --text-dim: #4A4A4A;
  --text-faint: #6f6a5e;
  --text-mute: #a39e90;
  --brand-gray: #4A4A4A;
  --brand-gray-soft: rgb(74 74 74 / 85%);

  /* Keep #F5A623 dominant in light mode too — it's the OW signature.
     Type-on-light contrast is handled with a darker `--accent-text`
     used in selector-level overrides below. */
  --accent: #F5A623;
  --accent-bright: #d68a14;   /* darker on light bg hover, more readable */
  --accent-text: #9a6512;     /* AA-contrast text variant for orange-on-cream */
  --accent-soft: rgb(245 166 35 / 22%);
  --accent-glow: rgb(245 166 35 / 42%);
  --win: #137a3a;
  --win-soft: rgb(19 122 58 / 14%);
  --win-line: rgb(19 122 58 / 60%);
  --loss: #b03346;
  --loss-soft: rgb(176 51 70 / 12%);
  --loss-line: rgb(176 51 70 / 55%);
  --draw: #a07020;
  --draw-soft: rgb(160 112 32 / 14%);
  --draw-line: rgb(160 112 32 / 55%);
  --unknown-line: rgb(74 74 74 / 35%);
  --tank: #2c6eb8;
  --tank-soft: rgb(44 110 184 / 14%);
  --dps: #c54a2c;
  --dps-soft: rgb(197 74 44 / 13%);
  --support: #2d8a4d;
  --support-soft: rgb(45 138 77 / 13%);
  --atmos-orange: rgb(245 166 35 / 14%);
  --atmos-blue:   rgb(44 110 184 / 5%);
  --atmos-coral:  rgb(176 51 70 / 4%);
  --grid-line:    rgb(74 74 74 / 4%);
  --primary-text-on-accent: #1a0a00;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--body);
  font-feature-settings: "ss01", "cv11";
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

.app {
  position: relative;
  min-height: 100vh;
  overflow-x: hidden;
}

/* Soft atmospheric warmth in the top corners. Anchors the eye and
   keeps the off-black from feeling flat. */
.atmos {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(60% 50% at 8% -10%, var(--atmos-orange), transparent 60%),
    radial-gradient(45% 40% at 100% 0%, var(--atmos-blue), transparent 60%),
    radial-gradient(80% 60% at 50% 110%, var(--atmos-coral), transparent 65%);
  transition: opacity 320ms ease;
}

/* Hairline grid pattern, very faint. Tactical/blueprint texture. */
.grid-lines {
  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    linear-gradient(var(--grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at center, rgb(0 0 0 / 90%), transparent 75%);
}

.container {
  position: relative;
  z-index: 1;
  max-width: 1140px;
  margin: 0 auto;
  padding: 2.4rem 1.6rem 4rem;
}

/* ─── Masthead ───────────────────────────────────────────── */

.masthead {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 2rem;
  padding-bottom: 1.4rem;
  margin-bottom: 1.6rem;
  border-bottom: 1px solid var(--hairline);
}

/* The brandmark sits inside a solid Overwatch-gray tile — a small
   "spec plate" that anchors the wordmark and surfaces the brand gray
   #4A4A4A as a deliberate structural element in BOTH themes. The OW
   orange wordmark pops on it; the tile becomes the page's brand stamp
   even when the rest of the page goes light. */
.brandmark-tile {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 1.15rem 0.55rem 1rem;
  background: var(--brand-gray);
  border-radius: 2px;
  box-shadow:
    0 0 0 1px rgb(0 0 0 / 25%) inset,
    0 14px 36px -14px rgb(0 0 0 / 55%);
  isolation: isolate;
}

.brandmark-tile::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--accent-bright);
  box-shadow: 0 0 14px var(--accent-glow);
}

/* The left-rail accent glow reads as a hard halo on the cream background.
   Drop the box-shadow in light mode and use the deeper accent-text color
   for the rail itself so it still pops against the gray tile. */
[data-theme="light"] .brandmark-tile::before {
  background: var(--accent-text);
  box-shadow: none;
}

/* Subtle hatch / striped corner — feels like military stencil tape. */
.brand-corner {
  position: absolute;
  right: 6px; top: 6px;
  width: 14px; height: 14px;
  background:
    repeating-linear-gradient(
      45deg,
      rgb(255 255 255 / 18%) 0 2px,
      transparent 2px 4px
    );
  border-radius: 1px;
  opacity: 0.55;
}

/* White hatch is invisible against light-mode backgrounds — swap to a
   dark stencil so the registration mark still reads. */
[data-theme="light"] .brand-corner {
  background:
    repeating-linear-gradient(
      45deg,
      rgb(0 0 0 / 25%) 0 2px,
      transparent 2px 4px
    );
  opacity: 0.7;
}

.brand-tick {
  color: var(--accent-bright);
  font-size: 1.05rem;
  line-height: 1;
  transform: translateY(-1px);
  text-shadow: 0 0 14px var(--accent-glow);
  font-feature-settings: "tnum";
}

[data-theme="light"] .brand-tick {
  color: var(--accent-text);
  text-shadow: none;
}

.brand {
  font-family: var(--brand);
  font-style: normal;
  font-weight: 800;
  font-size: 2.55rem;
  letter-spacing: 0.04em;
  line-height: 0.9;
  color: #f5f3ee;
  text-transform: uppercase;
}

.brand-accent {
  color: var(--accent-bright);
  text-shadow: 0 0 24px var(--accent-glow);
}

.tagline {
  margin-top: 0.7rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.masthead-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1.15rem;
}

/* Day / Night theme toggle. Two-segment switch with a sliding indicator
   on the active half. Lives in the upper right of the masthead. */
.theme-toggle {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  padding: 3px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  user-select: none;
  transition: border-color 160ms ease, background 160ms ease;
}
.theme-toggle:hover { border-color: var(--border-strong); }

.theme-toggle:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.theme-seg {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.34rem 0.65rem;
  border-radius: 1px;
  transition: color 200ms ease, background 200ms ease;
}

.theme-seg.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.theme-icon {
  width: 13px; height: 13px;
  display: block;
}
.theme-label { font-weight: 600; }

.theme-divider {
  width: 1px;
  background: var(--border);
  margin: 4px 0;
}

.scoreboard {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 1.4rem;
  padding: 0.1rem 0;
}

.score-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 0.9;
}

.score-num {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 2.6rem;
  letter-spacing: -0.02em;
  font-feature-settings: "tnum";
}
.score-num.win  { color: var(--win); }
.score-num.loss { color: var(--loss); }
.score-num.draw { color: var(--draw); }

.score-label {
  margin-top: 0.3rem;
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.2em;
  color: var(--text-faint);
  text-transform: uppercase;
}

/* ─── Control Deck (parse row) ───────────────────────────── */

.control-deck {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1.2rem;
  padding: 0.9rem 1.1rem;
  background: linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%);
  border: 1px solid var(--border);
  border-radius: 2px;
  position: relative;
}

.control-deck::before {
  content: '';
  position: absolute; left: 0; top: 0; bottom: 0;
  width: 2px;
  background: var(--accent);
  opacity: 0.85;
}

.deck-path {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  flex: 1 1 auto;
}

.deck-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.22em;
}

.deck-path-value {
  font-family: var(--mono);
  font-size: 0.85rem;
  color: var(--text-dim);
  word-break: break-all;
  line-height: 1.3;
}

.deck-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
}

/* ─── Buttons ────────────────────────────────────────────── */

.btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--body);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  border: 1px solid transparent;
  border-radius: 2px;
  padding: 0.55rem 0.95rem;
  cursor: pointer;
  user-select: none;
  text-transform: uppercase;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease, transform 140ms ease, box-shadow 200ms ease;
}
.btn:disabled { opacity: 0.4; cursor: not-allowed; }

.btn.primary {
  background: var(--accent);
  color: #1a0a00;
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 40%) inset, 0 4px 28px -8px var(--accent-glow);
}

.btn.primary:hover:not(:disabled) {
  background: var(--accent-bright);
  border-color: var(--accent-bright);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 40%) inset, 0 4px 36px -6px var(--accent-glow);
  transform: translateY(-1px);
}

.btn.primary:active:not(:disabled) {
  transform: translateY(0);
}

.btn-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #1a0a00;
  box-shadow: 0 0 0 2px rgb(26 10 0 / 25%);
}

.btn.ghost {
  background: transparent;
  color: var(--text-dim);
  border-color: var(--border-strong);
}

.btn.ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
  background: rgb(255 255 255 / 2.5%);
}

.btn.ghost.tiny {
  padding: 0.38rem 0.65rem;
  font-size: 0.7rem;
}

.btn.ghost.danger:hover:not(:disabled) {
  color: var(--loss);
  border-color: var(--loss-line);
}

.btn.danger-outline {
  background: transparent;
  color: var(--loss);
  border-color: var(--loss-line);
}

.btn.danger-outline:hover:not(:disabled) {
  background: var(--loss-soft);
  border-color: var(--loss);
  transform: translateY(-1px);
}

.btn.danger {
  background: var(--loss);
  color: #fff;
  border-color: var(--loss);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 30%) inset, 0 4px 22px -8px var(--loss-line);
}

.btn.danger:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px rgb(0 0 0 / 30%) inset, 0 4px 30px -6px var(--loss-line);
}

.btn.danger:active:not(:disabled) { transform: translateY(0); }

/* Confirm-state row gets a subtle red tint on the left edge */
.setting-row.danger-row {
  border-left: 3px solid var(--loss-line);
  padding-left: calc(1.4rem - 3px);
  background: var(--loss-soft);
  border-radius: 2px;
  transition: background 200ms ease, border-color 200ms ease;
}

.clear-confirm-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
}

[data-theme="light"] .btn.danger { color: #fff; }
[data-theme="light"] .btn.danger-outline { color: var(--loss); border-color: var(--loss-line); }

[data-theme="light"] .btn.danger-outline:hover:not(:disabled) {
  background: var(--loss-soft);
  border-color: var(--loss);
}
[data-theme="light"] .setting-row.danger-row { background: var(--loss-soft); }

/* ─── Switch toggle ──────────────────────────────────────── */

.switch {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  cursor: pointer;
  user-select: none;
  padding: 0.45rem 0.7rem 0.45rem 0.55rem;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  background: transparent;
  transition: border-color 140ms ease, background 140ms ease;
}
.switch:hover { border-color: var(--text-faint); }
.switch input { position: absolute; opacity: 0; pointer-events: none; }

.switch-track {
  position: relative;
  width: 26px; height: 14px;
  border-radius: 999px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  transition: background 200ms ease, border-color 200ms ease;
  flex-shrink: 0;
}

.switch-knob {
  position: absolute;
  top: 1px; left: 1px;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--text-faint);
  transition: transform 200ms cubic-bezier(0.4, 0.0, 0.2, 1), background 200ms ease;
}

.switch input:checked ~ .switch-track {
  background: var(--accent-soft);
  border-color: var(--accent);
}

.switch input:checked ~ .switch-track .switch-knob {
  transform: translateX(12px);
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent-glow);
}
.switch input:checked ~ .switch-label { color: var(--text); }

.switch-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-dim);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* ─── Empty / Error states ──────────────────────────────── */

.error {
  display: flex; align-items: center; gap: 0.55rem;
  margin-top: 1rem;
  padding: 0.7rem 1rem;
  background: var(--loss-soft);
  border-left: 2px solid var(--loss);
  color: var(--loss);
  font-family: var(--mono);
  font-size: 0.8rem;
}

.error-tick {
  font-weight: 700;
  opacity: 0.85;
}

.empty {
  margin-top: 4rem;
  text-align: center;
  padding: 3rem 1rem;
}

.empty-mark {
  font-family: var(--display);
  font-style: italic;
  font-size: 5rem;
  color: var(--text-mute);
  margin-bottom: 1rem;
}

.empty-title {
  font-family: var(--display);
  font-style: italic;
  font-size: 1.6rem;
  letter-spacing: -0.01em;
  text-transform: uppercase;
  color: var(--text);
  margin-bottom: 0.5rem;
}

.empty-sub {
  color: var(--text-faint);
  font-size: 0.88rem;
}
.empty-sub strong { color: var(--accent); font-weight: 600; }

/* Numbered setup steps shown in the Matches empty state — mirrors the
   nav-tab numbering (01/02/03) so the user reads "01 Settings → 02
   Ingest → 03 here" with no ambiguity. */
.empty-steps {
  list-style: none;
  margin: 1.1rem auto 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  max-width: 44ch;
  text-align: left;
}

.empty-steps li {
  display: grid;
  grid-template-columns: 2.2rem 1fr;
  gap: 0.65rem;
  align-items: baseline;
  color: var(--text-dim);
  font-size: 0.88rem;
  line-height: 1.45;
}

.empty-step-num {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: var(--accent);
  text-align: right;
}

.empty-steps strong.empty-link {
  color: var(--accent);
}

/* ─── Filter Rail ────────────────────────────────────────── */

.filter-rail {
  margin-top: 1.4rem;
  padding: 1rem 1.1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.7rem;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  position: relative;
}

.filter-eyebrow {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.4rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  transition: color 160ms ease;
}

.eyebrow-count {
  color: var(--accent-text);
  font-feature-settings: "tnum";
  letter-spacing: 0.14em;
  font-weight: 600;
}
.multi-filter.populated .filter-eyebrow { color: var(--text-dim); }

/* ─── Tactical multi-select ────────────────────────────────
   Trigger is a low spec-plate. Two riveted corner ticks on
   each side; chip-strip in the middle. Click → animated
   popover with a hazard-strip head, scroll roster, and a
   foot bar of bulk actions.
   ───────────────────────────────────────────────────────── */
.mf-trigger {
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  min-height: 38px;
  padding: 0.35rem 0.5rem 0.35rem 0.6rem;
  font-family: var(--body);
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}

.mf-trigger::before,
.mf-trigger::after {
  /* Corner ticks — tiny L-marks at the top-left + bottom-right of
     the trigger, like an industrial spec plate. Fade in on hover. */
  content: '';
  position: absolute;
  width: 6px;
  height: 6px;
  border: 1px solid var(--accent);
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;
}

.mf-trigger::before {
  top: -1px; left: -1px;
  border-right: none; border-bottom: none;
}

.mf-trigger::after {
  bottom: -1px; right: -1px;
  border-left: none; border-top: none;
}

.mf-trigger:hover {
  border-color: var(--border-strong);
  background: var(--surface-3);
}

.mf-trigger:hover::before,
.mf-trigger:hover::after { opacity: 0.5; }

.multi-filter.open .mf-trigger {
  border-color: var(--accent);
  background: var(--surface-3);
  box-shadow: 0 0 0 1px var(--accent-soft) inset;
}

.multi-filter.open .mf-trigger::before,
.multi-filter.open .mf-trigger::after { opacity: 1; }
.multi-filter.populated .mf-trigger { border-color: var(--accent-soft); }

.mf-trigger-inner {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
  flex: 1;
}

.mf-placeholder {
  font-family: var(--display);
  font-style: italic;
  font-size: 1rem;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  text-transform: uppercase;
}

.mf-placeholder-meta {
  margin-left: auto;
  padding-left: 0.6rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-mute);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  white-space: nowrap;
}

.mf-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.4rem 0.18rem 0.5rem;
  background: var(--accent);
  color: var(--primary-text-on-accent);
  border-radius: 1px;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: capitalize;
  max-width: 100%;
  cursor: pointer;
  animation: chip-in 220ms cubic-bezier(0.2, 0.7, 0.3, 1.4);
  transition: background 140ms ease, transform 120ms ease;
}

.mf-chip:hover {
  background: var(--accent-bright);
  transform: translateY(-1px);
}

.mf-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mf-chip-x {
  font-family: var(--body);
  font-size: 0.85rem;
  line-height: 1;
  font-weight: 700;
  opacity: 0.55;
  margin-right: -0.05rem;
}
.mf-chip:hover .mf-chip-x { opacity: 1; }
.mf-chip-stack { padding-right: 0.5rem; }

.mf-more {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.35rem;
  background: var(--brand-gray);
  color: #f1f1f1;
  border-radius: 1px;
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.mf-caret {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-right: 1px solid var(--text-dim);
  border-bottom: 1px solid var(--text-dim);
  transform: translateY(-2px) rotate(45deg);
  transition: transform 220ms ease, border-color 160ms ease;
  align-self: center;
}

.multi-filter.open .mf-caret {
  transform: translateY(2px) rotate(-135deg);
  border-color: var(--accent);
}

@keyframes chip-in {
  0%   { transform: scale(0.7) translateY(2px); opacity: 0; }
  60%  { transform: scale(1.05) translateY(0); opacity: 1; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}

/* Popover panel below the trigger */
.mf-panel {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  min-width: 220px;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 2px;
  box-shadow:
    0 24px 60px -18px rgb(0 0 0 / 70%),
    0 0 0 1px var(--accent-soft);
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow: hidden;
  animation: panel-in 180ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  transform-origin: top center;
}

@keyframes panel-in {
  from { opacity: 0; transform: translateY(-6px) scaleY(0.92); }
  to   { opacity: 1; transform: translateY(0)    scaleY(1); }
}

.mf-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.7rem;
  background:
    repeating-linear-gradient(
      135deg,
      var(--brand-gray) 0 12px,
      #3a3a3a 12px 24px
    );
  border-bottom: 1px solid var(--accent);
  color: #f1f1f1;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}
.mf-panel-title { font-weight: 700; }

.mf-panel-meta {
  color: var(--accent);
  font-feature-settings: "tnum";
  letter-spacing: 0.18em;
}

/* One-line hint under the panel head — explains the multi-select union
   semantics so users aren't guessing whether picks AND together. */
.mf-panel-hint {
  margin: 0;
  padding: 0.4rem 0.7rem;
  background: var(--surface-2);
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-bottom: 1px solid var(--hairline);
}

.mf-panel-hint em {
  font-style: normal;
  color: var(--accent);
  font-weight: 700;
}

.mf-search {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.7rem;
  border-bottom: 1px dashed var(--border);
  background: var(--surface-2);
}

.mf-search-icon {
  font-family: var(--mono);
  font-size: 0.9rem;
  color: var(--text-faint);
}

.mf-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-family: var(--body);
  font-size: 0.84rem;
  padding: 0.2rem 0;
}

.mf-search-input::placeholder {
  color: var(--text-mute);
  font-style: italic;
}

.mf-list {
  overflow-y: auto;
  padding: 0.3rem 0;
  flex: 1 1 auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
.mf-list::-webkit-scrollbar { width: 6px; }

.mf-list::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}

.mf-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.7rem;
  cursor: pointer;
  font-family: var(--body);
  font-size: 0.86rem;
  color: var(--text-dim);
  text-transform: capitalize;
  user-select: none;
  position: relative;
  transition: background 100ms ease, color 100ms ease;
}

.mf-row:hover {
  background: var(--surface-2);
  color: var(--text);
}

.mf-row.checked {
  color: var(--text);
  background: var(--accent-soft);
}

.mf-row.checked::before {
  content: '';
  position: absolute;
  inset: 0;
  border-left: 2px solid var(--accent);
  pointer-events: none;
}

.mf-row-box {
  /* The real checkbox lives behind .mf-row-mark for accessibility. */
  position: absolute;
  opacity: 0;
  width: 1px; height: 1px;
  pointer-events: none;
}

.mf-row-mark {
  position: relative;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  transition: background 120ms ease, border-color 120ms ease;
}

.mf-row.checked .mf-row-mark {
  background: var(--accent);
  border-color: var(--accent);
}

.mf-row.checked .mf-row-mark::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0;
  width: 4px;
  height: 8px;
  border-right: 2px solid var(--primary-text-on-accent);
  border-bottom: 2px solid var(--primary-text-on-accent);
  transform: rotate(45deg);
  animation: mark-in 160ms cubic-bezier(0.2, 0.7, 0.3, 1.4);
}

@keyframes mark-in {
  from { opacity: 0; transform: rotate(45deg) scale(0.4); }
  to   { opacity: 1; transform: rotate(45deg) scale(1); }
}

.mf-row-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mf-row-box:focus-visible + .mf-row-mark {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.mf-empty {
  padding: 0.8rem 0.7rem;
  text-align: center;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-mute);
  letter-spacing: 0.08em;
  font-style: italic;
}

.mf-panel-foot {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.5rem;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}
.mf-foot-spacer { flex: 1; }

.mf-foot-btn {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.35rem 0.6rem;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 1px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}

.mf-foot-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-dim);
}

.mf-foot-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mf-foot-btn.primary {
  background: var(--accent);
  color: var(--primary-text-on-accent);
  border-color: var(--accent);
  font-weight: 700;
}

.mf-foot-btn.primary:hover {
  background: var(--accent-bright);
  border-color: var(--accent-bright);
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.8rem;
  margin-top: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px dashed var(--border);
}

.range-group {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.range-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--mono);
  font-size: 0.65rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.range-dash {
  color: var(--text-mute);
  font-family: var(--mono);
  font-size: 0.85rem;
}

/* Hint shown beside the Reset button when an active date filter is
   excluding rows that lack a parseable date+finished_at. */
.range-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: 0.4rem;
  padding: 0.18rem 0.5rem;
  background: var(--surface-2);
  border: 1px dashed var(--border);
  border-radius: 2px;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: help;
  font-feature-settings: "tnum";
}

.dd-date {
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--mono);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.35rem 0.5rem;
  font-size: 0.82rem;
  color-scheme: dark;
  letter-spacing: 0;
  text-transform: none;
}

.dd-date:focus {
  outline: none;
  border-color: var(--accent);
}

.filter-tools {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.count {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  margin-left: 0.4rem;
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.count strong {
  color: var(--accent);
  font-weight: 600;
  font-size: 0.95rem;
}
.count-of { color: var(--text-faint); font-size: 0.72rem; }

/* ─── Match list ─────────────────────────────────────────── */

.match-list {
  margin-top: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

@keyframes match-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

.match {
  position: relative;
  display: flex;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
  animation: match-enter 360ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
}
.match:hover { border-color: var(--border-strong); }

.match.expanded {
  border-color: var(--border-strong);
  background: linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%);
}

.match-bar {
  width: 3px;
  background: var(--unknown-line);
  flex-shrink: 0;
  transition: background 200ms ease, width 200ms ease, box-shadow 200ms ease;
}

.match.result-victory .match-bar {
  background: var(--win-line);
  box-shadow: 0 0 12px -2px var(--win-line);
}

.match.result-defeat .match-bar {
  background: var(--loss-line);
  box-shadow: 0 0 12px -2px var(--loss-line);
}

.match.result-draw .match-bar {
  background: var(--draw-line);
  box-shadow: 0 0 12px -2px var(--draw-line);
}
.match.expanded .match-bar { width: 5px; }

.match-body {
  flex: 1 1 auto;
  min-width: 0;
  padding: 0.95rem 1.15rem;
}

.match-header {
  cursor: pointer;
  user-select: none;
  border-radius: 2px;
}

.match-header:focus { outline: none; }

.match-header:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}

.match-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.55rem;
}

.match-title-lhs {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  min-width: 0;
}

.match-index {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-mute);
  letter-spacing: 0.06em;
  font-feature-settings: "tnum";
}

.match-map {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 1.55rem;
  letter-spacing: 0.005em;
  color: var(--text);
  text-transform: uppercase;
  padding: 0 0.15rem;
  position: relative;
  transition: color 160ms ease, text-shadow 200ms ease;
}

.match-map:hover {
  color: var(--accent-bright);
  text-shadow: 0 0 24px var(--accent-glow);
}

.match-map.active {
  color: var(--accent);
  text-shadow: 0 0 18px var(--accent-glow);
}

.match-title-rhs {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-shrink: 0;
}

.when {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
  letter-spacing: 0;
}

.length {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--mono);
  font-size: 0.74rem;
  color: var(--text-faint);
  font-feature-settings: "tnum";
}

.length-mark {
  color: var(--accent);
  font-size: 0.55rem;
  opacity: 0.7;
}

.chev {
  color: var(--text-faint);
  font-size: 1.2rem;
  line-height: 1;
  transition: transform 200ms cubic-bezier(0.4, 0.0, 0.2, 1), color 200ms ease;
  display: inline-block;
  font-weight: 300;
}
.chev.open { transform: rotate(90deg); color: var(--accent); }
.chev.small { font-size: 0.9rem; }

/* ─── Tag row (badges) ───────────────────────────────────── */

.match-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.18rem 0.55rem;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border-radius: 2px;
  border: 1px solid transparent;
  background: var(--surface-3);
  color: var(--text-dim);
  line-height: 1.4;
  font-feature-settings: "tnum";
}

.badge.mode {
  background: rgb(255 255 255 / 4%);
  border-color: var(--border-strong);
}

.badge.type {
  background: rgb(255 255 255 / 2.5%);
  color: var(--text-faint);
  letter-spacing: 0.12em;
}

.badge.role { font-weight: 700; }
.badge.role.dps     { background: var(--dps-soft);     color: var(--dps);     border-color: rgb(255 122 90 / 40%); }
.badge.role.tank    { background: var(--tank-soft);    color: var(--tank);    border-color: rgb(106 184 255 / 40%); }
.badge.role.support { background: var(--support-soft); color: var(--support); border-color: rgb(125 255 172 / 40%); }

.badge.hero {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: rgb(245 166 35 / 40%);
  font-weight: 600;
}

.hero-name-inline {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.hero-pct-inline {
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--accent-text);
  opacity: 0.75;
  font-weight: 500;
  font-feature-settings: "tnum";
  letter-spacing: 0;
}

.badge.result { font-weight: 800; padding: 0.18rem 0.6rem; }
.badge.result.victory { background: var(--win-soft);  color: var(--win);  border-color: var(--win-line); }
.badge.result.defeat  { background: var(--loss-soft); color: var(--loss); border-color: var(--loss-line); }
.badge.result.draw    { background: var(--draw-soft); color: var(--draw); border-color: var(--draw-line); }

/* Incomplete-match warning pill — sits at the right end of the badge row
   only when one or more required screenshot types weren't captured. The
   pulsing dot draws the eye; tooltip + expanded view explain the why. */
.incomplete-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.18rem 0.55rem 0.18rem 0.4rem;
  margin-left: auto;
  background: rgb(245 166 35 / 8%);
  border: 1px dashed rgb(245 166 35 / 55%);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-bright);
  cursor: help;
  animation: incomplete-pulse 2.6s ease-in-out infinite;
}

.incomplete-badge strong {
  font-weight: 700;
  color: var(--accent-bright);
  letter-spacing: 0.12em;
}

.incomplete-glyph {
  display: inline-grid;
  place-items: center;
  width: 0.95rem;
  height: 0.95rem;
  border-radius: 50%;
  background: var(--accent);
  color: #1a0a00;
  font-weight: 900;
  font-size: 0.65rem;
  line-height: 1;
  font-family: var(--mono);
}

@keyframes incomplete-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgb(245 166 35 / 0%); }
  50%      { box-shadow: 0 0 0 3px rgb(245 166 35 / 14%); }
}

[data-theme="light"] .incomplete-badge {
  background: rgb(245 166 35 / 12%);
  color: var(--accent-text);
}

[data-theme="light"] .incomplete-badge strong { color: var(--accent-text); }

/* Clickable interactions */
.clickable {
  cursor: pointer;
  transition: transform 160ms ease, filter 160ms ease, box-shadow 200ms ease, border-color 160ms ease;
  user-select: none;
}
.badge.clickable:hover { filter: brightness(1.2); transform: translateY(-1px); }

.badge.clickable.active {
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft);
}

/* ─── Expanded card content ──────────────────────────────── */

.match-expanded {
  margin-top: 0.95rem;
  padding-top: 0.95rem;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.meta-row {
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
}

.meta-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.22em;
}

.meta-value {
  font-family: var(--display);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.block-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.22em;
  margin-bottom: 0.55rem;
}

/* Data Coverage block — diagnostic HUD strip at the top of every expanded
   card. Lists the four OW screenshot type slots, marks each present /
   absent / optional, and explains the consequence of each missing one. */
.coverage-block {
  padding: 0.7rem 0.85rem 0.85rem;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 1%), transparent),
    var(--surface-2);
  border: 1px solid var(--border);
  border-left: 2px solid var(--brand-gray);
  border-radius: 2px;
  position: relative;
}

.coverage-block::before {
  /* Decorative corner tick — small OW-style registration mark. */
  content: '';
  position: absolute;
  top: -1px;
  left: -2px;
  width: 0.6rem;
  height: 2px;
  background: var(--accent);
}

[data-theme="light"] .coverage-block::before {
  background: var(--accent-text);
}

.coverage-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.55rem;
}

.coverage-header .block-eyebrow { margin-bottom: 0; }

.coverage-count {
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-mute);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-feature-settings: "tnum";
}

.coverage-block .slot-row {
  flex-wrap: wrap;
  gap: 0.35rem;
}

.coverage-explain {
  margin-top: 0.7rem;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--hairline);
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.coverage-line {
  display: grid;
  grid-template-columns: minmax(9.5rem, max-content) 1fr;
  gap: 0.7rem;
  align-items: baseline;
  margin: 0;
  font-size: 0.78rem;
  line-height: 1.4;
}

.coverage-line-tag {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 700;
  white-space: nowrap;
}

.coverage-line.required .coverage-line-tag { color: var(--accent-bright); }
.coverage-line.optional .coverage-line-tag { color: var(--text-faint); }

.coverage-line-text {
  color: var(--text-dim);
}

.coverage-line.required .coverage-line-text strong {
  color: var(--accent-bright);
  font-weight: 700;
}

[data-theme="light"] .coverage-line.required .coverage-line-tag,
[data-theme="light"] .coverage-line.required .coverage-line-text strong {
  color: var(--accent-text);
}

@media (width <= 720px) {
  .coverage-line {
    grid-template-columns: 1fr;
    gap: 0.2rem;
  }
}

/* Stats grid: big mono numbers, tiny tracked labels */
.stats {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0;
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
  background: var(--surface-2);
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0.7rem 0.85rem 0.65rem;
  border-right: 1px solid var(--border);
  position: relative;
}
.stat:last-child { border-right: none; }

.stat::before {
  content: '';
  position: absolute; left: 0; top: 0;
  width: 100%; height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent-soft), transparent);
  opacity: 0;
  transition: opacity 200ms ease;
}
.stat:hover::before { opacity: 1; }

.stat-value {
  font-family: var(--display);
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.01em;
  line-height: 1;
  font-feature-settings: "tnum";
}

.stat-label {
  margin-top: 0.35rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

/* Rank block */
.rank-line {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: center;
  margin-bottom: 0.5rem;
}

.rank-tier {
  font-family: var(--display);
  font-size: 0.95rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0.2rem 0.6rem;
  border-radius: 2px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
}
.rank-tier.bronze    { color: #d18a4a; border-color: rgb(209 138 74 / 45%); }
.rank-tier.silver    { color: #d6d6d6; border-color: rgb(214 214 214 / 40%); }
.rank-tier.gold      { color: #ffd770; border-color: rgb(255 215 112 / 45%); }
.rank-tier.platinum  { color: #7befd9; border-color: rgb(123 239 217 / 45%); }
.rank-tier.diamond   { color: #c2e6ff; border-color: rgb(194 230 255 / 45%); }
.rank-tier.master    { color: #d6b4ff; border-color: rgb(214 180 255 / 45%); }
.rank-tier.grandmaster, .rank-tier.champion { color: var(--loss); border-color: var(--loss-line); }

.rank-progress {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.rank-change {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--win);
  font-weight: 600;
  font-feature-settings: "tnum";
}

.rank-modifier {
  font-size: 0.62rem;
  padding: 0.18rem 0.5rem;
  background: var(--surface-3);
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}
.sr-line { display: flex; flex-wrap: wrap; gap: 0.7rem; }

.sr-entry {
  display: inline-flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.25rem 0.55rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-size: 0.78rem;
}
.sr-hero { color: var(--text-dim); text-transform: capitalize; font-size: 0.75rem; }
.sr-value { font-family: var(--mono); color: var(--text); font-weight: 600; font-feature-settings: "tnum"; }
.sr-delta { font-family: var(--mono); font-size: 0.7rem; font-weight: 600; font-feature-settings: "tnum"; }
.sr-delta.up   { color: var(--win); }
.sr-delta.down { color: var(--loss); }

/* Heroes Played list */
.heroes-played-items {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.hero-block {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-left: 2px solid var(--accent-soft);
  border-radius: 2px;
  padding: 0.75rem 0.9rem;
}

.hero-header {
  display: flex;
  gap: 0.7rem;
  align-items: baseline;
  margin-bottom: 0.55rem;
}

.hero-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 1.15rem;
  font-weight: 800;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 0 0.15rem;
  cursor: pointer;
  transition: color 160ms ease, text-shadow 200ms ease;
}
.hero-name:hover { color: var(--accent-bright); text-shadow: 0 0 16px var(--accent-glow); }
.hero-name.active { text-shadow: 0 0 14px var(--accent-glow); }

.hero-pct {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.hero-time {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-faint);
}

.personal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(165px, 1fr));
  gap: 1px;
  background: var(--border);
  border: 1px solid var(--border);
}

.personal-item {
  background: var(--surface);
  padding: 0.45rem 0.7rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.personal-label {
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.personal-value {
  font-family: var(--mono);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text);
  font-feature-settings: "tnum";
}

/* Source screenshots */
.sources-block {
  margin-top: 0.2rem;
  border-top: 1px dashed var(--border);
  padding-top: 0.85rem;
}

.sources-toggle {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  cursor: pointer;
  user-select: none;
  font-family: var(--mono);
  font-size: 0.65rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  transition: color 160ms ease;
}
.sources-toggle:hover { color: var(--text-dim); }

.sources-count {
  font-family: var(--mono);
  background: var(--surface-3);
  color: var(--text-dim);
  padding: 0.05rem 0.4rem;
  border-radius: 2px;
  font-size: 0.6rem;
  letter-spacing: 0;
  margin-left: 0.2rem;
}

/* Coverage chips on the Sources toggle row — same .slot-chip styling
   as the legacy coverage-block, but pushed to the right of the
   "Source Screenshots · 5" label. Clicking a present chip toggles
   the screenshot-type filter; absent chips are inert visuals. */
.sources-coverage {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  margin-left: auto;
}

.sources-coverage .slot-chip.clickable {
  cursor: pointer;
}

.sources-coverage .slot-chip.clickable:hover {
  filter: brightness(1.12);
  transform: translateY(-1px);
}

.sources-coverage .slot-chip.active {
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft);
}

.sources {
  margin-top: 0.55rem;
  padding: 0.65rem 0.75rem;
  background: rgb(0 0 0 / 30%);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.72rem;
}
.source-file + .source-file { margin-top: 0.45rem; }

/* Each source file is one row: the clickable filename on the left,
   the screenshot-type chip on the right. */
.source-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.source-name {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-dim);
  cursor: pointer;
  text-decoration: none;
  padding: 0.25rem 0.4rem;
  border-radius: 2px;
  transition: color 160ms ease, background 160ms ease;
  word-break: break-all;
  flex: 1;
  min-width: 0;
}
.source-name:hover { background: var(--surface-2); color: var(--accent-bright); }
.source-name-text { font-size: 0.72rem; }

/* Per-file type chip — small uppercase mono pill, color-coded by
   screenshot type. Clickable to add the type to the source filter. */
.source-type-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.18rem 0.5rem;
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  border: 1px solid transparent;
  flex-shrink: 0;
  cursor: default;
  user-select: none;
  transition: filter 140ms ease, transform 140ms ease, box-shadow 140ms ease;
}

.source-type-chip.clickable {
  cursor: pointer;
}

.source-type-chip.clickable:hover {
  filter: brightness(1.15);
  transform: translateY(-1px);
}

.source-type-chip.active {
  box-shadow: 0 0 0 1px var(--accent), 0 0 0 3px var(--accent-soft);
}

/* Type-specific palettes — each screenshot category gets a recognizable
   color so a glance down the source list shows the capture pattern. */
.source-type-summary {
  background: var(--accent-soft);
  border-color: rgb(245 166 35 / 50%);
  color: var(--accent-bright);
}

.source-type-scoreboard {
  background: rgb(106 184 255 / 12%);
  border-color: rgb(106 184 255 / 50%);
  color: var(--tank);
}

.source-type-personal {
  background: rgb(125 255 172 / 12%);
  border-color: rgb(125 255 172 / 50%);
  color: var(--support);
}

.source-type-rank {
  background: rgb(255 201 77 / 14%);
  border-color: rgb(255 201 77 / 50%);
  color: var(--draw);
}

.source-type-chip.unknown {
  background: transparent;
  border-color: var(--border);
  border-style: dashed;
  color: var(--text-mute);
  cursor: help;
}

[data-theme="light"] .source-type-summary { color: var(--accent-text); }

/* Missing-data explainer below the file list — same pattern as the
   old coverage-block's explain section, just folded into this block. */
.sources-explain {
  margin-top: 0.7rem;
  padding-top: 0.65rem;
  border-top: 1px dashed var(--hairline);
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.source-preview {
  display: block;
  margin: 0.5rem 0 0.25rem 1.1rem;
  max-width: calc(100% - 1.1rem);
  max-height: 460px;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: #000;
  box-shadow: 0 8px 30px -8px rgb(0 0 0 / 50%);
}

.source-preview-error {
  margin: 0.5rem 0 0.25rem 1.1rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.72rem;
  color: var(--text-faint);
  background: var(--surface-3);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
}

/* ─── Page Nav (Settings / Ingest / Matches / Unknown) ──── */

.page-nav {
  margin-top: 1.1rem;
  display: inline-flex;
  align-items: stretch;
  gap: 1.8rem;
  position: relative;
}

.page-nav::before {
  /* Faint baseline that the active tab's underline sits on. */
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 1px;
  background: var(--hairline);
}

.nav-tab {
  position: relative;
  background: transparent;
  border: none;
  padding: 0.15rem 0 0.7rem;
  cursor: pointer;
  font-family: var(--display);
  font-weight: 800;
  font-size: 1.05rem;
  letter-spacing: -0.005em;
  text-transform: uppercase;
  color: var(--text-faint);
  display: inline-flex;
  align-items: baseline;
  gap: 0.55rem;
  transition: color 200ms ease;
}

.nav-tab-num {
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 500;
  letter-spacing: 0.16em;
  color: var(--text-mute);
  transition: color 200ms ease;
  font-feature-settings: "tnum";
}
.nav-tab-label { line-height: 1; }
.nav-tab:hover { color: var(--text-dim); }
.nav-tab:hover .nav-tab-num { color: var(--text-faint); }
.nav-tab.active { color: var(--text); }
.nav-tab.active .nav-tab-num { color: var(--accent); }

.nav-tab.active::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 2px;
  background: var(--accent);
  box-shadow: 0 0 14px var(--accent-glow);
  border-radius: 1px;
  animation: nav-underline 280ms cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes nav-underline {
  from { transform: scaleX(0); transform-origin: left; opacity: 0; }
  to   { transform: scaleX(1); opacity: 1; }
}

/* ─── Settings View ──────────────────────────────────────── */

@keyframes view-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.settings, .matches-view, .unknown-view {
  animation: view-fade-in 360ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Settings tab adopts the OW Futura No. 2 Demi typeface (via the --settings
   fallback chain). We re-point --display and --body at --settings inside the
   scope so the page's existing rules (settings-heading, section-title, btn,
   labels, etc.) all pick it up. .unknown-view and .ingest-view share the
   .settings class for layout/animation but keep their content on the
   in-game display font — hence the compound :not selector. */
.settings:not(.unknown-view, .ingest-view) {
  --display: var(--settings);
  --body: var(--settings);

  font-family: var(--settings);
}

.settings:not(.unknown-view, .ingest-view) input,
.settings:not(.unknown-view, .ingest-view) textarea,
.settings:not(.unknown-view, .ingest-view) select,
.settings:not(.unknown-view, .ingest-view) button {
  font-family: var(--settings);
}

.settings:not(.unknown-view, .ingest-view) .settings-heading {
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.005em;
}

.settings:not(.unknown-view, .ingest-view) .settings-heading em {
  font-style: normal;
  font-weight: 600;
}

.settings:not(.unknown-view, .ingest-view) .section-title {
  font-style: normal;
  font-weight: 600;
  letter-spacing: 0.015em;
}

.settings:not(.unknown-view, .ingest-view) .section-num {
  font-style: normal;
  font-weight: 600;
}

.settings-sub {
  margin-top: 0.85rem;
  color: var(--text-dim);
  font-size: 0.875rem;
  line-height: 1.55;
  max-width: 60ch;
}

.settings-sub .empty-link {
  cursor: pointer;
}

.settings-intro {
  margin-top: 1.4rem;
  margin-bottom: 2.4rem;
  padding-bottom: 1.4rem;
  border-bottom: 1px dashed var(--border);
}

.settings-eyebrow {
  font-family: var(--mono);
  font-size: 0.65rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.24em;
  margin-bottom: 0.45rem;
}

.settings-heading {
  font-family: var(--display);
  font-weight: 700;
  font-size: 2rem;
  letter-spacing: -0.01em;
  line-height: 1.05;
  color: var(--text);
  text-transform: uppercase;
  max-width: 60ch;
}

.settings-heading em {
  font-style: normal;
  color: var(--accent-text);
  word-break: break-all;
  background: var(--accent-soft);
  padding: 0 0.25rem;
  margin: 0 -0.05rem;
  border-radius: 1px;
}

.settings-section {
  margin-top: 2.6rem;
}
.settings-section:first-of-type { margin-top: 0; }

.section-header {
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
  padding-bottom: 0.85rem;
  margin-bottom: 0.4rem;
  border-bottom: 1px solid var(--brand-gray);
  position: relative;
}

.section-header::after {
  /* Small orange tick at the right end of the section divider — a
     decorative tactical mark, like a registration cue on a film strip. */
  content: '';
  position: absolute;
  right: 0; bottom: -1px;
  width: 28px; height: 3px;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}

[data-theme="light"] .section-header::after {
  background: var(--accent-text);
  box-shadow: none;
}

.section-num {
  font-family: var(--display);
  font-weight: 900;
  font-size: 3rem;
  color: var(--brand-gray);
  letter-spacing: -0.03em;
  line-height: 0.85;
  font-feature-settings: "tnum";
  transform: translateY(2px);
}

.section-slash {
  font-family: var(--display);
  font-weight: 800;
  font-size: 2.4rem;
  color: var(--accent);
  line-height: 0.85;
  margin: 0 -0.15rem;
  transform: translateY(2px) skewX(-8deg);
  text-shadow: 0 0 14px var(--accent-glow);
}

.section-title {
  font-family: var(--display);
  font-weight: 800;
  font-size: 1.85rem;
  letter-spacing: -0.005em;
  line-height: 0.85;
  color: var(--text);
  text-transform: uppercase;
  transform: translateY(2px);
}

.setting-rows {
  display: flex;
  flex-direction: column;
}

.setting-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 2.6rem;
  padding: 1.35rem 0.6rem 1.35rem 0.2rem;
  border-bottom: 1px solid var(--hairline);
  position: relative;
  transition: background 200ms ease;
}
.setting-row:last-child { border-bottom: none; }
.setting-row:hover { background: var(--surface); }

.setting-row::before {
  /* Subtle left tick that brightens on hover — feels like a config
     row in an old terminal config screen. */
  content: '';
  position: absolute;
  left: -10px; top: 50%;
  transform: translateY(-50%);
  width: 4px; height: 4px;
  background: var(--border);
  border-radius: 50%;
  transition: background 200ms ease, box-shadow 200ms ease;
}

.setting-row:hover::before {
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent-glow);
}

.setting-info { min-width: 0; }

.setting-label {
  font-family: var(--display);
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.005em;
  text-transform: uppercase;
  color: var(--text);
  margin-bottom: 0.3rem;
  line-height: 1;
}

.setting-desc {
  font-size: 0.83rem;
  color: var(--text-dim);
  line-height: 1.5;
  max-width: 56ch;
}

.setting-desc strong {
  color: var(--text);
  font-weight: 600;
}

.setting-desc code {
  font-family: var(--mono);
  font-size: 0.78rem;
  background: var(--surface-3);
  padding: 0.05rem 0.35rem;
  border-radius: 2px;
  color: var(--accent-text);
}

.setting-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.55rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  letter-spacing: 0.04em;
  font-feature-settings: "tnum";
}

.meta-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--win);
  box-shadow: 0 0 8px var(--win-line);
  animation: pulse-dot 2.4s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.85); }
}

.setting-control {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.55rem;
  min-width: 0;
}

.setting-value {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text-dim);
  letter-spacing: 0;
  text-align: right;
  word-break: break-all;
  max-width: 420px;
  padding: 0.35rem 0.7rem;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
}

/* ─── Big switch (settings-page toggle) ──────────────────── */

.big-switch {
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
  cursor: pointer;
  user-select: none;
  position: relative;
}

.big-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 0; height: 0;
}

.big-switch-track {
  position: relative;
  width: 56px; height: 30px;
  border-radius: 999px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  transition: background 240ms ease, border-color 240ms ease, box-shadow 240ms ease;
}

.big-switch-knob {
  position: absolute;
  top: 2px; left: 2px;
  width: 24px; height: 24px;
  border-radius: 50%;
  background: var(--text-faint);
  transition:
    transform 260ms cubic-bezier(0.4, 0.0, 0.2, 1),
    background 240ms ease,
    box-shadow 240ms ease;
}

.big-switch.on .big-switch-track {
  background: var(--accent-soft);
  border-color: var(--accent);
  box-shadow: 0 0 18px -2px var(--accent-glow);
}

.big-switch.on .big-switch-track .big-switch-knob {
  transform: translateX(26px);
  background: var(--accent);
  box-shadow: 0 0 14px var(--accent-glow);
}

.big-switch-state {
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--text-faint);
  min-width: 3.6rem;
  transition: color 220ms ease;
}

.big-switch.on .big-switch-state {
  color: var(--accent);
}

.big-switch:focus-within .big-switch-track {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft), 0 0 18px -2px var(--accent-glow);
}

/* ─── Primary button — big variant for the Settings parse CTA ─ */

.btn.primary.big {
  padding: 0.85rem 1.4rem;
  font-size: 0.85rem;
  letter-spacing: 0.06em;
}

.btn.primary.big .btn-dot {
  width: 7px; height: 7px;
}

/* ─── System Alert banner ────────────────────────────────────
   Shown when Tesseract isn't usable. Hazard-tape stripes on the left
   read as caution without going full red — the brand-gray body keeps
   it from screaming, while the loss-color edge + dot + CTA make it
   clear something is broken. */

@keyframes alert-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 1px var(--loss) inset, 0 14px 36px -14px rgb(0 0 0 / 55%), 0 0 0 0 var(--loss-soft); }
  50%      { opacity: 1; box-shadow: 0 0 0 1px var(--loss) inset, 0 14px 36px -14px rgb(0 0 0 / 55%), 0 0 0 6px transparent; }
}

@keyframes alert-icon-pulse {
  0%, 100% { transform: scale(1); filter: drop-shadow(0 0 0 var(--loss)); }
  50%      { transform: scale(1.08); filter: drop-shadow(0 0 8px var(--loss)); }
}

.system-alert {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1.2rem;
  padding: 1rem 1.2rem 1rem 1.4rem;
  margin-bottom: 1.6rem;
  background: linear-gradient(180deg, var(--brand-gray) 0%, #3a3a3a 100%);
  border-radius: 2px;
  border: 1px solid var(--loss);
  box-shadow: 0 14px 36px -14px rgb(0 0 0 / 55%), 0 0 0 0 var(--loss-soft);
  overflow: hidden;
  isolation: isolate;
  animation: alert-pulse 2.6s ease-in-out infinite;
}

.system-alert::before {
  /* Solid loss bar down the left edge — the "alarm strip". */
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 6px;
  background: var(--loss);
  box-shadow: 0 0 14px var(--loss-line);
}

.system-alert-stripes {
  /* Hazard-tape diagonal stripes layered just inside the alarm strip.
     Sits behind everything else, masked to fade into the body so the
     pattern reads as a tag/seal rather than wallpaper. */
  position: absolute;
  left: 6px; top: 0; bottom: 0;
  width: 110px;
  background:
    repeating-linear-gradient(
      -45deg,
      rgb(255 90 115 / 22%) 0 10px,
      transparent 10px 22px
    );
  mask-image: linear-gradient(90deg, black 0%, black 38%, transparent 100%);
  z-index: -1;
  pointer-events: none;
}

.system-alert-icon {
  color: var(--loss);
  animation: alert-icon-pulse 2.4s ease-in-out infinite;
  width: 26px; height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 0.2rem;
}

.system-alert-body {
  min-width: 0;
}

.system-alert-eyebrow {
  font-family: var(--mono);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--loss);
  margin-bottom: 0.3rem;
}

.system-alert-title {
  font-family: var(--display);
  font-weight: 800;
  font-size: 1.3rem;
  letter-spacing: -0.005em;
  line-height: 1.05;
  text-transform: uppercase;
  color: #f5f3ee;
  margin-bottom: 0.35rem;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.system-alert-path {
  font-family: var(--mono);
  font-size: 0.78rem;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: #f5f3ee;
  background: rgb(0 0 0 / 40%);
  padding: 0.15rem 0.45rem;
  border-radius: 2px;
  word-break: break-all;
  border: 1px solid rgb(255 255 255 / 8%);
}

.system-alert-desc {
  font-size: 0.83rem;
  color: rgb(245 243 238 / 78%);
  line-height: 1.5;
  max-width: 64ch;
}

.system-alert-actions { display: flex; flex-shrink: 0; }

.btn.alert-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  background: var(--loss);
  color: #1a0608;
  border: 1px solid var(--loss);
  padding: 0.65rem 1rem;
  font-family: var(--body);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-radius: 2px;
  cursor: pointer;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 25%) inset, 0 6px 22px -8px var(--loss-line);
  transition: transform 140ms ease, filter 140ms ease;
}
.btn.alert-cta:hover { filter: brightness(1.08); transform: translateY(-1px); }

.alert-cta-arrow {
  font-family: var(--display);
  font-weight: 900;
  font-size: 1.1rem;
  transition: transform 200ms ease;
}
.btn.alert-cta:hover .alert-cta-arrow { transform: translateX(3px); }

[data-theme="light"] .system-alert {
  background: linear-gradient(180deg, var(--brand-gray) 0%, #3a3a3a 100%);

  /* Stays dark in light mode — system alerts feel right as a dark
     overlay regardless of theme (think "warning sticker"). */
}

/* ─── Engine status panel (Ingest → 01 / Engine) ───────── */

.engine-row { transition: background 220ms ease; }
.engine-row.alert { background: var(--loss-soft); }
.engine-row.alert::before { background: var(--loss); box-shadow: 0 0 10px var(--loss-line); }

.engine-status {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.7rem;
  padding: 0.45rem 0.7rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  max-width: 100%;
}
.engine-status.ok    { border-color: var(--win-line); background: var(--win-soft); }
.engine-status.fail  { border-color: var(--loss-line); background: var(--loss-soft); }

.engine-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
  flex-shrink: 0;
}

.engine-status.ok .engine-dot {
  background: var(--win);
  box-shadow: 0 0 10px var(--win-line);
  animation: pulse-dot 2.4s ease-in-out infinite;
}

.engine-status.fail .engine-dot {
  background: var(--loss);
  box-shadow: 0 0 10px var(--loss-line);
  animation: pulse-dot 1.4s ease-in-out infinite;
}

.engine-state {
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}
.engine-status.ok .engine-state   { color: var(--win); }
.engine-status.fail .engine-state { color: var(--loss); }

/* ── Version block (masthead bottom-right) ──────────────────────────────── */
.ver-block {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.35rem;
}

.app-version {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  font-feature-settings: "tnum";
  user-select: none;
}

/* Shared button/label shell — consistent shape whether clickable or not */
.ver-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-feature-settings: "tnum";
  padding: 0.22rem 0.55rem;
  border-radius: 2px;
  border: 1px solid;
  line-height: 1;
  white-space: nowrap;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
}

/* Dev build: informational link to latest release */
.ver-btn-dev {
  background: transparent;
  border-color: var(--border);
  color: var(--text-faint);
  cursor: pointer;
}

.ver-btn-dev:hover {
  border-color: var(--border-strong);
  color: var(--text-dim);
  background: var(--surface-2);
}

/* Update available: orange call-to-action */
.ver-btn-update {
  background: transparent;
  border-color: var(--accent);
  color: var(--accent);
  cursor: pointer;
  box-shadow: 0 0 8px -3px var(--accent-glow);
}

.ver-btn-update:hover {
  background: var(--accent);
  color: #1a0a00;
  box-shadow: 0 0 14px -3px var(--accent-glow);
}

/* Up to date: non-interactive status label */
.ver-btn-current {
  background: transparent;
  border-color: var(--win-line);
  color: var(--win);
  cursor: default;
  user-select: none;
}

.engine-version {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-dim);
  padding: 0.1rem 0.4rem;
  background: var(--surface-3);
  border-radius: 2px;
  font-feature-settings: "tnum";
}

.engine-path {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--text-dim);
  word-break: break-all;
  letter-spacing: 0;
  flex: 1 1 auto;
  min-width: 0;
}

.engine-error {
  margin-top: 0.55rem;
  font-family: var(--body);
  font-size: 0.82rem;
  color: var(--loss);
  line-height: 1.5;
  max-width: 60ch;
}

.engine-meta {
  margin-top: 0.55rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}

.engine-meta code {
  font-family: var(--mono);
  font-size: 0.7rem;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  padding: 0.05rem 0.35rem;
  border-radius: 2px;
  color: var(--text-dim);
}

.engine-control {
  align-items: flex-end;
}

.engine-unsupported-warn {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin-top: 0.6rem;
  padding: 0.6rem 0.85rem;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  border-radius: 3px;
  font-family: var(--body);
  font-size: 0.8rem;
  color: color-mix(in srgb, var(--accent) 80%, var(--text));
  line-height: 1.55;
  max-width: 60ch;
}

.engine-unsupported-warn .warn-icon {
  flex-shrink: 0;
  margin-top: 0.12rem;
  color: var(--accent);
}

/* Modal overlay */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgb(0 0 0 / 72%);
  backdrop-filter: blur(4px);
}

.modal-box {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 2rem 2.2rem 1.6rem;
  max-width: 420px;
  width: calc(100% - 3rem);
  box-shadow: 0 24px 60px rgb(0 0 0 / 60%);
}

.modal-icon {
  color: var(--accent);
  margin-bottom: 0.9rem;
}

.modal-title {
  font-family: var(--display);
  font-size: 1.1rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text);
  margin: 0 0 0.9rem;
}

.modal-body {
  font-family: var(--body);
  font-size: 0.88rem;
  color: var(--text-dim);
  line-height: 1.6;
  margin: 0 0 0.6rem;
}

.modal-body strong {
  color: var(--text);
}

.modal-caution {
  color: color-mix(in srgb, var(--accent) 75%, var(--text-dim));
  font-style: italic;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

/* Inline button styled as a text-link — used in the "Use default" cue. */
.link-btn {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  font: inherit;
  color: var(--accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-thickness: 1px;
  text-decoration-color: var(--accent-soft);
  transition: text-decoration-color 200ms ease, color 200ms ease;
}

.link-btn:hover {
  text-decoration-color: var(--accent);
}
[data-theme="light"] .link-btn { color: var(--accent-text); }
[data-theme="light"] .link-btn:hover { text-decoration-color: var(--accent-text); }

/* Disabled state for big-switch (used by Watch when Tesseract is missing). */
.big-switch.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.big-switch.disabled .big-switch-track { background: var(--surface-2); border-color: var(--border); }
.big-switch.disabled .big-switch-knob { background: var(--text-mute); box-shadow: none; }

/* "Blocked — needs Tesseract" meta line under Watch / Manual Parse
   when those controls are gated. */
.setting-meta.blocked {
  color: var(--loss);
}

.block-mark {
  font-size: 0.85rem;
  margin-right: 0.15rem;
  filter: saturate(0.85);
}

.settings-heading.missing em {
  color: var(--loss);
  background: var(--loss-soft);
}
[data-theme="light"] .settings-heading.missing em { color: var(--loss); }

/* ─── Empty-state inline links ───────────────────────────── */

.empty-link {
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  transition: border-color 160ms ease, color 160ms ease;
}
.empty-link:hover { border-bottom-color: var(--accent); }
[data-theme="light"] .empty-link { color: var(--accent-text); }
[data-theme="light"] .empty-link:hover { border-bottom-color: var(--accent-text); }

/* ─── Responsive ─────────────────────────────────────────── */

@media (width <= 880px) {
  .brand { font-size: 2.4rem; }
  .score-num { font-size: 2rem; }
  .scoreboard { gap: 1rem; }
  .filter-grid { grid-template-columns: repeat(3, 1fr); }
  .stats { grid-template-columns: repeat(3, 1fr); }
  .stat:nth-child(3) { border-right: none; }
  .stat:nth-child(n+4) { border-top: 1px solid var(--border); }
}

@media (width <= 580px) {
  .container { padding: 1.4rem 1rem 3rem; }
  .masthead { flex-direction: column; align-items: flex-start; }
  .masthead-right { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; gap: 0.6rem; }
  .brand { font-size: 2.1rem; }
  .filter-grid { grid-template-columns: repeat(2, 1fr); }
  .stats { grid-template-columns: repeat(2, 1fr); }
  .stat { border-right: 1px solid var(--border) !important; }
  .stat:nth-child(2n) { border-right: none !important; }
  .match-title-rhs { flex-wrap: wrap; }
  .match-map { font-size: 1.3rem; }
  .setting-row { grid-template-columns: 1fr; gap: 0.85rem; }
  .setting-control { align-items: flex-start; }
  .setting-value { text-align: left; }
  .section-num { font-size: 2.4rem; }
  .section-title { font-size: 1.5rem; }
  .settings-heading { font-size: 1.5rem; }
}

/* ─── Light-mode pinpoint overrides ──────────────────────────
   Spots where the OW orange appears as readable type on a light
   surface need the darker `--accent-text` variant to clear AA contrast.
   Everything else in light mode flows through the variable swap. */
[data-theme="light"] .match-map:hover,
[data-theme="light"] .match-map.active { color: var(--accent-text); text-shadow: none; }
[data-theme="light"] .hero-name { color: var(--accent-text); }

[data-theme="light"] .hero-name:hover,
[data-theme="light"] .hero-name.active { color: var(--accent-text); text-shadow: none; }
[data-theme="light"] .empty-sub strong { color: var(--accent-text); }
[data-theme="light"] .count strong { color: var(--accent-text); }
[data-theme="light"] .chev.open { color: var(--accent-text); }
[data-theme="light"] .length-mark { color: var(--accent-text); }
[data-theme="light"] .control-deck { background: linear-gradient(180deg, var(--surface) 0%, var(--surface-2) 100%); }
[data-theme="light"] .control-deck::before { opacity: 1; }
[data-theme="light"] .match.expanded { background: var(--surface-2); }
[data-theme="light"] .stats { background: var(--surface); }
[data-theme="light"] .stat { background: var(--surface); }

/* The sources block is dim/console-y in dark mode; in light mode soften
   the inner dark background to a clean tonal step that still reads
   "monospace dossier" without the harsh black-on-light contrast. */
[data-theme="light"] .sources { background: var(--surface-2); border-color: var(--border); }
[data-theme="light"] .source-name { color: var(--text-dim); }
[data-theme="light"] .source-name:hover { color: var(--accent-text); background: var(--surface-3); }
[data-theme="light"] .source-preview { background: var(--surface-3); }

/* Brand wordmark on the gray tile stays white-on-gray in both modes —
   the tile is dark in both themes, so no override needed. The corner
   tape stays subtle. */
[data-theme="light"] .brand { color: #f5f3ee; }

/* Theme toggle reads on light surface too. The .active state already
   uses --accent-soft + --accent which both adapt to the theme. */
[data-theme="light"] .theme-toggle { background: var(--surface); }

[data-theme="light"] .btn.primary {
  /* In light mode the dark text on bright orange still works (OW chip).
     Make it pop a touch more with a deeper shadow. */
  box-shadow: 0 0 0 1px rgb(0 0 0 / 20%) inset, 0 6px 22px -10px var(--accent-glow);
}

[data-theme="light"] .btn.primary:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(0.95);
}

/* Multi-filter light-mode polish. The hazard strip in the panel head
   stays dark in both themes (industrial sticker feel). Trigger surface
   needs slightly more contrast against the cream page background. */
[data-theme="light"] .mf-trigger { background: var(--surface); }

[data-theme="light"] .mf-trigger:hover,
[data-theme="light"] .multi-filter.open .mf-trigger { background: var(--surface-2); }
[data-theme="light"] .mf-placeholder { color: var(--text-faint); }
[data-theme="light"] .mf-row.checked { background: var(--accent-soft); color: var(--text); }
[data-theme="light"] .mf-row-mark { background: #fff; }

[data-theme="light"] .mf-panel {
  box-shadow:
    0 24px 60px -18px rgb(74 74 74 / 45%),
    0 0 0 1px var(--accent-soft);
}
[data-theme="light"] .mf-search { background: var(--surface-3); }
[data-theme="light"] .mf-panel-foot { background: var(--surface-3); }
[data-theme="light"] .eyebrow-count { color: var(--accent-text); }

/* ─── Parse progress panel ───────────────────────────────── */

.parse-progress-panel {
  grid-column: 1 / -1;
  margin-top: 0.85rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: 3px;
  background: var(--surface-2);
  overflow: hidden;
  animation: view-fade-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

/* Summary row: scanning label + bar + fraction + chevron. Clickable. */
.pp-summary {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  cursor: pointer;
  user-select: none;
  transition: background 120ms ease;
}

.pp-summary:hover { background: var(--surface-3); }

.parse-progress-panel.pp-open .pp-summary {
  border-bottom: 1px solid var(--border-soft);
}

.pp-chev {
  font-size: 1rem;
  color: var(--text-faint);
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1), color 120ms ease;
  flex-shrink: 0;
}

.pp-chev.open {
  transform: rotate(90deg);
  color: var(--accent-text);
}

.pp-scan-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.pp-scan-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent-glow);
  animation: pulse-dot 1.2s ease-in-out infinite;
}

.pp-scan-text {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent-text);
  font-weight: 600;
}

.pp-bar-track {
  height: 3px;
  background: var(--surface-3);
  border-radius: 2px;
  overflow: hidden;
  min-width: 0;
}

.pp-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  box-shadow: 0 0 8px var(--accent-glow);
  transition: width 400ms cubic-bezier(0.4, 0, 0.2, 1);
}

.pp-fraction {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  letter-spacing: 0.03em;
  white-space: nowrap;
  font-feature-settings: "tnum";
}

.pp-done { color: var(--accent-text); font-weight: 600; }
.pp-sep  { color: var(--text-faint); }
.pp-unit { color: var(--text-faint); margin-left: 0.3rem; }

/* Current file row */
.pp-current {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 0.35rem 0.65rem;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid var(--border-soft);
}

.pp-arrow {
  font-size: 0.6rem;
  color: var(--accent);
  margin-top: 0.1rem;
  flex-shrink: 0;
  animation: pulse-dot 1s ease-in-out infinite;
}

.pp-cur-filename {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text);
  letter-spacing: 0.01em;
  flex-shrink: 0;
  max-width: 36ch;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-type-badge {
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 0.1rem 0.4rem;
  border-radius: 2px;
  border: 1px solid transparent;
  flex-shrink: 0;
}

.pp-type-badge.summary  { background: var(--accent-soft); border-color: var(--accent-glow); color: var(--accent-text); }
.pp-type-badge.scoreboard { background: var(--tank-soft); border-color: var(--tank); color: var(--tank); }
.pp-type-badge.personal { background: var(--support-soft); border-color: var(--support); color: var(--support); }
.pp-type-badge.rank     { background: var(--draw-soft); border-color: var(--draw-line); color: var(--draw); }
.pp-type-badge.unknown  { background: transparent; border-color: var(--border); color: var(--text-faint); border-style: dashed; }

[data-theme="light"] .pp-type-badge.scoreboard { color: var(--tank); }
[data-theme="light"] .pp-type-badge.personal   { color: var(--support); }
[data-theme="light"] .pp-type-badge.rank        { color: var(--draw); }

.pp-cur-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  width: 100%;
  padding-left: 1rem;
}

/* Extracted field chips: "label value" */
.pp-field {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  font-size: 0.7rem;
  font-family: var(--mono);
}

.pp-fl {
  color: var(--text-faint);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.pp-fv {
  color: var(--text);
  font-weight: 500;
}

.pp-field.victory .pp-fv { color: var(--win); }
.pp-field.defeat  .pp-fv { color: var(--loss); }
.pp-field.draw    .pp-fv { color: var(--draw); }

/* Completed files log */
.pp-log {
  max-height: 140px;
  overflow-y: auto;
  padding: 0.3rem 0;
}

.pp-log-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.22rem 1rem;
  transition: background 120ms ease;
}

.pp-log-entry:hover { background: var(--surface-3); }

.pp-log-check {
  font-size: 0.62rem;
  color: var(--win);
  flex-shrink: 0;
  opacity: 0.7;
}

.pp-log-filename {
  font-family: var(--mono);
  font-size: 0.68rem;
  color: var(--text-dim);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-log-type {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.07em;
  color: var(--text-faint);
  flex-shrink: 0;
}

.pp-log-type.summary   { color: var(--accent-text); }
.pp-log-type.scoreboard { color: var(--tank); }
.pp-log-type.personal  { color: var(--support); }
.pp-log-type.rank      { color: var(--draw); }

[data-theme="light"] .pp-log-type.scoreboard { color: var(--tank); }
[data-theme="light"] .pp-log-type.personal   { color: var(--support); }
[data-theme="light"] .pp-log-type.rank        { color: var(--draw); }

/* The parse progress panel needs to span both grid columns of setting-row */
.setting-row .parse-progress-panel {
  grid-column: 1 / -1;
}

/* ─── Unknown Maps View ──────────────────────────────────── */

/* The heading em uses the draw/amber color — "attention, not alarm" */
.unknown-heading em {
  color: var(--draw);
  background: var(--draw-soft);
  font-style: normal;
  padding: 0 0.25rem;
  margin: 0 -0.05rem;
  border-radius: 1px;
}
[data-theme="light"] .unknown-heading em { color: var(--draw); }

.unknown-desc {
  margin-top: 0.65rem;
  color: var(--text-dim);
  font-size: 0.875rem;
  line-height: 1.6;
  max-width: 64ch;
}

.unknown-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-top: 1.6rem;
}

/* Each unknown record is a card with an amber left bar */
.unknown-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface);
  overflow: hidden;
  transition: border-color 180ms ease, background 180ms ease;
}

.unknown-card::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--draw-line);
}

.unknown-card.expanded {
  border-color: var(--border-strong);
  background: var(--surface-2);
}

/* Card header row */
.unknown-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 1rem 0.8rem 1.4rem;
  cursor: pointer;
  user-select: none;
  transition: background 140ms ease;
}

.unknown-card-head:hover { background: var(--surface-2); }
.unknown-card.expanded .unknown-card-head { background: transparent; }

.unknown-head-lhs {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
  flex: 1;
}

.unknown-idx {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-faint);
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

.unknown-key-block {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.unknown-key {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}

.unknown-src-count {
  font-size: 0.69rem;
  color: var(--text-faint);
}

.unknown-head-rhs {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-shrink: 0;
}

/* Screenshot type slot chips: SUMMARY · TEAMS · PERSONAL · RANK */
.slot-row {
  display: flex;
  gap: 0.3rem;
  flex-wrap: nowrap;
}

.slot-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.18rem 0.45rem;
  border-radius: 2px;
  font-size: 0.62rem;
  font-family: var(--mono);
  font-weight: 600;
  letter-spacing: 0.07em;
  border: 1px solid transparent;
  white-space: nowrap;
  cursor: default;
  transition: opacity 150ms ease;
}

.slot-chip.present {
  background: var(--win-soft);
  border-color: var(--win-line);
  color: var(--win);
}

.slot-chip.absent {
  background: transparent;
  border-color: var(--border);
  border-style: dashed;
  color: var(--text-faint);
}

/* A required screenshot type that wasn't captured — louder than `absent` so
   the user notices the diagnostic at a glance in the expanded panel. */
.slot-chip.absent-required {
  background: rgb(245 166 35 / 6%);
  border-color: rgb(245 166 35 / 50%);
  color: var(--accent-bright);
}

/* The RANK slot is optional; even when missing it shouldn't read as a
   warning. Greyed out, no urgency. */
.slot-chip.optional.absent {
  background: transparent;
  border-color: var(--border-soft);
  color: var(--text-mute);
}

.slot-optional-tag {
  margin-left: 0.25rem;
  padding: 0 0.25rem;
  border-radius: 1px;
  font-size: 0.52rem;
  letter-spacing: 0.1em;
  background: rgb(255 255 255 / 5%);
  color: var(--text-mute);
  text-transform: uppercase;
}

.slot-chip.present .slot-optional-tag {
  background: rgb(77 255 142 / 12%);
  color: var(--win);
}

[data-theme="light"] .slot-chip.present { color: var(--win); }
[data-theme="light"] .slot-chip.absent { color: var(--text-faint); }
[data-theme="light"] .slot-chip.absent-required { color: var(--accent-text); }

.slot-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentcolor;
  flex-shrink: 0;
}

/* Field diagnostic strip — 8-column grid showing each parsed field */
.unknown-fields {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  border-top: 1px solid var(--border-soft);
  padding: 0 1rem 0 1.4rem;
}

.field-cell {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.5rem 0.5rem 0.5rem 0;
  border-right: 1px solid var(--border-soft);
}

.field-cell:last-child { border-right: none; }

.field-label {
  font-size: 0.6rem;
  font-family: var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  line-height: 1;
}

.field-value {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.field-cell.filled .field-label { color: var(--text-dim); }
.field-cell.filled .field-value { color: var(--text); }

.field-cell.vacant .field-value {
  font-style: italic;
  font-size: 0.72rem;
}

/* Expanded section: sources + stats */
.unknown-expanded {
  border-top: 1px solid var(--border-soft);
  padding: 1rem 1.4rem;
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.unknown-sources {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.unknown-sources .block-eyebrow {
  margin-bottom: 0.45rem;
}

.unknown-stats .block-eyebrow {
  margin-bottom: 0.6rem;
}

/* ─── Nav tab notification badge ─────────────────────────── */
.nav-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  background: var(--draw);
  color: #1a1100;
  font-size: 0.58rem;
  font-weight: 700;
  font-family: var(--mono);
  border-radius: 8px;
  line-height: 1;
  vertical-align: middle;
  margin-left: 0.2rem;
  letter-spacing: 0;
}

/* Small accent dot beside the Matches tab label when filters are
   active on another view — reminds the user that the list they'll
   see when they return is filtered. */
.nav-tab-filter-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 0.45rem;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
  vertical-align: middle;
}

[data-theme="light"] .nav-tab-filter-dot {
  background: var(--accent-text);
  box-shadow: none;
}

/* ─── Unknown view responsive ────────────────────────────── */
@media (width <= 880px) {
  .unknown-fields { grid-template-columns: repeat(4, 1fr); }
}

@media (width <= 680px) {
  /* Unknown-card header is horizontally tight — hide all but the first
     two slot chips there. The coverage-block in expanded match cards
     gets its own stacked layout, so it isn't scoped here. */
  .unknown-card-head .slot-chip { display: none; }
  .unknown-card-head .slot-chip:nth-child(-n+2) { display: inline-flex; }
}

@media (width <= 580px) {
  .unknown-fields {
    grid-template-columns: repeat(2, 1fr);
    padding: 0 1rem;
  }
  .unknown-card-head { padding: 0.7rem 1rem; }
  .unknown-expanded { padding: 0.85rem 1rem; }
}
</style>
