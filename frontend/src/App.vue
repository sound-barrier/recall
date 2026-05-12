<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  ParseScreenshots,
  GetMatchResults,
  GetScreenshotsDir,
  PickScreenshotsDir,
  GetPrometheusEnabled,
  SetPrometheusEnabled,
} from '../wailsjs/go/main/App'

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
  const [recs, dir, promOn] = await Promise.all([
    GetMatchResults(),
    GetScreenshotsDir(),
    GetPrometheusEnabled(),
  ])
  records.value = recs ?? []
  screenshotsDir.value = dir || ''
  prometheusEnabled.value = !!promOn
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

onMounted(load)
</script>

<template>
  <div class="container">
    <div class="page-header">
      <h1>OWMetrics</h1>
      <div class="top-right">
        <div class="wld-summary" v-if="records.length > 0" title="Wins · Losses · Draws across the currently filtered matches">
          <span class="wld-w">{{ wld.victory }}W</span>
          <span class="wld-l">{{ wld.defeat }}L</span>
          <span class="wld-d">{{ wld.draw }}D</span>
        </div>
        <label class="prom-toggle" title="Lets the Grafana dashboard read your matches over localhost:9091. Off by default — no network port is opened until you enable this.">
          <input type="checkbox" :checked="prometheusEnabled" @change="togglePrometheus" />
          <span>Send match data to Grafana</span>
        </label>
      </div>
    </div>

    <div class="parse-row">
      <!-- Directory + Change live as one visual unit on the left so the
           eye reads them together (the button "belongs to" the path).
           The Parse button is pushed to the far right via margin-left:
           auto on .parse-btn. -->
      <span class="dir-current" :title="screenshotsDir">
        <span class="dir-label">Reading from</span>
        <span class="dir-path">{{ screenshotsDir || '—' }}</span>
      </span>
      <button class="dir-change" @click="pickDir" :disabled="loading">Change…</button>
      <button class="parse-btn" @click="parse" :disabled="loading">
        {{ loading
            ? (screenshotsDir ? `Parsing from ${screenshotsDir}…` : 'Parsing…')
            : 'Parse Screenshots' }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="records.length === 0 && !loading" class="empty">
      No results yet. Click "Parse Screenshots" to analyse the screenshots/ directory.
    </div>

    <!-- Filters split into two lines: dropdowns + actions on row 1,
         date-range pickers (which need wider space + room to breathe)
         on their own row 2. -->
    <div v-if="records.length > 0" class="filters">
      <!-- Dropdown order: Mode first (broadest filter — Competitive vs
           Quickplay), then map → type → role → hero → result mirroring
           the badge order in each card header. -->
      <select v-model="filterMode">
        <option value="">All modes</option>
        <option v-for="m in modes" :key="m" :value="m">{{ m }}</option>
      </select>
      <select v-model="filterMap">
        <option value="">All maps</option>
        <option v-for="m in maps" :key="m" :value="m">{{ m }}</option>
      </select>
      <select v-model="filterType">
        <option value="">All types</option>
        <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
      </select>
      <select v-model="filterRole">
        <option value="">All roles</option>
        <option v-for="r in roles" :key="r" :value="r">{{ r }}</option>
      </select>
      <select v-model="filterHero">
        <option value="">All heroes</option>
        <option v-for="h in heroes" :key="h" :value="h">{{ h }}</option>
      </select>
      <select v-model="filterResult">
        <option value="">All results</option>
        <option v-for="r in results" :key="r" :value="r">{{ r }}</option>
      </select>
      <button class="sort" @click="toggleSort" :title="sortDir === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'">
        {{ sortDir === 'desc' ? '↓ Newest' : '↑ Oldest' }}
      </button>
      <button class="sort" @click="toggleAll" :title="allExpanded ? 'Collapse every visible card' : 'Expand every visible card'">
        {{ allExpanded ? 'Collapse all' : 'Expand all' }}
      </button>
      <button v-if="anyFilter" class="clear" @click="clearFilters">Clear</button>
      <span class="count">{{ filteredSorted.length }} / {{ records.length }}</span>
    </div>

    <div v-if="records.length > 0" class="filters date-range">
      <label class="range-label" title="Earliest match time to include">
        From
        <input
          type="datetime-local"
          v-model="filterFrom"
          :min="earliestMatchDateTime"
          :max="nowDateTime"
          class="datetime"
        />
      </label>
      <label class="range-label" title="Latest match time to include">
        To
        <input
          type="datetime-local"
          v-model="filterTo"
          :min="earliestMatchDateTime"
          :max="nowDateTime"
          class="datetime"
        />
      </label>
      <button
        class="sort"
        @click="resetDateRange"
        :disabled="!filterFrom && !filterTo"
        title="Clear both date pickers"
      >Reset</button>
    </div>

    <div v-for="rec in filteredSorted" :key="rec.id" class="card" :class="{ expanded: isExpanded(rec.id) }">
      <!-- Clicking anywhere on the header that ISN'T a badge toggles
           expand. Each badge uses @click.stop so its filter action
           doesn't bubble up and trigger the expand toggle. -->
      <div class="card-header" @click="toggleExpand(rec.id)">
        <span class="chevron" :class="{ open: isExpanded(rec.id) }">▶</span>
        <span
          class="map clickable" :class="{ active: isActive('map', rec.data.map) }"
          @click.stop="toggleFilter('map', rec.data.map)"
          title="Click to filter by this map"
        >{{ rec.data.map }}</span>
        <span
          v-if="rec.data.type" class="type clickable" :class="{ active: isActive('type', rec.data.type) }"
          @click.stop="toggleFilter('type', rec.data.type)"
          title="Click to filter by this game type"
        >{{ rec.data.type }}</span>
        <span
          v-if="rec.data.role" class="role clickable" :class="[rec.data.role, { active: isActive('role', rec.data.role) }]"
          @click.stop="toggleFilter('role', rec.data.role)"
          title="Click to filter by this role"
        >{{ rec.data.role }}</span>
        <template v-for="(hp, i) in heroesForHeader(rec)" :key="hp.hero">
          <span
            class="hero clickable" :class="{ active: isActive('hero', hp.hero) }"
            @click.stop="toggleFilter('hero', hp.hero)"
            :title="hp.percent_played != null ? `${hp.hero} — ${hp.percent_played}% played` : 'Click to filter by this hero'"
          >{{ hp.hero }}</span>
          <span v-if="i < heroesForHeader(rec).length - 1" class="hero-sep">|</span>
        </template>
        <span
          v-if="rec.data.result" class="result clickable" :class="[rec.data.result, { active: isActive('result', rec.data.result) }]"
          @click.stop="toggleFilter('result', rec.data.result)"
          title="Click to filter by this result"
        >{{ rec.data.result }}</span>
        <span class="when" v-if="fmtTime(rec)">{{ fmtTime(rec) }}</span>
        <span v-if="rec.data.game_length" class="length">⏱ {{ rec.data.game_length }}</span>
      </div>

      <template v-if="isExpanded(rec.id)">
        <div v-if="rec.data.final_score" class="meta">
          <div class="meta-item"><label>Final Score</label><span>{{ rec.data.final_score }}</span></div>
        </div>

        <div class="stats">
          <div class="stat"><label>Elims</label><span>{{ rec.data.eliminations }}</span></div>
          <div class="stat"><label>Assists</label><span>{{ rec.data.assists }}</span></div>
          <div class="stat"><label>Deaths</label><span>{{ rec.data.deaths }}</span></div>
          <div class="stat"><label>Damage</label><span>{{ rec.data.damage?.toLocaleString() }}</span></div>
          <div class="stat"><label>Healing</label><span>{{ rec.data.healing?.toLocaleString() }}</span></div>
          <div class="stat"><label>Mitigation</label><span>{{ rec.data.mitigation?.toLocaleString() }}</span></div>
        </div>

        <div v-if="rec.data.rank" class="rank-block">
          <label>Rank</label>
          <div class="rank-line">
            <span class="rank-tier" :class="rec.data.rank">{{ rec.data.rank }} {{ rec.data.level }}</span>
            <span v-if="rec.data.rank_progress" class="rank-progress">{{ rec.data.rank_progress }}% progress</span>
            <span v-if="rec.data.change_percent" class="rank-change">+{{ rec.data.change_percent }}%</span>
            <span v-for="m in rec.data.modifiers" :key="m" class="rank-modifier">{{ m }}</span>
          </div>
          <div v-if="rec.data.sr?.length" class="sr-line">
            <span v-for="s in rec.data.sr" :key="s.hero" class="sr-entry">
              {{ s.hero }}: {{ s.sr }} <span class="sr-delta" :class="s.change >= 0 ? 'up' : 'down'">{{ s.change >= 0 ? '+' : '' }}{{ s.change }}</span>
            </span>
          </div>
        </div>

        <!-- Heroes Played: label in a left column, hero blocks stacked
             in the right column. -->
        <div v-if="rec.data.heroes_played?.length" class="heroes-played-list">
          <label>Heroes Played</label>
          <div class="heroes-played-items">
            <div v-for="hp in rec.data.heroes_played" :key="hp.hero" class="hero-block">
              <div class="hero-header">
                <span class="hero-name clickable" :class="{ active: isActive('hero', hp.hero) }" @click="toggleFilter('hero', hp.hero)">{{ hp.hero }}</span>
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

        <!-- Source screenshots: bottom of the card, its own collapse so
             users who don't care about provenance don't have to look
             at filenames. Each filename is clickable to preview the
             actual screenshot inline. -->
        <div v-if="rec.source_files?.length" class="sources-block">
          <div class="sources-toggle" @click="toggleSources(rec.id)">
            <span class="chevron" :class="{ open: isSourcesOpen(rec.id) }">▶</span>
            <span class="sources-label">Source screenshots ({{ rec.source_files.length }})</span>
          </div>
          <div v-if="isSourcesOpen(rec.id)" class="sources">
            <div v-for="f in rec.source_files" :key="f" class="source-file">
              <a
                class="source-name"
                @click.prevent="togglePreview(f)"
                :href="screenshotURL(f)"
                :title="isPreviewOpen(f) ? 'Hide preview' : 'Show preview'"
              >
                <span class="chevron" :class="{ open: isPreviewOpen(f) }">▶</span>
                {{ f }}
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
      </template>
    </div>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #1a1a2e; color: #e0e0e0; font-family: sans-serif; }

.container { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }

.page-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 1.5rem; gap: 1rem;
}
h1 { font-size: 1.8rem; color: #7ec8e3; }
.top-right {
  display: flex; flex-direction: column; align-items: flex-end; gap: 0.5rem;
}
.wld-summary {
  display: flex; gap: 0.8rem; font-size: 1.2rem; font-weight: 800;
  font-feature-settings: "tnum"; /* tabular figures so digits don't dance */
}
.wld-w { color: #6bffb8; }
.wld-l { color: #ff6b6b; }
.wld-d { color: #f0a500; }

button {
  background: #0077b6; color: #fff; border: none;
  padding: 0.5rem 1.4rem; border-radius: 4px; cursor: pointer; font-size: 0.95rem;
}
button:hover:not(:disabled) { background: #005f92; }
button:disabled { opacity: 0.5; cursor: default; }

.error { color: #ff6b6b; margin-top: 1rem; font-size: 0.9rem; }
.empty { color: #888; margin-top: 2rem; }

.parse-row {
  display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap;
}
.dir-current {
  display: flex; flex-direction: column; gap: 0.1rem;
  font-size: 0.8rem;
}
.dir-label { color: #666; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.05em; }
.dir-path {
  color: #aaa; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all;
}
.dir-change {
  background: transparent; color: #aaa; border: 1px solid #444;
  padding: 0.4rem 0.8rem; font-size: 0.85rem; border-radius: 4px; cursor: pointer;
}
.dir-change:hover:not(:disabled) { color: #e0e0e0; border-color: #888; background: transparent; }
.dir-change:disabled { opacity: 0.4; cursor: default; }
/* Push the Parse button to the far right, separate from the dir +
   Change pair that sits on the left. */
.parse-btn { margin-left: auto; }

.prom-toggle {
  display: inline-flex; align-items: center; gap: 0.4rem;
  font-size: 0.8rem; color: #888; cursor: pointer; user-select: none;
}
.prom-toggle:hover { color: #aaa; }
.prom-toggle input { cursor: pointer; }

.filters {
  display: flex; gap: 0.5rem; margin-top: 1.2rem; flex-wrap: wrap; align-items: center;
}
.filters.date-range {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #0f3460;
}
.filters select {
  background: #16213e; color: #e0e0e0; border: 1px solid #0f3460;
  border-radius: 4px; padding: 0.35rem 0.5rem; font-size: 0.9rem;
  text-transform: capitalize; cursor: pointer;
}
.filters select:focus { outline: none; border-color: #7ec8e3; }
.filters .sort,
.filters .clear {
  background: transparent; color: #aaa; border: 1px solid #444;
  padding: 0.3rem 0.7rem; font-size: 0.8rem; border-radius: 4px; cursor: pointer;
}
.filters .sort:hover,
.filters .clear:hover { color: #e0e0e0; border-color: #888; background: transparent; }
.filters .count { font-size: 0.8rem; color: #666; margin-left: auto; }
.range-label {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em;
}
.filters input.datetime {
  background: #16213e; color: #e0e0e0; border: 1px solid #0f3460;
  border-radius: 4px; padding: 0.3rem 0.5rem; font-size: 0.85rem;
  color-scheme: dark;
}
.filters input.datetime:focus { outline: none; border-color: #7ec8e3; }

.card {
  background: #16213e; border: 1px solid #0f3460;
  border-radius: 6px; padding: 1rem; margin-top: 0.6rem;
  transition: border-color 120ms ease;
}
.card.expanded { border-color: #1f3a6e; margin-top: 1.2rem; margin-bottom: 1.2rem; }

.card-header {
  display: flex; align-items: center; gap: 0.6rem;
  flex-wrap: wrap;
  cursor: pointer;
  margin: -0.2rem 0;
}
.card.expanded > .card-header { margin-bottom: 0.6rem; }

.chevron {
  font-size: 0.65rem; color: #888; transition: transform 120ms ease;
  display: inline-block;
}
.chevron.open { transform: rotate(90deg); color: #7ec8e3; }

/* Clickable badges share the same hover/active treatment regardless of color. */
.clickable {
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  user-select: none;
}
.clickable:hover { filter: brightness(1.25); transform: translateY(-1px); }
.clickable.active {
  box-shadow: 0 0 0 2px #7ec8e3aa;
}

.map { font-size: 1rem; font-weight: 600; text-transform: capitalize; color: #7ec8e3; padding: 2px 6px; border-radius: 4px; }
.type { font-size: 0.7rem; padding: 2px 6px; border-radius: 3px; background: #0f3460; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; }
.hero { font-size: 0.9rem; text-transform: capitalize; color: #f0a500; padding: 2px 6px; border-radius: 4px; }
.hero-sep { color: #555; font-size: 0.85rem; user-select: none; margin: 0 -0.2rem; }
.when { font-size: 0.85rem; color: #aaa; margin-left: auto; }
.length { font-size: 0.85rem; color: #888; }
.sources-block { margin-top: 0.8rem; padding-top: 0.6rem; border-top: 1px solid #0f3460; }
.sources-toggle {
  display: flex; align-items: center; gap: 0.4rem; cursor: pointer;
  font-size: 0.75rem; color: #888; user-select: none;
}
.sources-toggle:hover { color: #aaa; }
.sources-label { letter-spacing: 0.03em; }
.sources {
  margin-top: 0.4rem; padding: 0.5rem 0.6rem;
  background: #0a1224; border-radius: 4px;
  font-size: 0.7rem; word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.source-file + .source-file { margin-top: 0.4rem; }
.source-name {
  display: inline-flex; align-items: center; gap: 0.3rem;
  color: #7ec8e3; cursor: pointer; text-decoration: none;
  padding: 0.15rem 0.3rem; border-radius: 3px;
}
.source-name:hover { background: #0f3460; color: #a7d9ef; }
.source-name .chevron { font-size: 0.55rem; }
/* Preview image: constrained so it fills the card without overflowing
   or pushing the layout. max-width caps horizontal size to the card's
   inner width; max-height keeps very tall screenshots scrollable
   within reason. object-fit defaults to fill-aspect for <img>, so the
   image keeps its proportions. */
.source-preview {
  display: block;
  margin: 0.4rem 0 0.2rem 0;
  max-width: 100%;
  max-height: 420px;
  height: auto;
  border-radius: 4px;
  border: 1px solid #0f3460;
  background: #000;
}

.role {
  font-size: 0.75rem; padding: 2px 8px; border-radius: 10px;
  text-transform: uppercase; font-weight: 700;
}
.role.dps     { background: #ff4d4d22; color: #ff6b6b; border: 1px solid #ff4d4d66; }
.role.tank    { background: #4d94ff22; color: #7ec8e3; border: 1px solid #4d94ff66; }
.role.support { background: #4dff8822; color: #6bffb8; border: 1px solid #4dff8866; }

.result {
  font-size: 0.75rem; padding: 2px 8px; border-radius: 10px;
  text-transform: uppercase; font-weight: 700;
}
.result.victory { background: #4dff8822; color: #6bffb8; border: 1px solid #4dff8866; }
.result.defeat  { background: #ff4d4d22; color: #ff6b6b; border: 1px solid #ff4d4d66; }
.result.draw    { background: #88888822; color: #aaa;    border: 1px solid #88888866; }

.meta { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 0.8rem; }
.meta-item { display: flex; flex-direction: column; min-width: 6rem; }
.meta-item label { font-size: 0.65rem; color: #888; text-transform: uppercase; margin-bottom: 2px; }
.meta-item span  { font-size: 0.9rem; color: #e0e0e0; text-transform: capitalize; }

.stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.6rem; }

.rank-block { margin-top: 0.8rem; }
.rank-block > label { display: block; font-size: 0.65rem; color: #888; text-transform: uppercase; margin-bottom: 0.4rem; }
.rank-line { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin-bottom: 0.4rem; }
.rank-tier { font-size: 0.9rem; font-weight: 700; text-transform: capitalize; padding: 2px 8px; border-radius: 4px; background: #0f3460; color: #e0e0e0; }
.rank-tier.bronze    { color: #cd7f32; }
.rank-tier.silver    { color: #c0c0c0; }
.rank-tier.gold      { color: #ffd700; }
.rank-tier.platinum  { color: #66ddc8; }
.rank-tier.diamond   { color: #b9f2ff; }
.rank-tier.master    { color: #e0c4ff; }
.rank-tier.grandmaster, .rank-tier.champion { color: #ff6b6b; }
.rank-progress { font-size: 0.8rem; color: #aaa; }
.rank-change   { font-size: 0.8rem; color: #6bffb8; font-weight: 700; }
.rank-modifier { font-size: 0.7rem; padding: 2px 6px; background: #0f3460; color: #aaa; border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em; }
.sr-line { display: flex; flex-wrap: wrap; gap: 0.8rem; }
.sr-entry { font-size: 0.85rem; color: #e0e0e0; text-transform: capitalize; }
.sr-delta.up   { color: #6bffb8; font-weight: 700; }
.sr-delta.down { color: #ff6b6b; font-weight: 700; }

.heroes-played-list {
  margin-top: 0.8rem;
  display: grid;
  grid-template-columns: 130px 1fr;
  gap: 1rem;
  align-items: start;
}
.heroes-played-list > label {
  font-size: 0.65rem; color: #888; text-transform: uppercase;
  letter-spacing: 0.05em; padding-top: 0.4rem;
}
.heroes-played-items { display: flex; flex-direction: column; gap: 0.8rem; }
.hero-block { margin-bottom: 0.8rem; }
.hero-block:last-child { margin-bottom: 0; }
.hero-header { display: flex; gap: 0.6rem; align-items: baseline; margin-bottom: 0.4rem; }
.hero-name { font-size: 0.95rem; font-weight: 700; color: #f0a500; text-transform: capitalize; padding: 2px 6px; border-radius: 4px; }
.hero-pct  { font-size: 0.8rem; color: #aaa; }
.hero-time { font-size: 0.8rem; color: #666; }

.personal-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.4rem; }
.personal-item { background: #0f3460; border-radius: 4px; padding: 0.35rem 0.6rem; display: flex; justify-content: space-between; align-items: center; }
.personal-label { font-size: 0.7rem; color: #aaa; text-transform: capitalize; }
.personal-value { font-size: 0.9rem; font-weight: 700; color: #e0e0e0; }

.stat {
  background: #0f3460; border-radius: 4px; padding: 0.5rem 0.7rem;
  display: flex; flex-direction: column; align-items: center;
}
.stat label { font-size: 0.65rem; color: #888; text-transform: uppercase; margin-bottom: 2px; }
.stat span  { font-size: 1.05rem; font-weight: 700; }
</style>
