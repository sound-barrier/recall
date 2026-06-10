<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDossier } from '../composables/useDossier'
import { useNarrow } from '../composables/useNarrow'
import { useOWData } from '../composables/useOWData'
import { winrateVolumeFill } from '../match-heatmap-helpers'
import type { MapRoleCell } from '../composables/useMatchesDossier'

// GEOGRAPHY — Map × Role performance band.
//
// A GitHub-contribution-graph-style heatmap: 3 role rows (Tank / DPS /
// Support) × every map as a column, grouped by map-type and
// alphabetical within each group. Each cell's hue reads win rate
// (green → red) and its saturation reads volume, so faint cells carry
// little weight — same `cellFill` model as the Campaign Log calendar.
// Clicking a cell narrows the active set to that (map, role) pair;
// clicking a type-group header narrows to that map-type.
//
// Data comes from the dossier (the narrowed record set, so the band
// responds to every filter) joined against the full canonical map
// roster from useOWData — maps you've never played render as empty
// cells so the atlas stays rectangular.

type Role = 'tank' | 'dps' | 'support'
const ROLES: Role[] = ['tank', 'dps', 'support']
const ROLE_LABEL: Record<Role, string> = { tank: 'Tank', dps: 'DPS', support: 'Support' }

// Canonical map-type order (mirrors pkg/parser/maps.yaml); unknown
// types sort last.
const TYPE_ORDER = ['control', 'escort', 'flashpoint', 'hybrid', 'push', 'clash']
const TYPE_LABEL: Record<string, string> = {
  control: 'Control', escort: 'Escort', flashpoint: 'Flashpoint',
  hybrid: 'Hybrid', push: 'Push', clash: 'Clash',
}

const dossier = useDossier()
const narrow = useNarrow()
const ow = useOWData()

// Trailing time-window toggle, mirroring the Campaign Log (1M/3M/6M/
// 12M). Persisted so the choice survives reloads; default 6M to match
// the Campaign Log's default.
const WINDOWS = [1, 3, 6, 12] as const
type WindowKey = (typeof WINDOWS)[number]
const WINDOW_STORAGE_KEY = 'recall.mapRoleWindowMonths'
function loadWindow(): WindowKey {
  try {
    const n = Number(localStorage.getItem(WINDOW_STORAGE_KEY))
    if (n === 1 || n === 3 || n === 12) return n
  } catch (_) { /* swallow */ }
  return 6
}
const windowMonths = ref<WindowKey>(loadWindow())
function pickWindow(m: WindowKey) {
  windowMonths.value = m
  try { localStorage.setItem(WINDOW_STORAGE_KEY, String(m)) } catch (_) { /* swallow */ }
}

const cells = dossier.mapRoleCounts(() => ({ windowMonths: windowMonths.value }))

interface Col { slug: string; display: string; type: string; firstInGroup: boolean }

// Columns = the full canonical roster, grouped by type (canonical
// order) and alphabetised within each group. mapIndex is keyed by the
// normalised slug — the same form the parser stores in data.map — so
// the join below is exact.
const columns = computed<Col[]>(() => {
  const byType = new Map<string, { slug: string; display: string }[]>()
  for (const [slug, { display, type }] of ow.mapIndex.value) {
    const arr = byType.get(type) ?? []
    arr.push({ slug, display })
    byType.set(type, arr)
  }
  const rank = (t: string) => {
    const i = TYPE_ORDER.indexOf(t)
    return i < 0 ? TYPE_ORDER.length : i
  }
  const out: Col[] = []
  for (const type of [...byType.keys()].sort((a, b) => rank(a) - rank(b))) {
    const maps = (byType.get(type) ?? []).slice().sort((a, b) => a.display.localeCompare(b.display))
    maps.forEach((m, i) => out.push({ slug: m.slug, display: m.display, type, firstInGroup: i === 0 }))
  }
  return out
})

interface Group { type: string; label: string; colStart: number; colSpan: number }

// Contiguous runs of same-type columns → one clickable header each.
// colStart is the 1-based grid column (column 1 is the role-label
// gutter, so the first map column is grid column 2).
const groups = computed<Group[]>(() => {
  const out: Group[] = []
  columns.value.forEach((col, idx) => {
    const last = out[out.length - 1]
    if (last && last.type === col.type) {
      last.colSpan++
    } else {
      out.push({ type: col.type, label: TYPE_LABEL[col.type] ?? col.type, colStart: idx + 2, colSpan: 1 })
    }
  })
  return out
})

const lookup = computed(() => {
  const m = new Map<string, MapRoleCell>()
  for (const c of cells.value) m.set(`${c.map}|${c.role}`, c)
  return m
})

// Brightest cell anchors the volume saturation so one grind-heavy map
// doesn't wash out the rest.
const maxTotal = computed(() => {
  let n = 0
  for (const c of cells.value) if (c.total > n) n = c.total
  return n
})

function cellFor(slug: string, role: Role): MapRoleCell | undefined {
  return lookup.value.get(`${slug}|${role}`)
}

// Win-rate hue × volume saturation, blended toward the empty tone for
// low-volume cells. See winrateVolumeFill in match-helpers.
function fill(slug: string, role: Role): string {
  const c = cellFor(slug, role)
  if (!c) return 'var(--heatmap-empty)'
  return winrateVolumeFill(c.winrate, c.total, maxTotal.value)
}

function cellLabel(slug: string, role: Role): string {
  const disp = ow.mapDisplayName(slug) || slug
  const c = cellFor(slug, role)
  if (!c || c.total === 0) return `${ROLE_LABEL[role]} on ${disp}: no matches`
  const games = c.total === 1 ? 'game' : 'games'
  return `${ROLE_LABEL[role]} on ${disp}: ${c.wins}-${c.losses}-${c.draws} · ${c.winrate}% win rate over ${c.total} ${games}`
}

function onCell(slug: string, role: Role) {
  if (!cellFor(slug, role)) return
  narrow.pickMap(slug)
  narrow.pickRole(role)
}

// Inline track template — CSS repeat() can't take a custom-property
// count, so the literal column count is interpolated here.
const gridTemplateColumns = computed(
  () => `var(--mr-gutter) repeat(${columns.value.length}, minmax(var(--mr-cell), 1fr))`,
)
</script>

<template>
  <section class="match-map-role" aria-labelledby="mr-eyebrow">
    <header class="mr-head">
      <span id="mr-eyebrow" class="mr-eyebrow">Geography</span>
      <h3 class="mr-title">
        Map × role performance
      </h3>

      <div class="mr-window" role="group" aria-label="Time window">
        <button
          v-for="m in WINDOWS"
          :key="m"
          type="button"
          class="mr-window-btn"
          :class="{ active: windowMonths === m }"
          :aria-pressed="windowMonths === m"
          :title="`Last ${m} month${m === 1 ? '' : 's'}`"
          @click="pickWindow(m)"
        >
          {{ m }}M
        </button>
      </div>

      <ul class="mr-legend" aria-label="Cell-colour legend">
        <li><span class="mr-swatch mr-loss" /> Losing</li>
        <li><span class="mr-swatch mr-mixed" /> Mixed</li>
        <li><span class="mr-swatch mr-win" /> Winning</li>
      </ul>
    </header>

    <div class="mr-scroll">
      <div
        v-if="columns.length > 0"
        class="mr-grid"
        role="group"
        aria-label="Map by role performance heatmap"
        :style="{ gridTemplateColumns }"
      >
        <span class="mr-corner" />

        <button
          v-for="g in groups"
          :key="`g-${g.type}`"
          type="button"
          class="mr-typehead"
          :style="{ gridColumn: `${g.colStart} / span ${g.colSpan}`, gridRow: 1 }"
          :aria-label="`Narrow to ${g.label} maps`"
          @click="narrow.pickMapType(g.type)"
        >
          {{ g.label }}
        </button>

        <span
          v-for="(col, i) in columns"
          :key="`c-${col.slug}`"
          class="mr-collabel"
          :class="{ 'mr-group-start': col.firstInGroup }"
          :style="{ gridColumn: i + 2, gridRow: 2 }"
          :title="col.display"
        >
          {{ col.display }}
        </span>

        <template v-for="(role, rIdx) in ROLES" :key="`row-${role}`">
          <span
            class="mr-rowhead"
            :style="{ gridColumn: 1, gridRow: rIdx + 3 }"
          >{{ ROLE_LABEL[role] }}</span>

          <button
            v-for="(col, i) in columns"
            :key="`${role}-${col.slug}`"
            type="button"
            class="mr-cell"
            :class="{ 'mr-empty': !cellFor(col.slug, role), 'mr-group-start': col.firstInGroup }"
            :style="{
              gridColumn: i + 2,
              gridRow: rIdx + 3,
              background: fill(col.slug, role),
            }"
            :disabled="!cellFor(col.slug, role)"
            :title="cellLabel(col.slug, role)"
            :aria-label="cellLabel(col.slug, role)"
            @click="onCell(col.slug, role)"
          />
        </template>
      </div>

      <p v-else class="mr-loading">
        Map reference data unavailable.
      </p>
    </div>
  </section>
</template>

<style scoped>
.match-map-role {
  --mr-gutter: 4.6rem;
  --mr-cell: 13px;
  --mr-row: 1.55rem;

  padding: 0.7rem 1.1rem 0.75rem;
  border: 1px solid var(--border);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 4%, transparent) 0%, transparent 42%),
    var(--surface);
  border-radius: 2px;
}

.mr-head {
  display: flex;
  align-items: baseline;
  gap: 1.1rem;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}

.mr-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.mr-title {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 1.15rem;
  font-weight: 400;
  letter-spacing: 0.03em;
  margin: 0;
  color: var(--text);
  text-transform: capitalize;
}

.mr-window {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
}

.mr-window-btn {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  font-weight: 600;
  padding: 0.22rem 0.55rem;
  cursor: pointer;
  border-right: 1px solid var(--border);
  transition: color 140ms ease, background 140ms ease;
}
.mr-window-btn:last-child { border-right: 0; }
.mr-window-btn:hover { color: var(--text); }

.mr-window-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.mr-window-btn.active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.mr-legend {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.mr-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.mr-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, currentcolor 25%, transparent);
}
.mr-win { background: var(--win); }
.mr-loss { background: var(--loss); }
.mr-mixed { background: color-mix(in srgb, var(--win) 50%, var(--loss)); }

.mr-scroll {
  padding-bottom: 0.2rem;
}

.mr-grid {
  --heatmap-empty: color-mix(in srgb, var(--surface-2) 92%, var(--border));

  /* `1fr` columns fill the container and shrink responsively to the
     small per-column min — so the grid width tracks the container and
     never overflows on desktop widths. Deliberately NOT inside an
     `overflow-x: auto` wrapper: a scroll container whose content width
     also depends on the container (1fr) oscillates the scrollbar,
     which jitters every element below the band and breaks click
     stability. */
  display: grid;
  grid-template-rows: auto 5.4rem repeat(3, var(--mr-row));
  gap: 2px;
  align-items: stretch;
  width: 100%;
}

.mr-corner {
  grid-column: 1;
  grid-row: 1 / span 2;
}

.mr-typehead {
  appearance: none;
  border: 0;
  background: transparent;
  cursor: pointer;
  align-self: end;
  padding: 0 0 0.2rem;
  font-family: var(--mono);
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  transition: color 140ms ease;
  text-align: left;
  white-space: nowrap;
}
.mr-typehead:hover { color: var(--accent); }

.mr-typehead:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.mr-collabel {
  place-self: end center;
  max-height: 5.2rem;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.02em;
  color: var(--text-faint);
}

.mr-rowhead {
  grid-column: 1;
  display: flex;
  align-items: center;
  padding-right: 0.5rem;
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 0.95rem;
  letter-spacing: 0.03em;
  color: var(--text);
}

.mr-cell {
  appearance: none;
  border: 0;
  border-radius: 2px;
  min-height: var(--mr-row);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.mr-cell.mr-empty {
  cursor: default;
}

.mr-cell:not(:disabled):hover {
  transform: scale(1.12);
  box-shadow: 0 0 0 1px var(--accent);
  z-index: 1;
}

.mr-cell:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  z-index: 1;
}

/* A hairline before the first column of each type-group so the eye
   reads the blocks (Control | Escort | …) without a heavy divider. */
.mr-group-start {
  margin-left: 5px;
}

.mr-loading {
  margin: 0.4rem 0;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
}

@media (width <= 720px) {
  .mr-legend { display: none; }
}
</style>
