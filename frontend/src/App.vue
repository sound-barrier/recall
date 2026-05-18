<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  ParseScreenshots,
  GetMatchResults,
  GetScreenshotsDir,
  PickScreenshotsDir,
  GetPrometheusEnabled,
  SetPrometheusEnabled,
  GetWatchEnabled,
  SetWatchEnabled,
} from '../wailsjs/go/main/App'
import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime'

const records = ref([])
const error = ref('')
const loading = ref(false)

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

const filterMode   = ref('')
const filterType   = ref('')
const filterRole   = ref('')
const filterMap    = ref('')
const filterHero   = ref('')
const filterResult = ref('')

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
  const [recs, dir, promOn, watchOn] = await Promise.all([
    GetMatchResults(),
    GetScreenshotsDir(),
    GetPrometheusEnabled(),
    GetWatchEnabled(),
  ])
  records.value = recs ?? []
  screenshotsDir.value = dir || ''
  prometheusEnabled.value = !!promOn
  watchEnabled.value = !!watchOn
}

// Toggle directory watching. Same pattern as Prometheus: Go owns the
// actual side effect (fsnotify watcher start/stop), this just mirrors
// state and rolls back on error.
async function toggleWatch(e) {
  const next = e.target.checked
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
  error.value = ''
  loading.value = true
  try {
    await ParseScreenshots()
    await load()
  } catch (e) {
    error.value = String(e)
  } finally {
    loading.value = false
  }
}

// Open the native folder picker via Wails. The Go side persists the
// choice so subsequent app launches pick up the same directory; we
// just need to refresh our local mirror.
async function pickDir() {
  try {
    const dir = await PickScreenshotsDir()
    if (dir) screenshotsDir.value = dir
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
    if (filterMode.value   && d.mode   !== filterMode.value)   return false
    if (filterType.value   && d.type   !== filterType.value)   return false
    if (filterRole.value   && d.role   !== filterRole.value)   return false
    if (filterMap.value    && d.map    !== filterMap.value)    return false
    if (filterResult.value && d.result !== filterResult.value) return false
    // Hero filter matches the primary hero OR any hero in heroes_played,
    // so picking a secondary hero like Juno (47%-second-fiddle on
    // Rialto) still surfaces that match. Mirrors how the dropdown
    // sources its options.
    if (filterHero.value) {
      const inPrimary   = d.hero === filterHero.value
      const inSecondary = (d.heroes_played || []).some(hp => hp.hero === filterHero.value)
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

// toggleFilter sets a field's filter to `value`, or clears it if the
// filter already equals `value` — so clicking the same badge twice
// turns the filter off.
function toggleFilter(field, value) {
  if (!value) return
  const r = filterRefs[field]
  if (!r) return
  r.value = r.value === value ? '' : value
}

function isActive(field, value) {
  const r = filterRefs[field]
  return r && r.value === value
}

function clearFilters() {
  filterMode.value   = ''
  filterType.value   = ''
  filterRole.value   = ''
  filterMap.value    = ''
  filterHero.value   = ''
  filterResult.value = ''
  filterFrom.value   = ''
  filterTo.value     = ''
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
  !!(filterMode.value || filterType.value || filterRole.value || filterMap.value ||
     filterHero.value || filterResult.value || filterFrom.value || filterTo.value)
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

onMounted(() => {
  let stored = null
  try { stored = localStorage.getItem('recall.theme') } catch (_) {}
  if (stored === 'light' || stored === 'dark') themeMode.value = stored
  applyTheme(themeMode.value)
  load()
  EventsOn('parse-complete', () => { load() })
})
onBeforeUnmount(() => {
  EventsOff('parse-complete')
})
</script>

<template>
  <div class="app">
    <div class="atmos" aria-hidden="true"></div>
    <div class="grid-lines" aria-hidden="true"></div>

    <div class="container">
      <header class="masthead">
        <div class="masthead-left">
          <div class="brandmark-tile">
            <span class="brand-tick">↺</span>
            <h1 class="brand">RE<span class="brand-accent">CALL</span></h1>
            <span class="brand-corner" aria-hidden="true"></span>
          </div>
          <p class="tagline">Personal Telemetry · Match Almanac</p>
        </div>
        <div class="masthead-right">
          <button
            class="theme-toggle"
            @click="toggleTheme"
            :title="themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
            :aria-label="themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <span class="theme-seg" :class="{ active: themeMode === 'light' }">
              <svg viewBox="0 0 24 24" class="theme-icon" aria-hidden="true">
                <circle cx="12" cy="12" r="4" fill="currentColor"/>
                <g stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
                  <line x1="12" y1="2" x2="12" y2="5"/>
                  <line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="2" y1="12" x2="5" y2="12"/>
                  <line x1="19" y1="12" x2="22" y2="12"/>
                  <line x1="4.6" y1="4.6" x2="6.7" y2="6.7"/>
                  <line x1="17.3" y1="17.3" x2="19.4" y2="19.4"/>
                  <line x1="4.6" y1="19.4" x2="6.7" y2="17.3"/>
                  <line x1="17.3" y1="6.7" x2="19.4" y2="4.6"/>
                </g>
              </svg>
              <span class="theme-label">Day</span>
            </span>
            <span class="theme-divider" aria-hidden="true"></span>
            <span class="theme-seg" :class="{ active: themeMode === 'dark' }">
              <svg viewBox="0 0 24 24" class="theme-icon" aria-hidden="true">
                <path d="M21 12.8A8.5 8.5 0 0 1 11.2 3a7 7 0 1 0 9.8 9.8z" fill="currentColor"/>
              </svg>
              <span class="theme-label">Night</span>
            </span>
          </button>
          <div
            v-if="records.length > 0"
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

      <section class="control-deck">
        <div class="deck-path" :title="screenshotsDir">
          <span class="deck-eyebrow">Reading from</span>
          <span class="deck-path-value">{{ screenshotsDir || 'No directory selected' }}</span>
        </div>
        <div class="deck-actions">
          <button class="btn ghost" @click="pickDir" :disabled="loading">Change Folder</button>
          <label
            class="switch"
            title="Auto-parse new screenshots as they appear. Waits 60 seconds after the last new file before parsing, so a typical 3–4-screenshot session collapses into one parse."
          >
            <input type="checkbox" :checked="watchEnabled" @change="toggleWatch" />
            <span class="switch-track"><span class="switch-knob"></span></span>
            <span class="switch-label">Watch Folder</span>
          </label>
          <label
            class="switch"
            title="Lets the Grafana dashboard read your matches over localhost:9091. Off by default — no network port is opened until you enable this."
          >
            <input type="checkbox" :checked="prometheusEnabled" @change="togglePrometheus" />
            <span class="switch-track"><span class="switch-knob"></span></span>
            <span class="switch-label">Stream to Grafana</span>
          </label>
          <button class="btn primary" @click="parse" :disabled="loading">
            <span class="btn-dot"></span>
            <span v-if="loading">Parsing…</span>
            <span v-else>Parse Screenshots</span>
          </button>
        </div>
      </section>

      <p v-if="error" class="error"><span class="error-tick">✕</span>{{ error }}</p>

      <div v-if="records.length === 0 && !loading" class="empty">
        <div class="empty-mark">◌</div>
        <p class="empty-title">No matches on record.</p>
        <p class="empty-sub">Hit <strong>Parse Screenshots</strong> to scan your folder, or flip on <strong>Watch Folder</strong> to auto-ingest as you play.</p>
      </div>

      <section v-if="records.length > 0" class="filter-rail">
        <div class="filter-grid">
          <div class="filter-field">
            <span class="filter-eyebrow">Mode</span>
            <select v-model="filterMode" class="dd">
              <option value="">All</option>
              <option v-for="m in modes" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="filter-field">
            <span class="filter-eyebrow">Map</span>
            <select v-model="filterMap" class="dd">
              <option value="">All</option>
              <option v-for="m in maps" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>
          <div class="filter-field">
            <span class="filter-eyebrow">Type</span>
            <select v-model="filterType" class="dd">
              <option value="">All</option>
              <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
            </select>
          </div>
          <div class="filter-field">
            <span class="filter-eyebrow">Role</span>
            <select v-model="filterRole" class="dd">
              <option value="">All</option>
              <option v-for="r in roles" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>
          <div class="filter-field">
            <span class="filter-eyebrow">Hero</span>
            <select v-model="filterHero" class="dd">
              <option value="">All</option>
              <option v-for="h in heroes" :key="h" :value="h">{{ h }}</option>
            </select>
          </div>
          <div class="filter-field">
            <span class="filter-eyebrow">Result</span>
            <select v-model="filterResult" class="dd">
              <option value="">All</option>
              <option v-for="r in results" :key="r" :value="r">{{ r }}</option>
            </select>
          </div>
        </div>

        <div class="filter-bar">
          <div class="range-group">
            <label class="range-label">
              <span>From</span>
              <input
                type="datetime-local"
                v-model="filterFrom"
                :min="earliestMatchDateTime"
                :max="nowDateTime"
                class="dd-date"
              />
            </label>
            <span class="range-dash">→</span>
            <label class="range-label">
              <span>To</span>
              <input
                type="datetime-local"
                v-model="filterTo"
                :min="earliestMatchDateTime"
                :max="nowDateTime"
                class="dd-date"
              />
            </label>
            <button
              class="btn ghost tiny"
              @click="resetDateRange"
              :disabled="!filterFrom && !filterTo"
              title="Clear both date pickers"
            >Reset</button>
          </div>

          <div class="filter-tools">
            <button class="btn ghost tiny" @click="toggleSort" :title="sortDir === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'">
              {{ sortDir === 'desc' ? '↓ Newest' : '↑ Oldest' }}
            </button>
            <button class="btn ghost tiny" @click="toggleAll" :title="allExpanded ? 'Collapse every visible card' : 'Expand every visible card'">
              {{ allExpanded ? 'Collapse All' : 'Expand All' }}
            </button>
            <button v-if="anyFilter" class="btn ghost tiny danger" @click="clearFilters">Clear Filters</button>
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
          <span class="match-bar" aria-hidden="true"></span>
          <div class="match-body">
            <div class="match-header" @click="toggleExpand(rec.id)">
              <div class="match-title-row">
                <div class="match-title-lhs">
                  <span class="match-index">{{ String(idx + 1).padStart(2, '0') }}</span>
                  <span
                    class="match-map clickable"
                    :class="{ active: isActive('map', rec.data.map) }"
                    @click.stop="toggleFilter('map', rec.data.map)"
                    title="Click to filter by this map"
                  >{{ rec.data.map || 'Unknown Map' }}</span>
                </div>
                <div class="match-title-rhs">
                  <span class="when" v-if="fmtTime(rec)">{{ fmtTime(rec) }}</span>
                  <span v-if="rec.data.game_length" class="length"><span class="length-mark">▮</span>{{ rec.data.game_length }}</span>
                  <span class="chev" :class="{ open: isExpanded(rec.id) }" aria-hidden="true">›</span>
                </div>
              </div>

              <div class="match-tag-row">
                <span
                  v-if="rec.data.mode"
                  class="badge mode clickable"
                  :class="{ active: isActive('mode', rec.data.mode) }"
                  @click.stop="toggleFilter('mode', rec.data.mode)"
                  title="Click to filter by this mode"
                >{{ rec.data.mode }}</span>
                <span
                  v-if="rec.data.type"
                  class="badge type clickable"
                  :class="{ active: isActive('type', rec.data.type) }"
                  @click.stop="toggleFilter('type', rec.data.type)"
                  title="Click to filter by this game type"
                >{{ rec.data.type }}</span>
                <span
                  v-if="rec.data.role"
                  class="badge role clickable"
                  :class="[rec.data.role, { active: isActive('role', rec.data.role) }]"
                  @click.stop="toggleFilter('role', rec.data.role)"
                  title="Click to filter by this role"
                >{{ rec.data.role }}</span>
                <template v-for="hp in heroesForHeader(rec)" :key="hp.hero">
                  <span
                    class="badge hero clickable"
                    :class="{ active: isActive('hero', hp.hero) }"
                    @click.stop="toggleFilter('hero', hp.hero)"
                    :title="hp.percent_played != null ? `${hp.hero} — ${hp.percent_played}% played` : 'Click to filter by this hero'"
                  >
                    <span class="hero-name-inline">{{ hp.hero }}</span>
                    <span v-if="hp.percent_played != null" class="hero-pct-inline">{{ hp.percent_played }}%</span>
                  </span>
                </template>
                <span
                  v-if="rec.data.result"
                  class="badge result clickable"
                  :class="[rec.data.result, { active: isActive('result', rec.data.result) }]"
                  @click.stop="toggleFilter('result', rec.data.result)"
                  title="Click to filter by this result"
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
                  <div class="block-eyebrow">Rank</div>
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
                  <div class="block-eyebrow">Heroes Played</div>
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
                        @click.prevent="togglePreview(f)"
                        :href="screenshotURL(f)"
                        :title="isPreviewOpen(f) ? 'Hide preview' : 'Show preview'"
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
                      />
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </article>
      </div>
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
  --hairline: rgba(255, 255, 255, 0.07);

  --text: #ecedf0;
  --text-dim: #9ca0ac;
  --text-faint: #6b6f7a;
  --text-mute: #44474f;

  /* Overwatch signature greys. Used as a structural brand element —
     the masthead branding tile, strong borders, divider blocks. */
  --brand-grey: #4A4A4A;
  --brand-grey-soft: rgba(74, 74, 74, 0.55);

  /* Overwatch signature orange. Single hero accent across the UI. */
  --accent: #F5A623;
  --accent-bright: #ffbf4d;
  --accent-soft: rgba(245, 166, 35, 0.16);
  --accent-glow: rgba(245, 166, 35, 0.38);

  --win: #4dff8e;
  --win-soft: rgba(77, 255, 142, 0.12);
  --win-line: rgba(77, 255, 142, 0.55);
  --loss: #ff5a73;
  --loss-soft: rgba(255, 90, 115, 0.12);
  --loss-line: rgba(255, 90, 115, 0.55);
  --draw: #ffc94d;
  --draw-soft: rgba(255, 201, 77, 0.12);
  --draw-line: rgba(255, 201, 77, 0.55);
  --unknown-line: rgba(120, 124, 134, 0.4);

  --tank: #6ab8ff;
  --tank-soft: rgba(106, 184, 255, 0.14);
  --dps: #ff7a5a;
  --dps-soft: rgba(255, 122, 90, 0.14);
  --support: #7dffac;
  --support-soft: rgba(125, 255, 172, 0.14);

  /* Theme atmosphere tunables — overridden in light mode. */
  --atmos-orange: rgba(245, 166, 35, 0.10);
  --atmos-blue:   rgba(106, 184, 255, 0.06);
  --atmos-coral:  rgba(255, 90, 115, 0.05);
  --grid-line:    rgba(255, 255, 255, 0.018);
  --primary-text-on-accent: #1a0a00;
  --accent-text:  #F5A623;    /* same as --accent in dark mode (good contrast on dark bg) */

  --display: 'Big Shoulders Display', 'Impact', 'Oswald', sans-serif;
  --body: 'Geist', -apple-system, BlinkMacSystemFont, sans-serif;
  --mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
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
  --hairline: rgba(74, 74, 74, 0.16);

  --text: #2b2a26;
  --text-dim: #4A4A4A;
  --text-faint: #6f6a5e;
  --text-mute: #a39e90;

  --brand-grey: #4A4A4A;
  --brand-grey-soft: rgba(74, 74, 74, 0.85);

  /* Keep #F5A623 dominant in light mode too — it's the OW signature.
     Type-on-light contrast is handled with a darker `--accent-text`
     used in selector-level overrides below. */
  --accent: #F5A623;
  --accent-bright: #d68a14;   /* darker on light bg hover, more readable */
  --accent-text: #9a6512;     /* AA-contrast text variant for orange-on-cream */
  --accent-soft: rgba(245, 166, 35, 0.22);
  --accent-glow: rgba(245, 166, 35, 0.42);

  --win: #137a3a;
  --win-soft: rgba(19, 122, 58, 0.14);
  --win-line: rgba(19, 122, 58, 0.6);
  --loss: #b03346;
  --loss-soft: rgba(176, 51, 70, 0.12);
  --loss-line: rgba(176, 51, 70, 0.55);
  --draw: #a07020;
  --draw-soft: rgba(160, 112, 32, 0.14);
  --draw-line: rgba(160, 112, 32, 0.55);
  --unknown-line: rgba(74, 74, 74, 0.35);

  --tank: #2c6eb8;
  --tank-soft: rgba(44, 110, 184, 0.14);
  --dps: #c54a2c;
  --dps-soft: rgba(197, 74, 44, 0.13);
  --support: #2d8a4d;
  --support-soft: rgba(45, 138, 77, 0.13);

  --atmos-orange: rgba(245, 166, 35, 0.14);
  --atmos-blue:   rgba(44, 110, 184, 0.05);
  --atmos-coral:  rgba(176, 51, 70, 0.04);
  --grid-line:    rgba(74, 74, 74, 0.04);
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
  mask-image: radial-gradient(ellipse at center, rgba(0,0,0,0.9), transparent 75%);
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
    0 0 0 1px rgba(0, 0, 0, 0.25) inset,
    0 14px 36px -14px rgba(0, 0, 0, 0.55);
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
      rgba(255, 255, 255, 0.18) 0 2px,
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
  box-shadow: 0 0 0 1px rgba(0,0,0,0.4) inset, 0 4px 28px -8px var(--accent-glow);
}
.btn.primary:hover:not(:disabled) {
  background: var(--accent-bright);
  border-color: var(--accent-bright);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.4) inset, 0 4px 36px -6px var(--accent-glow);
  transform: translateY(-1px);
}
.btn.primary:active:not(:disabled) {
  transform: translateY(0);
}
.btn-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: #1a0a00;
  box-shadow: 0 0 0 2px rgba(26, 10, 0, 0.25);
}

.btn.ghost {
  background: transparent;
  color: var(--text-dim);
  border-color: var(--border-strong);
}
.btn.ghost:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-faint);
  background: rgba(255, 255, 255, 0.025);
}
.btn.ghost.tiny {
  padding: 0.38rem 0.65rem;
  font-size: 0.7rem;
}
.btn.ghost.danger:hover:not(:disabled) {
  color: var(--loss);
  border-color: var(--loss-line);
}

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
}
.filter-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.dd {
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--body);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.45rem 0.6rem;
  font-size: 0.85rem;
  cursor: pointer;
  text-transform: capitalize;
  appearance: none;
  -webkit-appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--text-faint) 50%),
    linear-gradient(135deg, var(--text-faint) 50%, transparent 50%);
  background-position:
    calc(100% - 14px) calc(50% - 2px),
    calc(100% - 9px) calc(50% - 2px);
  background-size: 5px 5px;
  background-repeat: no-repeat;
  padding-right: 1.7rem;
  transition: border-color 140ms ease, background-color 140ms ease;
}
.dd:hover { border-color: var(--border-strong); }
.dd:focus {
  outline: none;
  border-color: var(--accent);
  background-color: var(--surface-3);
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
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--border-strong);
}
.badge.type {
  background: rgba(255, 255, 255, 0.025);
  color: var(--text-faint);
  letter-spacing: 0.12em;
}

.badge.role { font-weight: 700; }
.badge.role.dps     { background: var(--dps-soft);     color: var(--dps);     border-color: rgba(255, 122, 90, 0.4); }
.badge.role.tank    { background: var(--tank-soft);    color: var(--tank);    border-color: rgba(106, 184, 255, 0.4); }
.badge.role.support { background: var(--support-soft); color: var(--support); border-color: rgba(125, 255, 172, 0.4); }

.badge.hero {
  background: var(--accent-soft);
  color: var(--accent-text);
  border-color: rgba(245, 166, 35, 0.4);
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
.rank-tier.bronze    { color: #d18a4a; border-color: rgba(209, 138, 74, 0.45); }
.rank-tier.silver    { color: #d6d6d6; border-color: rgba(214, 214, 214, 0.4); }
.rank-tier.gold      { color: #ffd770; border-color: rgba(255, 215, 112, 0.45); }
.rank-tier.platinum  { color: #7befd9; border-color: rgba(123, 239, 217, 0.45); }
.rank-tier.diamond   { color: #c2e6ff; border-color: rgba(194, 230, 255, 0.45); }
.rank-tier.master    { color: #d6b4ff; border-color: rgba(214, 180, 255, 0.45); }
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
  background: rgba(0, 0, 0, 0.3);
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
  box-shadow: 0 8px 30px -8px rgba(0, 0, 0, 0.5);
}

/* ─── Responsive ─────────────────────────────────────────── */

@media (max-width: 880px) {
  .brand { font-size: 2.4rem; }
  .score-num { font-size: 2rem; }
  .scoreboard { gap: 1rem; }
  .filter-grid { grid-template-columns: repeat(3, 1fr); }
  .stats { grid-template-columns: repeat(3, 1fr); }
  .stat:nth-child(3) { border-right: none; }
  .stat:nth-child(n+4) { border-top: 1px solid var(--border); }
}
@media (max-width: 580px) {
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
[data-theme="light"] .source-name:hover { color: var(--accent-text); }
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
[data-theme="light"] .source-name:hover { background: var(--surface-3); }
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
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2) inset, 0 6px 22px -10px var(--accent-glow);
}
[data-theme="light"] .btn.primary:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(0.95);
}
</style>
