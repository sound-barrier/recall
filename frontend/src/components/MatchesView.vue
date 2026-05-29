<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MatchRecord } from '../api'
import { useModalFocusTrap } from '../composables/useModalFocusTrap'
import { useMatchesGroup } from '../composables/useMatchesGroup'
import { useMatchesDossier } from '../composables/useMatchesDossier'
import MatchTimelineHeader from './MatchTimelineHeader.vue'

// Matches page — "set workspace" layout.
//
//   ┌──────────────────────────────────────────────────────┐
//   │  SET DOSSIER                                         │
//   │  ── headline · active-clause chips · narrow trigger  │
//   │  ── KPIs + top maps + top heroes inline              │
//   ├──────────────────────────────────────────────────────┤
//   │  Campaign Log (heatmap + sparkline)                  │
//   │  ── trailing 3/6/12 month view, brushable            │
//   ├──────────────────────────────────────────────────────┤
//   │  Members (the matches of the set)                    │
//   │  ── sort + group controls                            │
//   │  ── grouped section dividers (D / W / M / Y)         │
//   │  ── one row per match, click → drill                 │
//   └──────────────────────────────────────────────────────┘
//
// Filter dimensions exposed via the left "Narrow this set" panel:
//
//   text search (/), preset range, custom from/to dates,
//   map, map type, hero (broad-match against heroes_played[]),
//   role, result, tags, leaver handling, min play time + percent
//   (OR semantics), include-unknown-map toggle.
//
// Unknown-map records are hidden by default — they live in the
// Unknown tab. Toggle in the narrow panel to opt them in. Per-match
// drill-down still emits open-match → App.vue routes through
// useSelectedMatch → MatchDetailPanel (right-side slide-out).

const props = defineProps<{
  records: MatchRecord[]
}>()

const emit = defineEmits<{
  'open-match': [matchKey: string]
  // Lets App.vue mirror MatchDetailPanel's parity: while the narrow
  // panel is open, App.vue should set `inert` + `aria-hidden` on the
  // background container and ParseStatusBar so screen readers + Tab
  // keyboard nav don't bleed into the dimmed page.
  'narrow-open': [open: boolean]
}>()

// ─── Narrow state ───────────────────────────────────────────
//
// Everything mutable lives here as refs so the dossier + leaves
// react to picker changes without a separate "apply" step. The
// real implementation will route through useMatchFilters so the
// heatmap / sparkline / other surfaces see the same scope; this
// sketch keeps the filter logic inline so the layout iteration
// stays decoupled from the composable surface.

const narrowOpen = ref(false)

const searchText  = ref('')

const pickedMaps      = ref(new Set<string>())
const pickedMapTypes  = ref(new Set<string>())
const pickedHeroes    = ref(new Set<string>())
const pickedRoles     = ref(new Set<string>())
const pickedResults   = ref(new Set<string>())
const pickedTags      = ref(new Set<string>())

const pickedRange = ref<'all' | '7d' | '30d' | '90d' | 'custom'>('all')
const customFrom  = ref('')   // YYYY-MM-DD
const customTo    = ref('')

const leaverHandling = ref<'include' | 'exclude-tally' | 'hide'>('include')
// Two thresholds — either one triggers the hero filter to require
// the picked hero have at least that play time. OR semantics, just
// like useMinPlayThreshold in production.
const minPlayMinutes = ref(0)
const minPlayPercent = ref(0)
const includeUnknown = ref(false) // Unknown-map matches live in the Unknown tab by default.

const sortOrder = ref<'newest' | 'oldest'>('newest')
const groupBy   = ref<'none' | 'day' | 'week' | 'month' | 'year'>('day')

// Combobox: typeahead text + which combo is currently open. 51 heroes
// and 31 maps don't fit a chip cloud — buttons would either wrap into
// a wall or scroll behind picked chips. A combobox shows selected
// items above as removable pills + a typeahead input + a scrollable
// dropdown of all options below.
const mapSearch  = ref('')
const heroSearch = ref('')
const comboOpen  = ref<'map' | 'hero' | null>(null)

function toggleSet(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}
const pickMap     = (v: string) => { pickedMaps.value     = toggleSet(pickedMaps.value, v) }
const pickMapType = (v: string) => { pickedMapTypes.value = toggleSet(pickedMapTypes.value, v) }
const pickHero    = (v: string) => { pickedHeroes.value   = toggleSet(pickedHeroes.value, v) }
const pickRole    = (v: string) => { pickedRoles.value    = toggleSet(pickedRoles.value, v) }
const pickResult  = (v: string) => { pickedResults.value  = toggleSet(pickedResults.value, v) }
const pickTag     = (v: string) => { pickedTags.value     = toggleSet(pickedTags.value, v) }

function pickRange(v: 'all' | '7d' | '30d' | '90d' | 'custom') {
  pickedRange.value = v
  if (v !== 'custom') { customFrom.value = ''; customTo.value = '' }
}

function resetNarrow() {
  searchText.value      = ''
  pickedMaps.value      = new Set()
  pickedMapTypes.value  = new Set()
  pickedHeroes.value    = new Set()
  pickedRoles.value     = new Set()
  pickedResults.value   = new Set()
  pickedTags.value      = new Set()
  pickedRange.value     = 'all'
  customFrom.value      = ''
  customTo.value        = ''
  leaverHandling.value  = 'include'
  minPlayMinutes.value  = 0
  minPlayPercent.value  = 0
  includeUnknown.value  = false
}

const activeClauseCount = computed(() => {
  let n = 0
  if (searchText.value.trim()) n++
  if (pickedRange.value !== 'all') n++
  if (customFrom.value || customTo.value) n++
  n += pickedMaps.value.size
  n += pickedMapTypes.value.size
  n += pickedHeroes.value.size
  n += pickedRoles.value.size
  n += pickedResults.value.size
  n += pickedTags.value.size
  if (leaverHandling.value !== 'include') n++
  if (minPlayMinutes.value > 0) n++
  if (minPlayPercent.value > 0) n++
  if (includeUnknown.value) n++
  return n
})
const anyNarrow = computed(() => activeClauseCount.value > 0)

// ─── Helpers ────────────────────────────────────────────────

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)].filter((v) => v != null && v !== '') as T[]
}

// Hero universe — UNION of `data.hero` AND every entry in
// `data.heroes_played[]`. The current FilterRail does the same
// (matches "any hero played in the match", not just the primary).
const availableMaps = computed(() => uniq(props.records.map((r) => r.data?.map ?? '')).sort())
const availableMapTypes = computed(() => uniq(props.records.map((r) => r.data?.type ?? '')).sort())
const availableHeroes = computed(() => {
  const set = new Set<string>()
  for (const r of props.records) {
    if (r.data?.hero) set.add(r.data.hero)
    for (const hp of r.data?.heroes_played ?? []) {
      if (hp.hero) set.add(hp.hero)
    }
  }
  return [...set].sort()
})
const availableRoles   = computed(() => uniq(props.records.map((r) => r.data?.role ?? '')).sort())
const availableResults = computed(() => uniq(props.records.map((r) => r.data?.result ?? '')).sort())
const availableTags    = computed(() => {
  const set = new Set<string>()
  for (const r of props.records) {
    for (const t of r.annotation?.tags ?? []) if (t) set.add(t)
  }
  return [...set].sort()
})

const filteredMapOptions = computed(() => {
  const q = mapSearch.value.trim().toLowerCase()
  return q ? availableMaps.value.filter((m) => m.toLowerCase().includes(q)) : availableMaps.value
})
const filteredHeroOptions = computed(() => {
  const q = heroSearch.value.trim().toLowerCase()
  return q ? availableHeroes.value.filter((h) => h.toLowerCase().includes(q)) : availableHeroes.value
})

// Parse "M:SS" or "H:MM:SS" play_time / game_length into minutes.
function parsePlayTimeMinutes(s: string): number {
  if (!s) return 0
  const parts = s.split(':').map((x) => parseInt(x, 10))
  if (parts.some((n) => isNaN(n))) return 0
  if (parts.length === 2) return parts[0]! + parts[1]! / 60
  if (parts.length === 3) return parts[0]! * 60 + parts[1]! + parts[2]! / 60
  return parts[0] ?? 0
}

function daysAgoISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

// ─── Filtering ──────────────────────────────────────────────

const narrowedRecords = computed(() => {
  // Unknown-map matches default to hidden — they live in the
  // Unknown tab. The toggle in the popover lets a user override
  // for specific investigations.
  const base = includeUnknown.value
    ? props.records
    : props.records.filter((r) => !!r.data?.map)

  const search = searchText.value.trim().toLowerCase()

  // Time window — custom dates win when set, otherwise preset.
  let cutoffFrom: string | null = null
  let cutoffTo:   string | null = null
  if (customFrom.value) cutoffFrom = customFrom.value
  if (customTo.value)   cutoffTo   = customTo.value
  if (!cutoffFrom && pickedRange.value !== 'all' && pickedRange.value !== 'custom') {
    const days = pickedRange.value === '7d' ? 7 : pickedRange.value === '30d' ? 30 : 90
    cutoffFrom = daysAgoISO(days)
  }

  return base.filter((r) => {
    const d = r.data
    if (!d) return false

    // Free-text search across the obvious lexical surfaces.
    if (search) {
      const heroesPlayedNames = (d.heroes_played ?? []).map((h) => h.hero ?? '').filter(Boolean)
      const blob = [
        d.map, d.mode, d.hero, d.role, d.type,
        r.annotation?.note,
        ...heroesPlayedNames,
        ...(r.annotation?.tags ?? []),
      ].filter(Boolean).join(' ').toLowerCase()
      if (!blob.includes(search)) return false
    }

    // Date range — applies only to dated rows; undated rows fall
    // through unfiltered to stay consistent with includeUndated
    // semantics in the real FilterRail.
    const dateKey = d.date ?? ''
    if (dateKey) {
      if (cutoffFrom && dateKey < cutoffFrom) return false
      if (cutoffTo   && dateKey > cutoffTo)   return false
    }

    if (pickedMaps.value.size     && !pickedMaps.value.has(d.map ?? ''))   return false
    if (pickedMapTypes.value.size && !pickedMapTypes.value.has(d.type ?? '')) return false
    if (pickedRoles.value.size    && !pickedRoles.value.has(d.role ?? ''))  return false
    if (pickedResults.value.size  && !pickedResults.value.has(d.result ?? '')) return false

    // Hero filter — broad match against the primary AND every
    // heroes_played entry. When either min-play threshold is set,
    // the picked hero must satisfy at least one of them via a
    // heroes_played row (the primary alone isn't enough when a
    // threshold is active — same semantics as useMatchFilters).
    if (pickedHeroes.value.size) {
      const minMin = minPlayMinutes.value
      const minPct = minPlayPercent.value
      const anyThreshold = minMin > 0 || minPct > 0
      const matchedAny = [...pickedHeroes.value].some((wanted) => {
        if (d.hero === wanted && !anyThreshold) return true
        return (d.heroes_played ?? []).some((hp) => {
          if (hp.hero !== wanted) return false
          if (!anyThreshold) return true
          const minutes = parsePlayTimeMinutes(hp.play_time ?? '')
          const pct = hp.percent_played ?? 0
          return (minMin > 0 && minutes >= minMin) || (minPct > 0 && pct >= minPct)
        })
      })
      if (!matchedAny) return false
    }

    if (pickedTags.value.size) {
      const tags = new Set(r.annotation?.tags ?? [])
      const hit = [...pickedTags.value].some((t) => tags.has(t))
      if (!hit) return false
    }

    if (leaverHandling.value === 'hide' && r.annotation?.leaver) return false

    return true
  })
})

// ─── Dossier KPIs / breakdowns via useMatchesDossier ───────
const { wld, winrate, topMaps, topHeroes } = useMatchesDossier(narrowedRecords, leaverHandling)

const setHeadline = computed(() => {
  if (!anyNarrow.value) return 'All matches on record'
  const parts: string[] = []
  if (searchText.value.trim()) parts.push(`"${searchText.value.trim()}"`)
  if (customFrom.value || customTo.value) parts.push(`${customFrom.value || '…'} → ${customTo.value || '…'}`)
  else if (pickedRange.value !== 'all') parts.push(`last ${pickedRange.value}`)
  if (pickedMapTypes.value.size) parts.push([...pickedMapTypes.value].join('/'))
  if (pickedMaps.value.size)     parts.push([...pickedMaps.value].join(' · '))
  if (pickedRoles.value.size)    parts.push([...pickedRoles.value].join('/'))
  if (pickedHeroes.value.size)   parts.push([...pickedHeroes.value].join(' · '))
  if (pickedResults.value.size)  parts.push([...pickedResults.value].join('/'))
  if (pickedTags.value.size)     parts.push([...pickedTags.value].map((t) => `#${t}`).join(' '))
  return parts.join(' — ') || 'Active narrow'
})

const setSubline = computed(() => {
  const n = narrowedRecords.value.length
  if (!anyNarrow.value) return 'spans your full history'
  return `${n} of ${props.records.length} matches in this view`
})

// ─── Sort + group via useMatchesGroup composable ───────────
const { sortedRecords, groupedSections } = useMatchesGroup(narrowedRecords, groupBy, sortOrder)

function formatTime(rec: MatchRecord): string {
  return rec.data?.finished_at ?? ''
}
function formatRowDate(rec: MatchRecord): string {
  const d = rec.data?.date
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ─── Side-panel plumbing ──────────────────────────────────
//
// useModalFocusTrap matches the MatchDetailPanel's pattern:
//   • Tab/Shift+Tab cycles within `.left-panel`.
//   • Escape closes the panel via `onClose`.
//   • Focus is captured pre-open and restored to the trigger on close.
// The trap focuses the *first* focusable on open (the close × in
// header markup order); the watch below steals focus to the search
// input via a macrotask so `/` lands on the typeahead immediately.
//
// What the trap does NOT do: open the panel via `/`, dismiss the
// combobox dropdowns inside the panel, or set `inert` on the
// background. The first two are wired below; the third would need a
// flag emitted up to App.vue and is deferred for the sketch.

const popoverRef     = ref<HTMLElement | null>(null)
const triggerRef     = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)

useModalFocusTrap(narrowOpen, {
  containerSelector: '.left-panel',
  onClose: () => { narrowOpen.value = false },
})

function onDocumentMousedown(e: MouseEvent) {
  const tgt = e.target as HTMLElement | null
  if (!tgt) return

  // Close the combobox dropdown if the click landed outside its
  // container. `data-combo-id` matches the active combo's id.
  if (comboOpen.value && !tgt.closest(`[data-combo-id="${comboOpen.value}"]`)) {
    comboOpen.value = null
  }

  if (!narrowOpen.value) return
  if (popoverRef.value?.contains(tgt)) return
  if (triggerRef.value?.contains(tgt))  return
  narrowOpen.value = false
}

function onOpenShortcut(e: KeyboardEvent) {
  if (e.key !== '/') return
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  e.preventDefault()
  narrowOpen.value = true
  // Override the trap's default first-focusable target — the close
  // button — so `/` lands the cursor in the search input directly.
  // setTimeout(0) is a macrotask; the trap's await-nextTick focus is
  // a microtask. The macrotask wins → search gets focus last.
  setTimeout(() => searchInputRef.value?.focus(), 0)
}

// Toggle handler — emits narrow-open synchronously alongside the
// local flip so App.vue's matchesNarrowOpen ref (which gates `inert`
// on the background container + ParseStatusBar) stays in lockstep.
// Doing this through a watch was tempting but introduced a one-tick
// gap where the panel was visible but the background was still
// interactive.
function toggleNarrow() {
  narrowOpen.value = !narrowOpen.value
  emit('narrow-open', narrowOpen.value)
}

watch(narrowOpen, (open) => {
  if (open) setTimeout(() => searchInputRef.value?.focus(), 0)
  else {
    comboOpen.value = null
    emit('narrow-open', false)
  }
})

onMounted(() => {
  document.addEventListener('mousedown', onDocumentMousedown)
  document.addEventListener('keydown', onOpenShortcut)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocumentMousedown)
  document.removeEventListener('keydown', onOpenShortcut)
})
</script>

<template>
  <section
    id="panel-matches"
    role="tabpanel"
    aria-labelledby="tab-matches"
    tabindex="-1"
    class="matches-set-workspace"
  >
    <!-- ─── SET DOSSIER ─────────────────────────────────────── -->
    <section class="set-dossier" aria-label="Set dossier">
      <header class="dossier-head">
        <span class="dossier-eyebrow">{{ anyNarrow ? 'Narrowed set' : 'Set' }}</span>
        <h2 class="dossier-title">
          {{ setHeadline }}
        </h2>
        <span class="dossier-meta">{{ setSubline }}</span>

        <ul v-if="anyNarrow" class="active-chips" aria-label="Active narrowing clauses">
          <li v-if="searchText.trim()" class="active-chip search">
            <span class="chip-key">Search</span>
            <span class="chip-val">"{{ searchText.trim() }}"</span>
            <button class="chip-x" aria-label="Clear search" @click="searchText = ''">
              ×
            </button>
          </li>
          <li v-if="pickedRange !== 'all' && !customFrom && !customTo" class="active-chip range">
            <span class="chip-key">Range</span>
            <span class="chip-val">last {{ pickedRange }}</span>
            <button class="chip-x" aria-label="Drop range" @click="pickRange('all')">
              ×
            </button>
          </li>
          <li v-if="customFrom || customTo" class="active-chip range">
            <span class="chip-key">Dates</span>
            <span class="chip-val">{{ customFrom || '…' }} → {{ customTo || '…' }}</span>
            <button class="chip-x" aria-label="Clear dates" @click="customFrom = ''; customTo = ''; pickedRange = 'all'">
              ×
            </button>
          </li>
          <li v-for="m in [...pickedMaps]" :key="`m-${m}`" class="active-chip">
            <span class="chip-key">Map</span>
            <span class="chip-val">{{ m }}</span>
            <button class="chip-x" :aria-label="`Drop map ${m}`" @click="pickMap(m)">
              ×
            </button>
          </li>
          <li v-for="t in [...pickedMapTypes]" :key="`mt-${t}`" class="active-chip">
            <span class="chip-key">Type</span>
            <span class="chip-val">{{ t }}</span>
            <button class="chip-x" :aria-label="`Drop type ${t}`" @click="pickMapType(t)">
              ×
            </button>
          </li>
          <li v-for="h in [...pickedHeroes]" :key="`h-${h}`" class="active-chip">
            <span class="chip-key">Hero</span>
            <span class="chip-val">{{ h }}</span>
            <button class="chip-x" :aria-label="`Drop hero ${h}`" @click="pickHero(h)">
              ×
            </button>
          </li>
          <li v-for="r in [...pickedRoles]" :key="`r-${r}`" class="active-chip">
            <span class="chip-key">Role</span>
            <span class="chip-val">{{ r }}</span>
            <button class="chip-x" :aria-label="`Drop role ${r}`" @click="pickRole(r)">
              ×
            </button>
          </li>
          <li v-for="r in [...pickedResults]" :key="`res-${r}`" class="active-chip">
            <span class="chip-key">Result</span>
            <span class="chip-val">{{ r }}</span>
            <button class="chip-x" :aria-label="`Drop result ${r}`" @click="pickResult(r)">
              ×
            </button>
          </li>
          <li v-for="t in [...pickedTags]" :key="`tg-${t}`" class="active-chip">
            <span class="chip-key">Tag</span>
            <span class="chip-val">#{{ t }}</span>
            <button class="chip-x" :aria-label="`Drop tag ${t}`" @click="pickTag(t)">
              ×
            </button>
          </li>
          <li v-if="leaverHandling !== 'include'" class="active-chip">
            <span class="chip-key">Leavers</span>
            <span class="chip-val">{{ leaverHandling === 'hide' ? 'hidden' : 'no tally' }}</span>
            <button class="chip-x" aria-label="Reset leavers" @click="leaverHandling = 'include'">
              ×
            </button>
          </li>
          <li v-if="minPlayMinutes > 0" class="active-chip">
            <span class="chip-key">Min play</span>
            <span class="chip-val">≥ {{ minPlayMinutes }}m</span>
            <button class="chip-x" aria-label="Reset min play minutes" @click="minPlayMinutes = 0">
              ×
            </button>
          </li>
          <li v-if="minPlayPercent > 0" class="active-chip">
            <span class="chip-key">Min played</span>
            <span class="chip-val">≥ {{ minPlayPercent }}%</span>
            <button class="chip-x" aria-label="Reset min play percent" @click="minPlayPercent = 0">
              ×
            </button>
          </li>
          <li v-if="includeUnknown" class="active-chip">
            <span class="chip-key">Unknown</span>
            <span class="chip-val">shown</span>
            <button class="chip-x" aria-label="Hide unknown" @click="includeUnknown = false">
              ×
            </button>
          </li>
          <li class="active-chip clear">
            <button class="chip-clear" @click="resetNarrow">
              Clear all
            </button>
          </li>
        </ul>
      </header>

      <div class="dossier-kpis">
        <div class="kpi-tile">
          <span class="kpi-eyebrow">Winrate</span>
          <span class="kpi-value">{{ winrate !== null ? `${winrate}%` : '—' }}</span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-eyebrow">Record</span>
          <span class="kpi-value">
            <span class="t-w">{{ wld.w }}</span>·<span class="t-l">{{ wld.l }}</span>·<span class="t-d">{{ wld.d }}</span>
          </span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-eyebrow">Top map</span>
          <span class="kpi-value kpi-text">{{ topMaps[0]?.key || '—' }}</span>
        </div>
        <div class="kpi-tile">
          <span class="kpi-eyebrow">Top hero</span>
          <span class="kpi-value kpi-text">{{ topHeroes[0]?.key || '—' }}</span>
        </div>
      </div>

      <div class="dossier-breakdowns">
        <article class="breakdown">
          <header class="breakdown-head">
            <span class="breakdown-eyebrow">Top maps</span>
          </header>
          <ul>
            <li v-for="m in topMaps" :key="m.key">
              <span class="bd-name">{{ m.key }}</span>
              <span class="bd-bar"><span class="bd-fill" :style="{ width: m.winrate + '%' }" /></span>
              <span class="bd-stats">{{ m.winrate }}% <span class="bd-total">·{{ m.total }}</span></span>
            </li>
          </ul>
        </article>
        <article class="breakdown">
          <header class="breakdown-head">
            <span class="breakdown-eyebrow">Top heroes</span>
          </header>
          <ul>
            <li v-for="h in topHeroes" :key="h.key">
              <span class="bd-name">{{ h.key }}</span>
              <span class="bd-bar"><span class="bd-fill" :style="{ width: h.winrate + '%' }" /></span>
              <span class="bd-stats">{{ h.winrate }}% <span class="bd-total">·{{ h.total }}</span></span>
            </li>
          </ul>
        </article>
      </div>

      <!-- Narrow trigger + popover. -->
      <div class="dossier-actions">
        <div class="narrow-anchor">
          <button
            ref="triggerRef"
            class="dossier-btn primary"
            :class="{ 'is-open': narrowOpen }"
            :aria-expanded="narrowOpen ? 'true' : 'false'"
            aria-haspopup="true"
            aria-controls="narrow-popover"
            @click="toggleNarrow"
          >
            <span aria-hidden="true">⌗</span> Narrow this set
            <span v-if="anyNarrow" class="narrow-count">· {{ activeClauseCount }}</span>
          </button>

          <Teleport to="body">
            <Transition name="lp-fade">
              <div
                v-if="narrowOpen"
                class="lp-backdrop"
                aria-hidden="true"
                @click="narrowOpen = false"
              />
            </Transition>
          </Teleport>
          <Teleport to="body">
            <Transition name="lp-slide">
              <aside
                v-if="narrowOpen"
                id="narrow-popover"
                ref="popoverRef"
                class="left-panel"
                role="dialog"
                aria-modal="true"
                aria-label="Narrow this set"
              >
                <header class="np-head">
                  <span class="np-eyebrow">Narrow</span>
                  <h4 class="np-title">
                    Filter the set
                  </h4>
                  <span class="np-meta">{{ narrowedRecords.length }} / {{ props.records.length }} matches</span>
                  <button class="np-close" aria-label="Close narrow panel" @click="narrowOpen = false">
                    ×
                  </button>
                </header>

                <!-- Search row, full-width. -->
                <section class="np-section np-search-section">
                  <label class="np-section-eyebrow" for="np-search">Search</label>
                  <div class="np-search-row">
                    <span class="np-search-glyph" aria-hidden="true">⌕</span>
                    <input
                      id="np-search"
                      ref="searchInputRef"
                      v-model="searchText"
                      type="search"
                      class="np-search-input"
                      placeholder="map · hero · mode · note · tag"
                      autocomplete="off"
                      spellcheck="false"
                    >
                    <kbd class="np-search-kbd">/</kbd>
                  </div>
                </section>

                <!-- Time scope — preset + custom dates side-by-side. -->
                <section class="np-section">
                  <div class="np-section-head">
                    <span class="np-section-eyebrow">Time scope</span>
                    <span class="np-section-meta">
                      <template v-if="customFrom || customTo">{{ customFrom || '…' }} → {{ customTo || '…' }}</template>
                      <template v-else-if="pickedRange !== 'all'">last {{ pickedRange }}</template>
                      <template v-else>all time</template>
                    </span>
                  </div>
                  <div class="np-chips">
                    <button
                      v-for="opt in (['all', '7d', '30d', '90d'] as const)"
                      :key="opt"
                      class="np-chip"
                      :class="{ picked: pickedRange === opt && !customFrom && !customTo }"
                      @click="pickRange(opt)"
                    >
                      {{ opt === 'all' ? 'All time' : `Last ${opt}` }}
                    </button>
                  </div>
                  <div class="np-daterange">
                    <label class="np-date-label">
                      <span>From</span>
                      <input
                        type="date"
                        class="np-date"
                        :value="customFrom"
                        @input="customFrom = ($event.target as HTMLInputElement).value; pickedRange = 'custom'"
                      >
                    </label>
                    <label class="np-date-label">
                      <span>To</span>
                      <input
                        type="date"
                        class="np-date"
                        :value="customTo"
                        @input="customTo = ($event.target as HTMLInputElement).value; pickedRange = 'custom'"
                      >
                    </label>
                    <button
                      v-if="customFrom || customTo"
                      class="np-date-clear"
                      @click="customFrom = ''; customTo = ''; pickedRange = 'all'"
                    >
                      Clear dates
                    </button>
                  </div>
                </section>

                <!-- Two-column body — match context (left) + outcome / refinement (right). -->
                <div class="np-cols">
                  <div class="np-col">
                    <!-- Map — combobox (31 maps, too many for chip cloud) -->
                    <section class="np-section" data-combo-id="map">
                      <div class="np-section-head">
                        <span class="np-section-eyebrow">Map</span>
                        <span class="np-section-meta">
                          {{ pickedMaps.size ? `${pickedMaps.size} picked` : 'any' }}
                          · {{ availableMaps.length }} available
                        </span>
                      </div>
                      <div v-if="pickedMaps.size" class="combo-selected">
                        <span v-for="m in [...pickedMaps]" :key="m" class="combo-pill">
                          {{ m }}
                          <button class="combo-pill-x" :aria-label="`Drop ${m}`" @click="pickMap(m)">×</button>
                        </span>
                      </div>
                      <div class="combo">
                        <input
                          v-model="mapSearch"
                          type="search"
                          class="combo-input"
                          :placeholder="`type to search ${availableMaps.length} maps…`"
                          autocomplete="off"
                          @focus="comboOpen = 'map'"
                        >
                        <button
                          type="button"
                          class="combo-caret"
                          :class="{ open: comboOpen === 'map' }"
                          :aria-expanded="comboOpen === 'map' ? 'true' : 'false'"
                          :aria-label="comboOpen === 'map' ? 'Close map list' : 'Open map list'"
                          @click="comboOpen = comboOpen === 'map' ? null : 'map'"
                        >
                          ▾
                        </button>
                        <ul v-if="comboOpen === 'map'" class="combo-list" role="listbox" aria-label="Maps">
                          <li
                            v-for="opt in filteredMapOptions"
                            :key="opt"
                            :class="{ picked: pickedMaps.has(opt) }"
                            role="option"
                            :aria-selected="pickedMaps.has(opt) ? 'true' : 'false'"
                            @mousedown.prevent="pickMap(opt)"
                          >
                            <span class="combo-check" aria-hidden="true">{{ pickedMaps.has(opt) ? '✓' : '' }}</span>
                            <span class="combo-opt-name">{{ opt }}</span>
                          </li>
                          <li v-if="!filteredMapOptions.length" class="combo-empty">
                            no maps match
                          </li>
                        </ul>
                      </div>
                    </section>

                    <!-- Map type -->
                    <section class="np-section">
                      <div class="np-section-head">
                        <span class="np-section-eyebrow">Map type</span>
                        <span class="np-section-meta">{{ pickedMapTypes.size ? `${pickedMapTypes.size} picked` : 'any' }}</span>
                      </div>
                      <div class="np-chips">
                        <button
                          v-for="t in availableMapTypes"
                          :key="t"
                          class="np-chip"
                          :class="{ picked: pickedMapTypes.has(t) }"
                          @click="pickMapType(t)"
                        >
                          {{ t }}
                        </button>
                        <span v-if="!availableMapTypes.length" class="np-empty">none in corpus</span>
                      </div>
                    </section>

                    <!-- Hero — combobox (51 heroes, broad-match against heroes_played) -->
                    <section class="np-section" data-combo-id="hero">
                      <div class="np-section-head">
                        <span class="np-section-eyebrow">Hero</span>
                        <span class="np-section-meta">
                          {{ pickedHeroes.size ? `${pickedHeroes.size} picked` : 'any' }}
                          · {{ availableHeroes.length }} available · matches any played
                        </span>
                      </div>
                      <div v-if="pickedHeroes.size" class="combo-selected">
                        <span v-for="h in [...pickedHeroes]" :key="h" class="combo-pill">
                          {{ h }}
                          <button class="combo-pill-x" :aria-label="`Drop ${h}`" @click="pickHero(h)">×</button>
                        </span>
                      </div>
                      <div class="combo">
                        <input
                          v-model="heroSearch"
                          type="search"
                          class="combo-input"
                          :placeholder="`type to search ${availableHeroes.length} heroes…`"
                          autocomplete="off"
                          @focus="comboOpen = 'hero'"
                        >
                        <button
                          type="button"
                          class="combo-caret"
                          :class="{ open: comboOpen === 'hero' }"
                          :aria-expanded="comboOpen === 'hero' ? 'true' : 'false'"
                          :aria-label="comboOpen === 'hero' ? 'Close hero list' : 'Open hero list'"
                          @click="comboOpen = comboOpen === 'hero' ? null : 'hero'"
                        >
                          ▾
                        </button>
                        <ul v-if="comboOpen === 'hero'" class="combo-list" role="listbox" aria-label="Heroes">
                          <li
                            v-for="opt in filteredHeroOptions"
                            :key="opt"
                            :class="{ picked: pickedHeroes.has(opt) }"
                            role="option"
                            :aria-selected="pickedHeroes.has(opt) ? 'true' : 'false'"
                            @mousedown.prevent="pickHero(opt)"
                          >
                            <span class="combo-check" aria-hidden="true">{{ pickedHeroes.has(opt) ? '✓' : '' }}</span>
                            <span class="combo-opt-name">{{ opt }}</span>
                          </li>
                          <li v-if="!filteredHeroOptions.length" class="combo-empty">
                            no heroes match
                          </li>
                        </ul>
                      </div>
                    </section>

                    <!-- Role -->
                    <section class="np-section">
                      <div class="np-section-head">
                        <span class="np-section-eyebrow">Role</span>
                        <span class="np-section-meta">{{ pickedRoles.size ? `${pickedRoles.size} picked` : 'any' }}</span>
                      </div>
                      <div class="np-chips">
                        <button
                          v-for="r in availableRoles"
                          :key="r"
                          class="np-chip"
                          :class="{ picked: pickedRoles.has(r) }"
                          @click="pickRole(r)"
                        >
                          {{ r }}
                        </button>
                        <span v-if="!availableRoles.length" class="np-empty">none in corpus</span>
                      </div>
                    </section>
                  </div>

                  <div class="np-col">
                    <!-- Result -->
                    <section class="np-section">
                      <div class="np-section-head">
                        <span class="np-section-eyebrow">Result</span>
                        <span class="np-section-meta">{{ pickedResults.size ? `${pickedResults.size} picked` : 'any' }}</span>
                      </div>
                      <div class="np-chips">
                        <button
                          v-for="r in availableResults"
                          :key="r"
                          class="np-chip"
                          :class="{ picked: pickedResults.has(r) }"
                          @click="pickResult(r)"
                        >
                          {{ r }}
                        </button>
                      </div>
                    </section>

                    <!-- Tags -->
                    <section class="np-section">
                      <div class="np-section-head">
                        <span class="np-section-eyebrow">Tags</span>
                        <span class="np-section-meta">{{ pickedTags.size ? `${pickedTags.size} picked` : 'any' }}</span>
                      </div>
                      <div class="np-chips">
                        <button
                          v-for="t in availableTags"
                          :key="t"
                          class="np-chip"
                          :class="{ picked: pickedTags.has(t) }"
                          @click="pickTag(t)"
                        >
                          #{{ t }}
                        </button>
                        <span v-if="!availableTags.length" class="np-empty">no tags yet — add via match annotation</span>
                      </div>
                    </section>

                    <!-- Leavers -->
                    <section class="np-section">
                      <div class="np-section-head">
                        <span class="np-section-eyebrow">Leavers</span>
                        <span class="np-section-meta">{{ leaverHandling }}</span>
                      </div>
                      <div class="np-chips">
                        <button class="np-chip" :class="{ picked: leaverHandling === 'include' }" @click="leaverHandling = 'include'">
                          Include
                        </button>
                        <button class="np-chip" :class="{ picked: leaverHandling === 'exclude-tally' }" @click="leaverHandling = 'exclude-tally'">
                          Drop from tally
                        </button>
                        <button class="np-chip" :class="{ picked: leaverHandling === 'hide' }" @click="leaverHandling = 'hide'">
                          Hide entirely
                        </button>
                      </div>
                    </section>

                    <!-- Min play threshold (both minutes + percent; OR semantics) + unknown toggle -->
                    <section class="np-section">
                      <div class="np-section-head">
                        <span class="np-section-eyebrow">Refinement</span>
                        <span class="np-section-meta">applies to picked heroes</span>
                      </div>
                      <div class="np-refine-row">
                        <p class="np-refine-hint">
                          Picked hero must meet at least one threshold in a match's heroes-played row.
                        </p>
                        <div class="np-thresholds">
                          <label class="np-num-label">
                            <span>Min play time</span>
                            <div class="np-num-input">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                class="np-num"
                                :value="minPlayMinutes"
                                @input="minPlayMinutes = parseInt(($event.target as HTMLInputElement).value || '0', 10) || 0"
                              >
                              <span class="np-num-unit">min</span>
                            </div>
                          </label>
                          <span class="np-thresholds-or">or</span>
                          <label class="np-num-label">
                            <span>Min played %</span>
                            <div class="np-num-input">
                              <input
                                type="number"
                                min="0"
                                max="100"
                                step="5"
                                class="np-num"
                                :value="minPlayPercent"
                                @input="minPlayPercent = Math.max(0, Math.min(100, parseInt(($event.target as HTMLInputElement).value || '0', 10) || 0))"
                              >
                              <span class="np-num-unit">%</span>
                            </div>
                          </label>
                        </div>
                        <label class="np-toggle-label">
                          <input
                            type="checkbox"
                            :checked="includeUnknown"
                            @change="includeUnknown = ($event.target as HTMLInputElement).checked"
                          >
                          <span>Show unknown-map matches</span>
                        </label>
                      </div>
                    </section>
                  </div>
                </div>

                <footer class="np-foot">
                  <span class="np-foot-status">
                    {{ narrowedRecords.length }} match<span v-if="narrowedRecords.length !== 1">es</span> in this view
                  </span>
                  <div class="np-foot-actions">
                    <button class="np-btn ghost" :disabled="!anyNarrow" @click="resetNarrow">
                      Reset
                    </button>
                    <button class="np-btn primary" @click="narrowOpen = false">
                      Done
                    </button>
                  </div>
                </footer>
              </aside>
            </Transition>
          </Teleport>
        </div>
      </div>
    </section>

    <!-- ─── CAMPAIGN LOG (heatmap + sparkline) ──────────────── -->
    <MatchTimelineHeader
      v-if="props.records.length > 0"
      :records="props.records"
      :filter-from="customFrom"
      :filter-to="customTo"
      @update:filter-from="(v: string) => { customFrom = v; pickedRange = 'custom' }"
      @update:filter-to="(v: string) => { customTo = v; pickedRange = 'custom' }"
    />

    <!-- ─── MEMBERS ─────────────────────────────────────────── -->
    <section class="leaves" aria-label="Set members">
      <header class="leaves-head">
        <div class="leaves-head-left">
          <span class="leaves-eyebrow">Members</span>
          <h3 class="leaves-title">
            {{ sortedRecords.length }} matches in this set
          </h3>
        </div>
        <div class="leaves-head-controls">
          <fieldset class="seg" aria-label="Sort">
            <legend class="seg-legend">
              Sort
            </legend>
            <button
              class="seg-btn"
              :class="{ picked: sortOrder === 'newest' }"
              @click="sortOrder = 'newest'"
            >
              Newest <span aria-hidden="true">↓</span>
            </button>
            <button
              class="seg-btn"
              :class="{ picked: sortOrder === 'oldest' }"
              @click="sortOrder = 'oldest'"
            >
              Oldest <span aria-hidden="true">↑</span>
            </button>
          </fieldset>
          <fieldset class="seg" aria-label="Group by">
            <legend class="seg-legend">
              Group
            </legend>
            <button
              v-for="opt in (['none', 'day', 'week', 'month', 'year'] as const)"
              :key="opt"
              class="seg-btn"
              :class="{ picked: groupBy === opt }"
              @click="groupBy = opt"
            >
              {{ opt === 'none' ? '—' : opt[0]!.toUpperCase() }}
            </button>
          </fieldset>
        </div>
      </header>

      <ul v-if="sortedRecords.length" class="leaves-list" role="list">
        <template v-for="section in groupedSections" :key="section.key">
          <li v-if="section.header" class="section-divider" :aria-label="`Group: ${section.header}`">
            <span class="sd-label">{{ section.header }}</span>
            <span class="sd-count">{{ section.records.length }}</span>
            <span class="sd-line" aria-hidden="true" />
          </li>
          <li
            v-for="rec in section.records"
            :key="rec.match_key"
            class="leaf-row"
            :class="`result-${rec.data?.result || 'unknown'}`"
            @click="emit('open-match', rec.match_key)"
          >
            <!-- 1. Result-tinted color strip — instant scan target. -->
            <span class="leaf-strip" aria-hidden="true" />

            <!-- 2. When — date over time. -->
            <div class="leaf-when">
              <span class="leaf-when-date">{{ formatRowDate(rec) }}</span>
              <span class="leaf-when-time">{{ formatTime(rec) }}</span>
            </div>

            <!-- 3. Where — map (display font) over mode (small chip). -->
            <div class="leaf-map-block">
              <span class="leaf-map">{{ rec.data?.map || 'unknown' }}</span>
              <span v-if="rec.data?.mode" class="leaf-mode-row">
                <span class="leaf-mode-chip">{{ rec.data.mode }}</span>
              </span>
            </div>

            <!-- 4. Who — hero over role. -->
            <div class="leaf-hero-block">
              <span class="leaf-hero">{{ rec.data?.hero || '—' }}</span>
              <span v-if="rec.data?.role" class="leaf-role">{{ rec.data.role }}</span>
            </div>

            <!-- 5. How — eliminations / assists / deaths, big + bold. -->
            <div class="leaf-stats-block" :aria-label="`Eliminations ${rec.data?.eliminations ?? '?'}, assists ${rec.data?.assists ?? '?'}, deaths ${rec.data?.deaths ?? '?'}`">
              <span class="stat-num">{{ rec.data?.eliminations ?? '—' }}</span>
              <span class="stat-sep" aria-hidden="true">/</span>
              <span class="stat-num">{{ rec.data?.assists ?? '—' }}</span>
              <span class="stat-sep" aria-hidden="true">/</span>
              <span class="stat-num stat-deaths">{{ rec.data?.deaths ?? '—' }}</span>
            </div>

            <!-- 6. Annotations — leaver + tags. Empty when none. -->
            <div class="leaf-meta-block">
              <span v-if="rec.annotation?.leaver" class="leaf-leaver" :title="`Leaver: ${rec.annotation.leaver}`">L</span>
              <span
                v-for="t in rec.annotation?.tags ?? []"
                :key="t"
                class="leaf-tag"
              >#{{ t }}</span>
            </div>

            <!-- 7. Outcome chip — anchored to the right edge. -->
            <span class="leaf-result-chip" :class="`result-${rec.data?.result || 'unknown'}`">
              {{ rec.data?.result || '—' }}
            </span>
          </li>
        </template>
      </ul>
      <p v-else class="leaves-empty">
        No matches in this set.
        <button v-if="anyNarrow" class="leaves-empty-btn" @click="resetNarrow">
          Clear narrowing
        </button>
      </p>
    </section>
  </section>
</template>

<style scoped>
.matches-set-workspace {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

/* ─── Dossier ──────────────────────────────────────────────── */

.set-dossier {
  background:
    repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 3%, transparent) 0,
      color-mix(in srgb, var(--accent) 3%, transparent) 10px,
      transparent 10px,
      transparent 20px
    ),
    var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 1rem 1.2rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  position: relative;
}

.set-dossier::before {
  content: '';
  position: absolute;
  left: 0; top: 0;
  width: 4px; height: 100%;
  background: var(--accent);
  border-radius: 2px 0 0 2px;
}

.dossier-head { display: flex; flex-direction: column; gap: 0.2rem; }

.dossier-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.dossier-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 1.7rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin: 0;
  color: var(--text);
  line-height: 1.1;
}

.dossier-meta {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
}

.dossier-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
}

.kpi-tile {
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: 2px;
  padding: 0.55rem 0.7rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.kpi-eyebrow {
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.kpi-value {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 1.45rem;
  letter-spacing: -0.01em;
  color: var(--text);
  font-feature-settings: "tnum";
}
.kpi-value.kpi-text { font-size: 1.15rem; text-transform: uppercase; }

.t-w { color: var(--win); }
.t-l { color: var(--loss); }
.t-d { color: var(--text-mute); }

.dossier-breakdowns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.7rem;
}

@media (width <= 700px) {
  .dossier-breakdowns,
  .dossier-kpis { grid-template-columns: 1fr 1fr; }
}

.breakdown {
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface);
  padding: 0.55rem 0.7rem 0.65rem;
}
.breakdown-head { margin-bottom: 0.3rem; }

.breakdown-eyebrow {
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.breakdown ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.breakdown li {
  display: grid;
  grid-template-columns: minmax(80px, 110px) 1fr auto;
  align-items: center;
  gap: 0.5rem;
}

.bd-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 0.85rem;
  text-transform: uppercase;
  color: var(--text);
}

.bd-bar {
  background: var(--surface-2);
  height: 12px;
  border-radius: 2px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.bd-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 50%, var(--win)));
}

.bd-stats {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}
.bd-total { color: var(--text-faint); font-size: 0.6rem; }

.dossier-actions { display: flex; gap: 0.5rem; margin-top: 0.2rem; }

.dossier-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.45rem 0.9rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 700;
}

.dossier-btn.primary {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: var(--accent);
  color: var(--accent);
}

.dossier-btn.primary.is-open {
  background: var(--accent);
  color: var(--surface);
}

.dossier-btn:hover { border-color: var(--accent); color: var(--accent); }
.dossier-btn.primary.is-open:hover { color: var(--surface); }

.narrow-count { color: inherit; font-weight: 700; }

/* ─── Active-clause chips ──────────────────────────────────── */

.active-chips {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.active-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.18rem 0.18rem 0.5rem;
  background: var(--surface-2);
  border: 1px solid var(--accent-soft, var(--accent));
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text);
}

.active-chip.range, .active-chip.search { border-color: var(--accent); }

.chip-key {
  color: var(--text-faint);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 0.55rem;
}

.chip-val {
  color: var(--text);
  font-weight: 600;
  text-transform: lowercase;
}

.chip-x {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  padding: 0 0.3rem;
  font-size: 0.85rem;
  cursor: pointer;
  line-height: 1;
}
.chip-x:hover { color: var(--accent); }

.active-chip.clear {
  border: 1px dashed var(--text-faint);
  padding: 0;
}

.chip-clear {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0.18rem 0.55rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 700;
}
.chip-clear:hover { color: var(--accent); }

/* ─── Narrow popover ───────────────────────────────────────── */

.narrow-anchor { position: relative; }

/* ── Left filter side-panel ── mirrors MatchDetailPanel's right
   slide-out: fixed-position with translucent backdrop, slide-in
   from the left edge, full viewport height. Single 420-px column
   so every dimension stacks vertically — no two-column squeeze. */

.lp-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  backdrop-filter: blur(2px);
}

.left-panel {
  position: fixed;
  left: 0; top: 0;
  z-index: 100;
  width: min(420px, 100vw);
  height: 100vh;
  background: var(--surface);
  border-right: 1px solid var(--accent);
  box-shadow: 28px 0 60px -24px rgb(0 0 0 / 65%);
  padding: 0.9rem 1rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  overflow-y: auto;
}

.left-panel::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--accent);
}

/* Slide + fade transitions */

.lp-slide-enter-active,
.lp-slide-leave-active { transition: transform 240ms ease, opacity 240ms ease; }
.lp-slide-enter-from   { transform: translateX(-100%); opacity: 0; }
.lp-slide-leave-to     { transform: translateX(-100%); opacity: 0; }

.lp-fade-enter-active,
.lp-fade-leave-active { transition: opacity 200ms ease, backdrop-filter 200ms ease; }

.lp-fade-enter-from,
.lp-fade-leave-to     { opacity: 0; backdrop-filter: none; }

@media (prefers-reduced-motion: reduce) {
  .lp-slide-enter-active,
  .lp-slide-leave-active,
  .lp-fade-enter-active,
  .lp-fade-leave-active { transition: none; }
}

.np-head {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--border);
}

.np-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.np-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin: 0;
}

.np-meta {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.np-close {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  padding: 0 0.3rem;
}
.np-close:hover { color: var(--accent); }

.np-section {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.np-section-head {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.np-section-eyebrow {
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}

.np-section-meta {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-dim);
  margin-left: auto;
  text-transform: lowercase;
}

/* Search row */
.np-search-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  background: var(--surface-2);
  border-radius: 2px;
}

.np-search-glyph {
  color: var(--text-faint);
  font-size: 0.95rem;
}

.np-search-input {
  appearance: none;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.78rem;
  width: 100%;
  padding: 0.1rem 0;
}
.np-search-input::placeholder { color: var(--text-faint); }

.np-search-kbd {
  font-family: var(--mono);
  font-size: 0.62rem;
  padding: 0.05rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--text-faint);
  background: var(--surface);
}

.np-search-input:focus + .np-search-kbd,
.np-search-row:focus-within { border-color: var(--accent); }

/* Sub-search inside a section */
.np-sub-search {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.2rem 0.45rem;
  font-family: var(--mono);
  font-size: 0.66rem;
  color: var(--text);
  outline: 0;
}
.np-sub-search:focus { border-color: var(--accent); }
.np-sub-search::placeholder { color: var(--text-faint); }

/* Date range */
.np-daterange {
  display: flex;
  gap: 0.4rem;
  align-items: end;
  flex-wrap: wrap;
}

.np-date-label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.np-date {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.25rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text);
  outline: 0;
  color-scheme: dark light;
}
.np-date:focus { border-color: var(--accent); }

.np-date-clear {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.25rem 0.5rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
}
.np-date-clear:hover { color: var(--accent); border-color: var(--accent); }

/* Body stacks vertically in the left panel — 420 px is too narrow
   for the original two-column grid. */
.np-cols {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}

.np-col {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.np-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.np-chips-scroll {
  max-height: 5.5rem;
  overflow-y: auto;
  padding-right: 0.2rem;
}

.np-chip {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.22rem 0.5rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-dim);
  cursor: pointer;
  letter-spacing: 0.04em;
  text-transform: lowercase;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.np-chip:hover {
  border-color: var(--accent-soft, var(--accent));
  color: var(--text);
}

.np-chip.picked {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}

.np-empty {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  font-style: italic;
}

/* ─── Combobox (used by Map + Hero where chip clouds don't fit) ── */

.combo-selected {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.combo-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.18rem 0.18rem 0.5rem;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border: 1px solid var(--accent);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--accent);
  font-weight: 700;
  text-transform: lowercase;
}

.combo-pill-x {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--accent);
  padding: 0 0.3rem;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
}
.combo-pill-x:hover { color: var(--text); }

.combo {
  position: relative;
}

.combo-input {
  width: 100%;
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.36rem 2.4rem 0.36rem 0.6rem;
  font-family: var(--mono);
  font-size: 0.74rem;
  color: var(--text);
  outline: 0;
}
.combo-input:focus { border-color: var(--accent); }
.combo-input::placeholder { color: var(--text-faint); }

.combo-caret {
  position: absolute;
  right: 0.25rem;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: 0;
  color: var(--text-faint);
  padding: 0.2rem 0.5rem;
  cursor: pointer;
  font-size: 0.85rem;
  line-height: 1;
  transition: color 120ms ease, transform 160ms ease;
}
.combo-caret:hover { color: var(--accent); }

.combo-caret.open {
  color: var(--accent);
  transform: translateY(-50%) rotate(180deg);
}

.combo-list {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0.2rem 0;
  border: 1px solid var(--accent);
  background: var(--surface);
  border-radius: 2px;
  max-height: 14rem;
  overflow-y: auto;
  box-shadow: 0 12px 24px -16px rgb(0 0 0 / 50%);
}

.combo-list li {
  display: grid;
  grid-template-columns: 1.4rem 1fr;
  align-items: center;
  gap: 0.2rem;
  padding: 0.32rem 0.6rem;
  font-family: var(--mono);
  font-size: 0.74rem;
  color: var(--text);
  cursor: pointer;
}

.combo-list li:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.combo-list li.picked {
  color: var(--accent);
  font-weight: 700;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.combo-list li.picked:hover {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.combo-check {
  color: var(--accent);
  font-weight: 800;
  text-align: center;
}
.combo-opt-name { text-transform: lowercase; }

.combo-empty {
  font-style: italic;
  color: var(--text-faint);
  padding: 0.4rem 0.6rem !important;
  cursor: default !important;
}
.combo-empty:hover { background: transparent !important; }

/* Refinement: dual thresholds + unknown */
.np-refine-row {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.np-refine-hint {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  line-height: 1.4;
}

.np-thresholds {
  display: inline-flex;
  align-items: end;
  gap: 0.6rem;
}

.np-thresholds-or {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding-bottom: 0.3rem;
  font-weight: 700;
}

.np-num-label, .np-toggle-label {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.np-num-input {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.2rem 0.45rem;
  width: max-content;
}

.np-num {
  appearance: textfield;
  background: transparent;
  border: 0;
  outline: 0;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.78rem;
  width: 3.5rem;
}

.np-num::-webkit-outer-spin-button,
.np-num::-webkit-inner-spin-button { appearance: none; margin: 0; }
.np-num-unit { font-family: var(--mono); font-size: 0.6rem; color: var(--text-dim); }

.np-toggle-label {
  flex-direction: row;
  align-items: center;
  gap: 0.45rem;
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 0.72rem;
  color: var(--text);
}
.np-toggle-label input[type="checkbox"] { accent-color: var(--accent); }

.np-foot {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  position: sticky;
  bottom: 0;
  background: var(--surface);
  margin: 0 -1rem;
  padding: 0.55rem 1rem;
  border-top: 1px solid var(--border);
  z-index: 1;
}

.np-foot-status {
  font-family: var(--mono);
  font-size: 0.66rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.np-foot-actions {
  margin-left: auto;
  display: inline-flex;
  gap: 0.4rem;
}

.np-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.35rem 0.75rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-dim);
  cursor: pointer;
}
.np-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.np-btn.ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

.np-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--surface);
}

/* ─── Leaves head: sort + group ────────────────────────────── */

.leaves {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 2px;
  padding: 0.7rem 1rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.leaves-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 0.85rem;
  flex-wrap: wrap;
}
.leaves-head-left { display: flex; flex-direction: column; gap: 0.1rem; }

.leaves-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.leaves-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin: 0;
}

.leaves-head-controls {
  display: inline-flex;
  gap: 0.5rem;
  align-items: end;
}

.seg {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.1rem;
  display: inline-flex;
  gap: 0.05rem;
  background: var(--surface-2);
  margin: 0;
}

.seg-legend {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.seg-btn {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 2px;
  padding: 0.22rem 0.55rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
  cursor: pointer;
  font-weight: 700;
}
.seg-btn:hover { color: var(--text); }

.seg-btn.picked {
  background: var(--accent);
  color: var(--surface);
}

/* ─── Section dividers + leaf rows ─────────────────────────── */

.leaves-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-divider {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0 0.15rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}
.section-divider:first-child { padding-top: 0.1rem; }

.sd-line {
  height: 1px;
  background: linear-gradient(90deg, var(--border) 0%, var(--border) 70%, transparent);
}
.sd-label { color: var(--accent); }

.sd-count {
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
}

/* Seven-cell grid with fixed children per row — every leaf-row
   produces exactly seven DOM children so the grid never overflows
   into implicit columns (the cause of the "17 next to victory" bug
   where tag/leaver spans pushed the stats + result chip into
   adjacent cells). Sub-containers stack their own content
   internally with flex. */
.leaf-row {
  display: grid;
  grid-template-columns:
    4px                  /* strip */
    72px                 /* when */
    minmax(0, 1.4fr)     /* map block */
    minmax(0, 1fr)       /* hero block */
    auto                 /* stats */
    minmax(0, 1fr)       /* meta */
    auto;                /* result chip */

  gap: 0.85rem;
  align-items: center;
  padding: 0.55rem 0.85rem;
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  background: var(--surface);
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease;
}

.leaf-row:hover {
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  border-color: var(--accent-soft);
}

.leaf-strip {
  width: 4px; height: 36px;
  background: var(--text-faint);
  border-radius: 2px;
}
.leaf-row.result-victory .leaf-strip { background: var(--win); }
.leaf-row.result-defeat  .leaf-strip { background: var(--loss); }
.leaf-row.result-draw    .leaf-strip { background: var(--draw, var(--text-mute)); }

/* 2. When — date stacked over time. */
.leaf-when {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-family: var(--mono);
  font-feature-settings: "tnum";
  line-height: 1;
}

.leaf-when-date {
  color: var(--text);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.leaf-when-time {
  color: var(--text-faint);
  font-size: 0.6rem;
  letter-spacing: 0.02em;
}

/* 3. Where — map title + mode chip. */
.leaf-map-block {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
}

.leaf-map {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
}

.leaf-mode-row {
  display: inline-flex;
}

.leaf-mode-chip {
  font-family: var(--mono);
  font-size: 0.52rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
  line-height: 1;
}

/* 4. Who — hero name + role label. */
.leaf-hero-block {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.leaf-hero {
  font-family: var(--mono);
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 700;
  text-transform: lowercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
}

.leaf-role {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 600;
}

/* 5. How — E/A/D, big bold tabular numerals with thin separators. */
.leaf-stats-block {
  display: inline-flex;
  align-items: baseline;
  gap: 0;
  font-family: var(--mono);
  font-feature-settings: "tnum";
  white-space: nowrap;
  padding: 0 0.3rem;
}

.stat-num {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
  min-width: 1.1ch;
  text-align: center;
}
.stat-num.stat-deaths { color: var(--text-dim); }

.stat-sep {
  color: var(--text-faint);
  font-size: 0.85rem;
  padding: 0 0.25rem;
  font-weight: 400;
}

/* 6. Annotations — tags + leaver. Always renders (may be empty). */
.leaf-meta-block {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
  min-width: 0;
}

.leaf-tag {
  font-family: var(--mono);
  font-size: 0.58rem;
  padding: 0.12rem 0.36rem;
  border: 1px solid var(--accent-soft);
  border-radius: 2px;
  color: var(--accent);
  letter-spacing: 0.04em;
  text-transform: lowercase;
  white-space: nowrap;
}

.leaf-leaver {
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 800;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--loss);
  color: var(--loss);
  background: color-mix(in srgb, var(--loss) 12%, transparent);
  border-radius: 2px;
  letter-spacing: 0.14em;
}

.leaf-result-chip {
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.32rem 0.85rem;
  border-radius: 2px;
  font-weight: 800;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-faint);
  min-width: 5rem;
  text-align: center;
  line-height: 1;
}

.leaf-result-chip.result-victory {
  background: color-mix(in srgb, var(--win) 22%, var(--surface));
  border-color: var(--win-line, var(--win));
  color: var(--win);
}

.leaf-result-chip.result-defeat {
  background: color-mix(in srgb, var(--loss) 22%, var(--surface));
  border-color: var(--loss-line, var(--loss));
  color: var(--loss);
}

.leaf-result-chip.result-draw {
  background: color-mix(in srgb, var(--text-mute) 18%, var(--surface));
  border-color: var(--text-mute);
  color: var(--text);
}

.leaves-empty {
  margin: 0;
  text-align: center;
  font-family: var(--mono);
  color: var(--text-dim);
  padding: 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: center;
}

.leaves-empty-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 2px;
  padding: 0.35rem 0.85rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
  cursor: pointer;
  font-weight: 700;
}
.leaves-empty-btn:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }
</style>
