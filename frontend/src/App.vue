<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
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
} from './api.js'

const records = ref([])
const error = ref('')
const loading = ref(false)

// Parse progress: the most-recently-completed file during an active parse.
// null when no parse is running.
const parseProgress = ref(null)
// Rolling log of completed files during the current parse (up to 50).
const parseLog = ref([])
// Count of image files in the screenshots dir not yet in the database.
// null = not yet fetched; 0 = all parsed; >0 = new files waiting.
const newScreenshotCount = ref(null)

// Which top-level view is shown: 'matches' (default — filter rail +
// match cards) or 'settings' (config sections — directory, watch,
// parse, Grafana export). Switched via the masthead nav tabs.
const view = ref('matches')

// Wall-clock time of the last successful manual parse, used to render
// "Last run · X ago" feedback under the Parse button on the settings
// page. Persisted to localStorage so the timestamp survives reloads.
const lastParsedAt = ref(null)

// Tesseract status — mirrors the Go side's TesseractStatus struct.
// When .found is false, a System Alert banner blocks the main views
// and Parse/Watch controls disable themselves. Refreshed on mount and
// after every path-changing call.
const tesseractStatus = ref({ path: '', found: false, version: '', error: '', default: '' })
const tesseractReady = computed(() => !!tesseractStatus.value?.found)
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

// Filter state — every field is now an array. Empty array means "no
// filter for this field"; multiple entries mean "match any of these"
// (set-union, not intersection). Migrated from single-string refs so
// the user can stack picks like "Aatlis + Rialto + Numbani" or
// "Tank OR Support" in one query.
const filterMode   = ref([])
const filterType   = ref([])
const filterRole   = ref([])
const filterMap    = ref([])
const filterHero   = ref([])
const filterResult = ref([])

// Which filter popover is currently open (one at a time). Set to the
// field name ("mode", "map", ...) when a trigger is clicked; cleared
// on outside-click, ESC, or selection of "Done".
const openFilter = ref('')

// Per-popover search query, keyed by field. Used for the Map and Hero
// rosters which can be long; smaller fields ignore it but the input
// is hidden anyway when option count < 8.
const filterSearch = ref({ mode: '', type: '', role: '', map: '', hero: '', result: '' })

// Date/time range filter. Both bound to <input type="datetime-local">,
// which emits "YYYY-MM-DDTHH:MM" — the same shape as matchTime(rec),
// so direct string comparison gives correct chronological ordering.
const filterFrom = ref('')
const filterTo   = ref('')

// 'desc' = newest first; 'asc' = oldest first.
const sortDir = ref('desc')

// Per-card expand/collapse state. Object keyed by record id; truthy =
// expanded. Plain object (not a Set) so Vue's reactivity sees each
// toggle naturally without needing to reassign the whole container.
const expanded = ref({})

// Map filter-field names to the ref they're stored in. Lets a single
// toggleFilter() handler power every clickable badge instead of one
// per field.
const filterRefs = {
  mode:   filterMode,
  type:   filterType,
  role:   filterRole,
  map:    filterMap,
  hero:   filterHero,
  result: filterResult,
}

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

// Jump to the Settings view and scroll the Engine section into view.
// Wired from the System Alert banner's "Fix in Settings →" CTA and
// from the empty-state shortcut.
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
async function toggleWatch(e) {
  const next = e.target.checked
  if (next && !tesseractReady.value) {
    e.target.checked = false
    error.value = 'Configure Tesseract in Settings → Engine before enabling Watch.'
    return
  }
  try {
    await SetWatchEnabled(next)
    watchEnabled.value = next
  } catch (err) {
    error.value = String(err)
    e.target.checked = watchEnabled.value
  }
}

// Toggle the Prometheus endpoint. We call the Go method first so the
// persisted setting drives both the actual server lifecycle and the UI
// state; if the call fails, fall back to the previous local value.
async function togglePrometheus(e) {
  const next = e.target.checked
  try {
    await SetPrometheusEnabled(next)
    prometheusEnabled.value = next
  } catch (err) {
    error.value = String(err)
    e.target.checked = prometheusEnabled.value
  }
}

async function parse() {
  if (!tesseractReady.value) {
    error.value = 'Tesseract is not configured. Fix it in Settings → Engine.'
    return
  }
  error.value = ''
  loading.value = true
  parseProgress.value = null
  parseLog.value = []
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

// Lightweight relative-time formatter for the "Last run" hint on
// Settings. Not reactive to wall-clock ticks — re-renders happen
// naturally on view/state changes, and stale "2 minutes ago" labels
// on an idle Settings screen aren't worth a setInterval.
function formatRelativeTime(ms) {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000)
    return m === 1 ? '1 minute ago' : `${m} minutes ago`
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000)
    return h === 1 ? '1 hour ago' : `${h} hours ago`
  }
  const d = Math.floor(diff / 86_400_000)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

// Open the native folder picker via Wails. The Go side persists the
// choice so subsequent app launches pick up the same directory; we
// just need to refresh our local mirror.
async function pickDir() {
  try {
    const dir = await PickScreenshotsDir()
    if (dir) screenshotsDir.value = dir
    await refreshNewCount()
  } catch (e) {
    error.value = String(e)
  }
}

function uniqueValues(field) {
  const set = new Set()
  for (const r of records.value) {
    const v = r.data?.[field]
    if (v) set.add(v)
  }
  return [...set].sort()
}

const modes   = computed(() => uniqueValues('mode'))
const types   = computed(() => uniqueValues('type'))
const roles   = computed(() => uniqueValues('role'))
const maps    = computed(() => uniqueValues('map'))
const results = computed(() => uniqueValues('result'))

// Heroes need a custom collector — uniqueValues('hero') would only pick
// up the primary/most-played hero on each row. For multi-hero matches
// (e.g. Rialto with Wuyang/Juno/Kiriko) the secondaries live in
// heroes_played[]. We union both sources so every hero the user has
// actually played shows up in the dropdown.
const heroes = computed(() => {
  const set = new Set()
  for (const r of records.value) {
    if (r.data?.hero) set.add(r.data.hero)
    for (const hp of (r.data?.heroes_played || [])) {
      if (hp.hero) set.add(hp.hero)
    }
  }
  return [...set].sort()
})

const filtered = computed(() =>
  records.value.filter(r => {
    const d = r.data || {}
    if (!d.map) return false
    if (filterMode.value.length   && !filterMode.value.includes(d.mode))     return false
    if (filterType.value.length   && !filterType.value.includes(d.type))     return false
    if (filterRole.value.length   && !filterRole.value.includes(d.role))     return false
    if (filterMap.value.length    && !filterMap.value.includes(d.map))       return false
    if (filterResult.value.length && !filterResult.value.includes(d.result)) return false
    // Hero filter matches the primary hero OR any hero in heroes_played,
    // so picking a secondary hero like Juno (47%-second-fiddle on
    // Rialto) still surfaces that match. With multi-select, ANY of the
    // chosen heroes need to match — union, not intersection.
    if (filterHero.value.length) {
      const picks = filterHero.value
      const inPrimary   = picks.includes(d.hero)
      const inSecondary = (d.heroes_played || []).some(hp => picks.includes(hp.hero))
      if (!inPrimary && !inSecondary) return false
    }
    // Date/time range. When either bound is set, require an EXPLICIT
    // datetime on the row — date + finished_at, both from the SUMMARY
    // screen. The match_key fallback used by matchTime() (derived from
    // screenshot filename) is too approximate to count as the match's
    // real time, so rows that only have that estimate are excluded
    // from date-range queries to match the card UI's behavior of not
    // displaying a datetime for those rows.
    if (filterFrom.value || filterTo.value) {
      if (!d.date || !d.finished_at) return false
      const t = `${d.date}T${d.finished_at}`
      if (filterFrom.value && t < filterFrom.value) return false
      if (filterTo.value   && t > filterTo.value)   return false
    }
    return true
  })
)

// matchTime returns a sortable string for a record. Prefers SUMMARY's
// date + finished_at (most accurate); falls back to the match_key prefix
// (set from the earliest screenshot's filename) when SUMMARY isn't present.
function matchTime(rec) {
  const d = rec.data || {}
  if (d.date && d.finished_at) return `${d.date}T${d.finished_at}`
  const m = (rec.match_key || '').match(/^match:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
  return m ? m[1] : ''
}

const filteredSorted = computed(() => {
  const list = [...filtered.value]
  const dir = sortDir.value === 'asc' ? 1 : -1
  list.sort((a, b) => {
    const ta = matchTime(a), tb = matchTime(b)
    if (ta < tb) return -1 * dir
    if (ta > tb) return  1 * dir
    return 0
  })
  return list
})

function toggleSort() {
  sortDir.value = sortDir.value === 'desc' ? 'asc' : 'desc'
}

// toggleFilter toggles `value` in or out of the field's array filter.
// Called from match-card badges and from the popover checkbox rows;
// the same operation in both places means clicking a Rialto chip
// twice removes Rialto.
function toggleFilter(field, value) {
  if (!value) return
  const r = filterRefs[field]
  if (!r) return
  const arr = r.value
  const i = arr.indexOf(value)
  if (i >= 0) r.value = arr.filter((_, j) => j !== i)
  else        r.value = [...arr, value]
}

function isActive(field, value) {
  const r = filterRefs[field]
  return !!(r && r.value.includes(value))
}

// Bulk popover actions.
function selectAllFilter(field, options) {
  const r = filterRefs[field]
  if (!r) return
  r.value = [...options]
}
function clearFilterField(field) {
  const r = filterRefs[field]
  if (!r) return
  r.value = []
}

function clearFilters() {
  filterMode.value   = []
  filterType.value   = []
  filterRole.value   = []
  filterMap.value    = []
  filterHero.value   = []
  filterResult.value = []
  filterFrom.value   = ''
  filterTo.value     = ''
  openFilter.value   = ''
}

// Clear just the date-range filter (separate from clearFilters which
// resets everything). Useful because the native datetime-local picker
// on macOS doesn't have a built-in way to set the value back to empty
// once you've selected something.
function resetDateRange() {
  filterFrom.value = ''
  filterTo.value   = ''
}

// Bounds for the date pickers. min = the earliest match the user has
// (so picking earlier than that is meaningless — nothing exists to
// match), max = right now (no future dates can have matches yet).
// Only matches with explicit date + finished_at count toward the min,
// because those are the only ones that ever pass the date filter
// anyway (see the `filtered` computed).
const earliestMatchDateTime = computed(() => {
  let earliest = null
  for (const r of records.value) {
    const d = r.data
    if (!d?.date || !d?.finished_at) continue
    const t = `${d.date}T${d.finished_at}`
    if (!earliest || t < earliest) earliest = t
  }
  return earliest || ''
})

// Local-time "now" formatted as YYYY-MM-DDTHH:MM for the input's max
// attribute. Recomputed on every render — Vue treats this as a getter
// without a reactive dep, but in practice the user reopens the dropdown
// often enough that minute-level staleness isn't visible.
const nowDateTime = computed(() => {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
})

// Card collapse/expand.
function toggleExpand(id) {
  // Reassign the object so Vue sees a new reference. Mutating in place
  // works for plain objects with Vue 3 deep reactivity, but being
  // explicit avoids surprises if `expanded` later becomes a shallowRef.
  expanded.value = { ...expanded.value, [id]: !expanded.value[id] }
}
function isExpanded(id) {
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
  const c = { victory: 0, defeat: 0, draw: 0 }
  for (const r of filteredSorted.value) {
    const k = r.data?.result
    if (k && k in c) c[k]++
  }
  return c
})

// Per-card "source screenshots" sub-panel expansion. Independent of the
// main card expand state — most users don't care which screenshots fed
// a row, so we keep this folded by default even when the card itself
// is open.
const sourcesExpanded = ref({})
function toggleSources(id) {
  sourcesExpanded.value = { ...sourcesExpanded.value, [id]: !sourcesExpanded.value[id] }
}
function isSourcesOpen(id) {
  return !!sourcesExpanded.value[id]
}

// Per-filename screenshot preview expansion. Keyed by filename so the
// same screenshot stays open if you collapse and re-open the source
// list. Image bytes come from the Go ScreenshotHandler at
// /_screenshot/<filename> — no IPC round-trip.
const previewOpen = ref({})
function togglePreview(filename) {
  previewOpen.value = { ...previewOpen.value, [filename]: !previewOpen.value[filename] }
}
function isPreviewOpen(filename) {
  return !!previewOpen.value[filename]
}
function screenshotURL(filename) {
  return `/_screenshot/${encodeURIComponent(filename)}`
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
const unknownExpanded = ref({})
function toggleUnknownExpand(id) {
  unknownExpanded.value = { ...unknownExpanded.value, [id]: !unknownExpanded.value[id] }
}
function isUnknownExpanded(id) {
  return !!unknownExpanded.value[id]
}

const unknownPreviewOpen = ref({})
function toggleUnknownPreview(filename) {
  unknownPreviewOpen.value = { ...unknownPreviewOpen.value, [filename]: !unknownPreviewOpen.value[filename] }
}
function isUnknownPreviewOpen(filename) {
  return !!unknownPreviewOpen.value[filename]
}

// Infer which screenshot types were parsed for a record based on which
// field groups are populated. Drives the slot-chip row on each card.
function detectScreenshotSlots(rec) {
  const d = rec.data || {}
  return [
    {
      key: 'summary',
      label: 'SUMMARY',
      present: !!(d.result || d.date || d.finished_at || d.game_length || d.type || d.mode),
      hint: 'End-of-match result screen — provides map, result, date, game type',
    },
    {
      key: 'scoreboard',
      label: 'TEAMS',
      present: !!(d.eliminations != null || d.deaths != null),
      hint: 'Tab key scoreboard — provides E/A/D, damage, healing, mitigation',
    },
    {
      key: 'personal',
      label: 'PERSONAL',
      present: !!(Array.isArray(d.heroes_played) && d.heroes_played.some(hp => hp.stats && Object.keys(hp.stats).length > 0)),
      hint: 'Personal stats tab — provides per-hero detailed statistics',
    },
    {
      key: 'rank',
      label: 'RANK',
      present: !!(d.rank),
      hint: 'Competitive rank screen — provides SR, rank tier, rank change',
    },
  ]
}

// heroesForHeader returns the list of heroes to render in the card title,
// sorted by percent_played descending. Multi-hero matches (with a SUMMARY
// or PERSONAL screenshot) get the full list; a fallback for matches that
// only have the scoreboard parsed returns the single primary hero so the
// title isn't empty.
function heroesForHeader(rec) {
  const list = rec.data?.heroes_played
  if (Array.isArray(list) && list.length > 0) {
    return [...list].sort((a, b) => (b.percent_played || 0) - (a.percent_played || 0))
  }
  if (rec.data?.hero) return [{ hero: rec.data.hero }]
  return []
}

const anyFilter = computed(() =>
  !!(filterMode.value.length || filterType.value.length || filterRole.value.length ||
     filterMap.value.length  || filterHero.value.length || filterResult.value.length ||
     filterFrom.value || filterTo.value)
)

// Format the match's date + end time for the card header. Parser stores
// date as YYYY-MM-DD and finished_at as 24-hour HH:MM; the Wails UI
// prefers a friendlier `May 9, 2026 @ 9:08pm` rendering. Grafana keeps
// its own time formatting (driven by panel settings) and is unaffected.
function fmtTime(rec) {
  const d = rec.data || {}
  if (!d.date && !d.finished_at) return ''

  // Date portion: "May 9, 2026". Full month names; day is not zero-padded.
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December']
  let datePart = ''
  if (d.date) {
    const [y, mo, day] = d.date.split('-').map(Number)
    if (!Number.isNaN(y) && !Number.isNaN(mo) && !Number.isNaN(day)) {
      datePart = `${months[mo - 1]} ${day}, ${y}`
    }
  }

  // Time portion: "9:08pm". Falls back to the raw HH:MM if parsing fails.
  let timePart = ''
  if (d.finished_at) {
    const [hRaw, mRaw] = d.finished_at.split(':')
    const h = Number(hRaw), m = Number(mRaw)
    if (Number.isNaN(h) || Number.isNaN(m)) {
      timePart = d.finished_at
    } else {
      const suffix = h >= 12 ? 'pm' : 'am'
      let hr12 = h % 12
      if (hr12 === 0) hr12 = 12
      timePart = `${hr12}:${String(m).padStart(2, '0')}${suffix}`
    }
  }

  if (datePart && timePart) return `${datePart} @ ${timePart}`
  return datePart || timePart
}

// Subscribe to the watcher's parse-complete event so the records list
// auto-refreshes when an auto-parse runs in the background. Without
// this the user would have to click Parse manually to see new matches
// land in the UI even though the data is already in SQLite.

// Theme: 'dark' (default) or 'light'. Persisted to localStorage so the
// choice survives across launches. Applied by setting data-theme on the
// document root, which scopes the light-mode CSS variable overrides.
const themeMode = ref('dark')
function applyTheme(mode) {
  document.documentElement.setAttribute('data-theme', mode)
}
function toggleTheme() {
  themeMode.value = themeMode.value === 'dark' ? 'light' : 'dark'
  applyTheme(themeMode.value)
  try { localStorage.setItem('recall.theme', themeMode.value) } catch (_) {}
}

// Multi-select popover lifecycle. The trigger button toggles the field
// open; an outside-click or ESC closes it. Only one popover is ever
// open at a time (the second `toggleFilterPanel` call closes the
// previous one before opening the new one).
function toggleFilterPanel(field) {
  openFilter.value = openFilter.value === field ? '' : field
  if (openFilter.value && filterSearch.value[field] !== '') {
    filterSearch.value = { ...filterSearch.value, [field]: '' }
  }
}
function closeFilterPanel() { openFilter.value = '' }

function onDocMousedown(e) {
  if (!openFilter.value) return
  const t = e.target
  // Ignore clicks inside any open .multi-filter root; close on anything else.
  if (t && t.closest && t.closest('.multi-filter')) return
  openFilter.value = ''
}
function onDocKeydown(e) {
  if (e.key === 'Escape' && openFilter.value) {
    openFilter.value = ''
  }
}

onMounted(() => {
  let stored = null
  try { stored = localStorage.getItem('recall.theme') } catch (_) {}
  if (stored === 'light' || stored === 'dark') themeMode.value = stored
  applyTheme(themeMode.value)

  // Restore last-parse timestamp so the Settings page shows the right
  // "Last run · …" hint immediately on launch, not just after a fresh
  // parse in the current session.
  try {
    const v = localStorage.getItem('recall.lastParsedAt')
    if (v) lastParsedAt.value = Number(v) || null
  } catch (_) {}

  load()
  EventsOn('parse-complete', () => { load(); lastParsedAt.value = Date.now(); try { localStorage.setItem('recall.lastParsedAt', String(lastParsedAt.value)) } catch (_) {} })
  EventsOn('parse-progress', (data) => {
    if (!data) return
    parseProgress.value = data
    parseLog.value = [...parseLog.value, data].slice(-50)
  })

  document.addEventListener('mousedown', onDocMousedown)
  document.addEventListener('keydown', onDocKeydown)
})
onBeforeUnmount(() => {
  EventsOff('parse-complete')
  EventsOff('parse-progress')
  document.removeEventListener('mousedown', onDocMousedown)
  document.removeEventListener('keydown', onDocKeydown)
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
            {{ tesseractStatus.error || 'Recall cannot OCR screenshots without Tesseract. Install it, or point Recall at the existing binary in Settings → Engine.' }}
          </p>
        </div>
        <div class="system-alert-actions">
          <button class="btn alert-cta" @click="gotoEngineSettings">
            <span class="alert-cta-arrow" aria-hidden="true">→</span>
            Fix in Settings
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
          <nav class="page-nav" role="tablist" aria-label="Primary">
            <button
              class="nav-tab"
              :class="{ active: view === 'matches' }"
              :aria-selected="view === 'matches'"
              role="tab"
              @click="view = 'matches'"
            >
              <span class="nav-tab-num">01</span>
              <span class="nav-tab-label">Matches</span>
            </button>
            <button
              class="nav-tab"
              :class="{ active: view === 'settings' }"
              :aria-selected="view === 'settings'"
              role="tab"
              @click="view = 'settings'"
            >
              <span class="nav-tab-num">02</span>
              <span class="nav-tab-label">Settings</span>
            </button>
            <button
              class="nav-tab"
              :class="{ active: view === 'unknown' }"
              :aria-selected="view === 'unknown'"
              role="tab"
              @click="view = 'unknown'"
            >
              <span class="nav-tab-num">03</span>
              <span class="nav-tab-label">
                Unknown
                <span v-if="unknownRecords.length > 0" class="nav-tab-badge">{{ unknownRecords.length }}</span>
              </span>
            </button>
          </nav>
        </div>
        <div class="masthead-right">
          <button
            class="theme-toggle"
            :title="themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
            :aria-label="themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
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
        </div>
      </header>

      <p v-if="error" class="error">
        <span class="error-tick">✕</span>{{ error }}
      </p>

      <!-- ─── SETTINGS VIEW ────────────────────────────────────── -->
      <section v-if="view === 'settings'" key="settings" class="settings">
        <header class="settings-intro">
          <p class="settings-eyebrow">
            System Configuration
          </p>
          <h2 v-if="!tesseractReady" class="settings-heading missing">
            Recall can't OCR until <em>Tesseract is located</em>.
          </h2>
          <h2 v-else class="settings-heading">
            Recall is reading <em>{{ screenshotsDir || 'no folder yet' }}</em>
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

        <div id="sec-directories" class="settings-section">
          <div class="section-header">
            <span class="section-num">02</span>
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

        <div id="sec-ingest" class="settings-section">
          <div class="section-header">
            <span class="section-num">03</span>
            <span class="section-slash" aria-hidden="true">/</span>
            <h3 class="section-title">
              Ingest
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
                  <span v-else-if="newScreenshotCount > 0">Run Parse · {{ newScreenshotCount }}</span>
                  <span v-else>Run Parse</span>
                </button>
              </div>
            </div>

            <!-- Parse progress panel — visible while loading -->
            <div v-if="loading" class="parse-progress-panel">
              <div class="pp-header">
                <div class="pp-scan-label">
                  <span class="pp-scan-dot" aria-hidden="true" />
                  <span class="pp-scan-text">Scanning</span>
                </div>
                <div class="pp-fraction mono">
                  <span class="pp-done">{{ parseProgress?.done ?? 0 }}</span>
                  <span class="pp-sep">&nbsp;/&nbsp;</span>
                  <span class="pp-total">{{ parseProgress?.total ?? '…' }}</span>
                  <span class="pp-unit">screenshots</span>
                </div>
                <div class="pp-bar-track">
                  <div
                    class="pp-bar-fill"
                    :style="parseProgress && parseProgress.total
                      ? { width: `${(parseProgress.done / parseProgress.total) * 100}%` }
                      : { width: '0%' }"
                  />
                </div>
              </div>

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
            </div>
          </div>
        </div>

        <div id="sec-export" class="settings-section">
          <div class="section-header">
            <span class="section-num">04</span>
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
            <span class="section-num">05</span>
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
      <section v-if="view === 'unknown'" key="unknown" class="settings unknown-view">
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
            <strong class="empty-link" @click="view = 'settings'">run Parse</strong>
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
                  { label: 'Map',    value: rec.data?.map },
                  { label: 'Mode',   value: rec.data?.mode },
                  { label: 'Type',   value: rec.data?.type },
                  { label: 'Result', value: rec.data?.result },
                  { label: 'Date',   value: rec.data?.date },
                  { label: 'Time',   value: rec.data?.finished_at },
                  { label: 'Length', value: rec.data?.game_length },
                  { label: 'E/A/D',  value: rec.data?.eliminations != null ? `${rec.data.eliminations} / ${rec.data.assists} / ${rec.data.deaths}` : null },
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
                      v-if="isUnknownPreviewOpen(f)"
                      :src="screenshotURL(f)"
                      :alt="f"
                      class="source-preview"
                      loading="lazy"
                    >
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
      <div v-if="view === 'matches'" key="matches" class="matches-view">
        <div v-if="records.length === 0 && !loading" class="empty">
          <div class="empty-mark">
            ◌
          </div>
          <p class="empty-title">
            No matches on record.
          </p>
          <p class="empty-sub">
            Head to <strong class="empty-link" @click="view = 'settings'">Settings → Run Parse</strong> to scan your screenshots folder, or flip on <strong class="empty-link" @click="view = 'settings'">Watch Folder</strong> there to auto-ingest as you play.
          </p>
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
              ]"
              :key="cfg.field"
              class="filter-field multi-filter"
              :class="{ open: openFilter === cfg.field, populated: filterRefs[cfg.field].value.length > 0 }"
            >
              <span class="filter-eyebrow">
                {{ cfg.label }}
                <span v-if="filterRefs[cfg.field].value.length" class="eyebrow-count">× {{ String(filterRefs[cfg.field].value.length).padStart(2, '0') }}</span>
              </span>

              <button
                type="button"
                class="mf-trigger"
                :aria-expanded="openFilter === cfg.field"
                :aria-label="`${cfg.label} filter, ${filterRefs[cfg.field].value.length} of ${cfg.options.length} selected`"
                @click="toggleFilterPanel(cfg.field)"
              >
                <span class="mf-trigger-inner">
                  <template v-if="filterRefs[cfg.field].value.length === 0">
                    <span class="mf-placeholder">All</span>
                    <span class="mf-placeholder-meta">{{ cfg.options.length }} {{ cfg.short.toLowerCase() }}</span>
                  </template>
                  <template v-else-if="filterRefs[cfg.field].value.length <= 2">
                    <span
                      v-for="val in filterRefs[cfg.field].value"
                      :key="val"
                      class="mf-chip"
                      :title="`Remove ${val} from filter`"
                      @click.stop="toggleFilter(cfg.field, val)"
                    >
                      <span class="mf-chip-text">{{ val }}</span>
                      <span class="mf-chip-x" aria-hidden="true">×</span>
                    </span>
                  </template>
                  <template v-else>
                    <span class="mf-chip mf-chip-stack">
                      <span class="mf-chip-text">{{ filterRefs[cfg.field].value[0] }}</span>
                      <span class="mf-chip-x" aria-hidden="true" />
                    </span>
                    <span class="mf-more">+{{ filterRefs[cfg.field].value.length - 1 }}</span>
                  </template>
                </span>
                <span class="mf-caret" aria-hidden="true" />
              </button>

              <div v-if="openFilter === cfg.field" class="mf-panel" @click.stop>
                <div class="mf-panel-head">
                  <span class="mf-panel-title">{{ cfg.short }} ROSTER</span>
                  <span class="mf-panel-meta">{{ filterRefs[cfg.field].value.length }} / {{ cfg.options.length }}</span>
                </div>
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
                      v-if="!filterSearch[cfg.field] || opt.toLowerCase().includes(filterSearch[cfg.field].toLowerCase())"
                      class="mf-row"
                      :class="{ checked: filterRefs[cfg.field].value.includes(opt) }"
                    >
                      <input
                        type="checkbox"
                        :checked="filterRefs[cfg.field].value.includes(opt)"
                        class="mf-row-box"
                        @change="toggleFilter(cfg.field, opt)"
                      >
                      <span class="mf-row-mark" aria-hidden="true" />
                      <span class="mf-row-label">{{ opt }}</span>
                    </label>
                  </template>
                  <div
                    v-if="filterSearch[cfg.field] && cfg.options.filter(o => o.toLowerCase().includes(filterSearch[cfg.field].toLowerCase())).length === 0"
                    class="mf-empty"
                  >
                    No {{ cfg.label.toLowerCase() }} matches "{{ filterSearch[cfg.field] }}"
                  </div>
                </div>
                <div class="mf-panel-foot">
                  <button
                    type="button"
                    class="mf-foot-btn"
                    :disabled="filterRefs[cfg.field].value.length === cfg.options.length"
                    @click="selectAllFilter(cfg.field, cfg.options)"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class="mf-foot-btn"
                    :disabled="filterRefs[cfg.field].value.length === 0"
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
              <div class="match-header" @click="toggleExpand(rec.id)">
                <div class="match-title-row">
                  <div class="match-title-lhs">
                    <span class="match-index">{{ String(idx + 1).padStart(2, '0') }}</span>
                    <span
                      class="match-map clickable"
                      :class="{ active: isActive('map', rec.data.map) }"
                      title="Click to filter by this map"
                      @click.stop="toggleFilter('map', rec.data.map)"
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
                </div>
              </div>

              <template v-if="isExpanded(rec.id)">
                <div class="match-expanded">
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
                    </div>
                    <div v-if="isSourcesOpen(rec.id)" class="sources">
                      <div v-for="f in rec.source_files" :key="f" class="source-file">
                        <a
                          class="source-name"
                          :href="screenshotURL(f)"
                          :title="isPreviewOpen(f) ? 'Hide preview' : 'Show preview'"
                          @click.prevent="togglePreview(f)"
                        >
                          <span class="chev small" :class="{ open: isPreviewOpen(f) }">›</span>
                          <span class="source-name-text">{{ f }}</span>
                        </a>
                        <img
                          v-if="isPreviewOpen(f)"
                          :src="screenshotURL(f)"
                          :alt="f"
                          class="source-preview"
                          loading="lazy"
                        >
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </article>
        </div>
      </div><!-- /.matches-view -->
    </div>
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

  /* Overwatch signature greys. Used as a structural brand element —
     the masthead branding tile, strong borders, divider blocks. */
  --brand-grey: #4A4A4A;
  --brand-grey-soft: rgb(74 74 74 / 55%);

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
  --display: 'Big Shoulders Display', 'Impact', 'Oswald', sans-serif;
  --body: 'Geist', -apple-system, blinkmacsystemfont, sans-serif;
  --mono: 'Geist Mono', ui-monospace, 'SF Mono', menlo, monospace;
}

/* LIGHT MODE — keep brand-grey (#4A4A4A) and brand-orange (#F5A623)
   prominent. The brand-grey now becomes the dominant structural color:
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
  --brand-grey: #4A4A4A;
  --brand-grey-soft: rgb(74 74 74 / 85%);

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

/* The brandmark sits inside a solid Overwatch-grey tile — a small
   "spec plate" that anchors the wordmark and surfaces the brand grey
   #4A4A4A as a deliberate structural element in BOTH themes. The OW
   orange wordmark pops on it; the tile becomes the page's brand stamp
   even when the rest of the page goes light. */
.brandmark-tile {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.55rem 1.15rem 0.55rem 1rem;
  background: var(--brand-grey);
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

.brand-tick {
  color: var(--accent-bright);
  font-size: 1.05rem;
  line-height: 1;
  transform: translateY(-1px);
  text-shadow: 0 0 14px var(--accent-glow);
  font-feature-settings: "tnum";
}

.brand {
  font-family: var(--display);
  font-weight: 900;
  font-size: 2.85rem;
  letter-spacing: -0.025em;
  line-height: 0.85;
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
  font-size: 5rem;
  color: var(--text-mute);
  margin-bottom: 1rem;
}

.empty-title {
  font-family: var(--display);
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
  background: var(--brand-grey);
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
      var(--brand-grey) 0 12px,
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
  font-weight: 800;
  font-size: 1.55rem;
  letter-spacing: -0.015em;
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
.hero-name-inline { font-weight: 600; letter-spacing: 0.04em; }

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
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.02em;
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
}
.source-name:hover { background: var(--surface-2); color: var(--accent-bright); }
.source-name-text { font-size: 0.72rem; }

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

/* ─── Page Nav (Matches / Settings) ──────────────────────── */

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
  border-bottom: 1px solid var(--brand-grey);
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

.section-num {
  font-family: var(--display);
  font-weight: 900;
  font-size: 3rem;
  color: var(--brand-grey);
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
   read as caution without going full red — the brand-grey body keeps
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
  background: linear-gradient(180deg, var(--brand-grey) 0%, #3a3a3a 100%);
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
  background: linear-gradient(180deg, var(--brand-grey) 0%, #3a3a3a 100%);

  /* Stays dark in light mode — system alerts feel right as a dark
     overlay regardless of theme (think "warning sticker"). */
}

/* ─── Engine status panel (Settings → 01 / Engine) ──────── */

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

/* Brand wordmark on the grey tile stays white-on-grey in both modes —
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

/* Header: scanning label + fraction + bar */
.pp-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid var(--border-soft);
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
  flex: 1;
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

[data-theme="light"] .slot-chip.present { color: var(--win); }
[data-theme="light"] .slot-chip.absent { color: var(--text-faint); }

.slot-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
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

/* ─── Unknown view responsive ────────────────────────────── */
@media (width <= 880px) {
  .unknown-fields { grid-template-columns: repeat(4, 1fr); }
}

@media (width <= 680px) {
  .slot-chip { display: none; }
  .slot-chip:nth-child(-n+2) { display: inline-flex; }
}

@media (width <= 580px) {
  .unknown-fields {
    grid-template-columns: repeat(2, 1fr);
    padding: 0 1rem 0 1rem;
  }
  .unknown-card-head { padding: 0.7rem 1rem 0.7rem 1rem; }
  .unknown-expanded { padding: 0.85rem 1rem; }
}
</style>
