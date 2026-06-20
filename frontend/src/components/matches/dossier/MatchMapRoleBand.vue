<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useDossier, useFullDossier } from '@/composables/dashboard/useDossier'
import { useNarrow } from '@/composables/matches/useNarrow'
import { useOWData } from '@/composables/shared/useOWData'
import { useMapRoleConfig } from '@/composables/matches/useMapRoleConfig'
import { useWindowMonths } from '@/composables/matches/useWindowMonths'
import { useMapRoleSelection, type MapRoleCoord } from '@/composables/matches/useMapRoleSelection'
import { winrateVolumeFill } from '@/match/match-heatmap-helpers'
import type { MapRoleCell } from '@/composables/matches/useMatchesDossier'
import MapRoleConfigPopover from '@/components/matches/manual/MapRoleConfigPopover.vue'

// GEOGRAPHY — Map × Role performance band.
//
// A GitHub-contribution-graph-style heatmap: 3 role rows (Tank / DPS /
// Support) × every map as a column, grouped by game-mode and
// alphabetical within each group. Each cell's hue reads win rate
// (green → red) and its saturation reads volume, so faint cells carry
// little weight — same `cellFill` model as the Campaign Log calendar.
// Cells, role labels, and map names are spreadsheet-style selectable
// (click / Ctrl-toggle / Shift-range / drag-box, keyboard grid); the selection
// feeds a combined-stats readout + a "Filter to selection" button rather than
// live-narrowing (see useMapRoleSelection). A game-mode group header selects all
// that group's map columns.
//
// Data comes from the dossier (the narrowed record set, so the band
// responds to every filter) joined against the full canonical map
// roster from useOWData — maps you've never played render as empty
// cells so the atlas stays rectangular.

type Role = 'tank' | 'dps' | 'support'
const ROLES: Role[] = ['tank', 'dps', 'support']
const ROLE_LABEL: Record<Role, string> = { tank: 'Tank', dps: 'DPS', support: 'Support' }

// Canonical game-mode order (mirrors pkg/parser/maps.yaml); unknown
// types sort last.
const GAME_MODE_ORDER = ['control', 'escort', 'flashpoint', 'hybrid', 'push', 'clash']
const GAME_MODE_LABEL: Record<string, string> = {
  control: 'Control', escort: 'Escort', flashpoint: 'Flashpoint',
  hybrid: 'Hybrid', push: 'Push', clash: 'Clash',
}

const dossier = useDossier()
const fullDossier = useFullDossier()
const narrow = useNarrow()
const ow = useOWData()
const cfg = useMapRoleConfig()

// Gear popover — the band's display filter (roles / game modes / maps).
const configOpen = ref(false)
const configAnchor = ref<DOMRect | null>(null)
function toggleConfig(e: MouseEvent) {
  configAnchor.value = (e.currentTarget as HTMLElement).getBoundingClientRect()
  configOpen.value = !configOpen.value
}

// Rows = the configured role subset (empty filter = all roles), minus any role
// the player has never played — an all-empty row carries no signal.
const visibleRoles = computed<Role[]>(() => {
  const sel = cfg.config.value.roles
  const base = sel.length ? ROLES.filter((r) => sel.includes(r)) : ROLES
  return base.filter((r) => playedRoles.value.has(r))
})

// Trailing time-window toggle, mirroring the Campaign Log (1M/3M/6M/
// 12M). Persisted so the choice survives reloads; default 6M to match
// the Campaign Log's default.
const { WINDOW_MONTHS: WINDOWS, windowMonths, pickWindow } = useWindowMonths('recall.mapRoleWindowMonths')

// Cell DATA + the selected-cell highlight read the NARROWED dossier, so they
// respond to every active filter (panel picks, the band's own cell-pick).
const cells = dossier.mapRoleCounts(() => ({ windowMonths: windowMonths.value }))
// Row STRUCTURE reads the UNFILTERED dossier so the grid stays put when the
// band's own cell-pick (or any narrow) shrinks the set — the Campaign Log
// calendar keeps its full grid the same way. A role still drops out if it was
// never played in the window, just not because the current narrow excluded it.
const structureCells = fullDossier.mapRoleCounts(() => ({ windowMonths: windowMonths.value }))

// Roles with at least one match in the window (unfiltered) — never-played roles
// drop from the rows (see visibleRoles above); the narrow no longer collapses them.
const playedRoles = computed<Set<Role>>(() => {
  const s = new Set<Role>()
  for (const c of structureCells.value) if (c.total > 0) s.add(c.role)
  return s
})
// Whether the set has ANY match — separates the "play a match first" prompt
// from the "your filters hid everything" message.
const hasMatchData = computed(() => playedRoles.value.size > 0)

interface Col { slug: string; display: string; gameMode: string; firstInGroup: boolean }

// Columns = the full canonical roster, grouped by game mode (canonical
// order) and alphabetised within each group. mapIndex is keyed by the
// normalised slug — the same form the parser stores in data.map — so
// the join below is exact.
const columns = computed<Col[]>(() => {
  // Filter the roster by the gear config BEFORE grouping so the
  // game-mode group headers + first-in-group rules read off the visible set.
  // Empty filter = pass all; non-empty game-mode + map filters AND together.
  const { gameModes, maps } = cfg.config.value
  const gameModeSet = new Set(gameModes)
  const mapSet = new Set(maps)
  const byGameMode = new Map<string, { slug: string; display: string }[]>()
  for (const [slug, { display, gameMode }] of ow.mapIndex.value) {
    if (gameModeSet.size && !gameModeSet.has(gameMode)) continue
    if (mapSet.size && !mapSet.has(display)) continue
    const arr = byGameMode.get(gameMode) ?? []
    arr.push({ slug, display })
    byGameMode.set(gameMode, arr)
  }
  const rank = (t: string) => {
    const i = GAME_MODE_ORDER.indexOf(t)
    return i < 0 ? GAME_MODE_ORDER.length : i
  }
  const out: Col[] = []
  for (const gameMode of [...byGameMode.keys()].sort((a, b) => rank(a) - rank(b))) {
    const maps = (byGameMode.get(gameMode) ?? []).slice().sort((a, b) => a.display.localeCompare(b.display))
    maps.forEach((m, i) => out.push({ slug: m.slug, display: m.display, gameMode, firstInGroup: i === 0 }))
  }
  return out
})

interface Group { gameMode: string; label: string; colStart: number; colSpan: number }

// Contiguous runs of same-game-mode columns → one clickable header each.
// colStart is the 1-based grid column (column 1 is the role-label
// gutter, so the first map column is grid column 2).
const groups = computed<Group[]>(() => {
  const out: Group[] = []
  columns.value.forEach((col, idx) => {
    const last = out[out.length - 1]
    if (last && last.gameMode === col.gameMode) {
      last.colSpan++
    } else {
      out.push({ gameMode: col.gameMode, label: GAME_MODE_LABEL[col.gameMode] ?? col.gameMode, colStart: idx + 2, colSpan: 1 })
    }
  })
  return out
})

const lookup = computed(() => {
  const m = new Map<string, MapRoleCell>()
  for (const c of cells.value) m.set(`${c.map}|${c.role}`, c)
  return m
})

// Unfiltered counterpart: which cells are SELECTABLE. A map+role played in the
// window stays clickable (to select / switch / click-off) even when the current
// narrow leaves it with no data — only a never-played cell is inert. Mirrors the
// calendar, whose day cells stay selectable after a pick.
const structureLookup = computed(() => {
  const m = new Map<string, MapRoleCell>()
  for (const c of structureCells.value) m.set(`${c.map}|${c.role}`, c)
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

// Played-in-the-window test (drives selectability), distinct from cellFor's
// "has data under the current narrow" (drives the displayed fill).
function structureCellFor(slug: string, role: Role): MapRoleCell | undefined {
  return structureLookup.value.get(`${slug}|${role}`)
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

// ── Spreadsheet-style cell selection. The engine owns the state machine; the
// band supplies the grid order, the selectability gate, and a point→cell resolver
// for drag. Selecting NO LONGER live-narrows — it highlights + drives the combined
// readout; the "Filter to selection" button applies it to the set.
const gridRef = ref<HTMLElement | null>(null)

function cellFromPoint(x: number, y: number): MapRoleCoord | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-mr-cell]')
  const k = el?.dataset.mrCell
  if (!k) return null
  const i = k.lastIndexOf('|')
  return { map: k.slice(0, i), role: k.slice(i + 1) }
}

const sel = useMapRoleSelection({
  columns: () => columns.value.map((c) => c.slug),
  roles:   () => visibleRoles.value,
  isSelectable: (m, r) => !!structureCellFor(m, r as Role),
  cellFromPoint,
  onClear: resetFilter,
})

// Keyboard moves the roving focus in the engine; mirror it onto DOM focus.
watch(() => sel.focused.value, (f) => {
  if (!f) return
  nextTick(() => gridRef.value?.querySelector<HTMLElement>(`[data-mr-cell="${f.map}|${f.role}"]`)?.focus())
})

// One roving tabstop (WAI-ARIA grid): the focused cell, else the first playable one.
const firstSelectable = computed(() => {
  for (const role of visibleRoles.value)
    for (const col of columns.value)
      if (structureCellFor(col.slug, role)) return `${col.slug}|${role}`
  return ''
})
function cellTabindex(slug: string, role: Role): number {
  if (sel.focused.value) return sel.isFocused(slug, role) ? 0 : -1
  return firstSelectable.value === `${slug}|${role}` ? 0 : -1
}

// Combined W/L/D + win-rate over the EXACT selected cells (always exact, even when
// a non-rectangular selection's filter would be a superset).
const selectionStats = computed(() => {
  let wins = 0; let losses = 0; let draws = 0; let total = 0
  for (const k of sel.selected.value) {
    const i = k.lastIndexOf('|')
    const c = cellFor(k.slice(0, i), k.slice(i + 1) as Role)
    if (c) { wins += c.wins; losses += c.losses; draws += c.draws; total += c.total }
  }
  const decided = wins + losses
  return { wins, losses, draws, total, winrate: decided ? Math.round((wins / decided) * 100) : null }
})

// "Filter to selection" → push the rectangular hull (maps × roles) into the narrow:
// exact for a single cell / row / column / drag-box, a superset for a non-contiguous
// pick (flagged by the hint next to the button).
function filterToSelection() {
  narrow.pickedMaps.value  = new Set(sel.hullMaps.value)
  narrow.pickedRoles.value = new Set(sel.hullRoles.value)
}

// This band's filter contribution: the maps × roles narrow it pushed. A header
// Reset button + a click on any empty cell both call this, so the filter can be
// cleared without scrolling to the active-chips rail.
const filterActive = computed(() =>
  narrow.pickedMaps.value.size > 0 || narrow.pickedRoles.value.size > 0,
)
function resetFilter() {
  narrow.pickedMaps.value  = new Set()
  narrow.pickedRoles.value = new Set()
  sel.clear()
}

// The map slugs in a game-mode group → the group header selects all its columns.
function groupMaps(gameMode: string): string[] {
  return columns.value.filter((c) => c.gameMode === gameMode).map((c) => c.slug)
}

// Excel modifier vocabulary off a header click: Ctrl/⌘ = add, Shift = range.
function headerMods(e: MouseEvent): { ctrl: boolean; shift: boolean } {
  return { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }
}

// A press directly on the grid gutters (between cells) clears the selection.
// Using mousedown.self — not click — so the synthetic click a drag-box emits on
// the grid (the down/up cells' common ancestor) can't wipe the fresh selection.

// Inline track template — CSS repeat() can't take a custom-property
// count, so the literal column count is interpolated here.
const gridTemplateColumns = computed(
  () => `var(--mr-gutter) repeat(${columns.value.length}, minmax(var(--mr-cell), 1fr))`,
)

// Row track follows the configured role count (the role-label gutter
// rows: gameMode-headers + column-labels + one per visible role).
const gridTemplateRows = computed(
  () => `auto 5.4rem repeat(${visibleRoles.value.length}, var(--mr-row))`,
)

// Distinguish "no map roster at all" (reference data missing) from
// "filtered down to nothing" so each gets the right empty message.
const rosterEmpty = computed(() => ow.mapIndex.value.size === 0)
// No matches played at all (vs. a roster/filter problem) — gets its own prompt.
const noMatchesData = computed(() => !rosterEmpty.value && !hasMatchData.value)
const filteredEmpty = computed(() => !rosterEmpty.value && hasMatchData.value && (columns.value.length === 0 || visibleRoles.value.length === 0))
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

      <button
        v-if="filterActive"
        type="button"
        class="mr-reset"
        data-mr-reset
        title="Clear the maps × roles filter this band applied"
        @click="resetFilter"
      >
        ⟲ Reset
      </button>

      <button
        type="button"
        class="mr-gear"
        :class="{ 'mr-gear-active': !cfg.isDefault.value }"
        data-mr-config-trigger
        :aria-label="cfg.isDefault.value ? 'Filter the Geography band' : 'Geography filters are active'"
        :aria-expanded="configOpen"
        :title="cfg.isDefault.value ? 'Filter by role, game mode, or map' : 'Geography filters active'"
        @click="toggleConfig"
      >
        <span aria-hidden="true">⚙</span>
      </button>

      <ul class="mr-legend" aria-label="Cell-colour legend">
        <li><span class="mr-swatch mr-loss" /> Losing</li>
        <li><span class="mr-swatch mr-mixed" /> Mixed</li>
        <li><span class="mr-swatch mr-win" /> Winning</li>
      </ul>
    </header>

    <div class="mr-scroll">
      <div
        v-if="!rosterEmpty && !noMatchesData && !filteredEmpty"
        ref="gridRef"
        class="mr-grid"
        role="group"
        aria-label="Map × role performance — click a cell, role label, or map name to select; drag to box-select; click an empty cell to reset the filter"
        :style="{ gridTemplateColumns, gridTemplateRows }"
        @mousedown.self="sel.clear()"
        @keydown.esc.prevent="sel.clear()"
      >
        <span class="mr-corner" />

        <button
          v-for="g in groups"
          :key="`g-${g.gameMode}`"
          type="button"
          class="mr-modehead"
          :style="{ gridColumn: `${g.colStart} / span ${g.colSpan}`, gridRow: 1 }"
          :aria-label="`Select all ${g.label} maps`"
          @click="sel.selectColumns(groupMaps(g.gameMode), headerMods($event))"
        >
          {{ g.label }}
        </button>

        <button
          v-for="(col, i) in columns"
          :key="`c-${col.slug}`"
          type="button"
          class="mr-collabel"
          :class="{ 'mr-group-start': col.firstInGroup }"
          :style="{ gridColumn: i + 2, gridRow: 2 }"
          :data-mr-col="col.slug"
          :title="`Select the ${col.display} column`"
          :aria-label="`Select all roles on ${col.display}`"
          @click="sel.selectColumn(col.slug, headerMods($event))"
        >
          {{ col.display }}
        </button>

        <template v-for="(role, rIdx) in visibleRoles" :key="`row-${role}`">
          <button
            type="button"
            class="mr-rowhead"
            :style="{ gridColumn: 1, gridRow: rIdx + 3 }"
            :data-mr-row="role"
            :aria-label="`Select all maps for ${ROLE_LABEL[role]}`"
            @click="sel.selectRow(role, headerMods($event))"
          >
            {{ ROLE_LABEL[role] }}
          </button>

          <button
            v-for="(col, i) in columns"
            :key="`${role}-${col.slug}`"
            type="button"
            class="mr-cell"
            :class="{
              'mr-empty': !structureCellFor(col.slug, role),
              'mr-group-start': col.firstInGroup,
              selected: sel.isSelected(col.slug, role),
              'in-drag-box': sel.isInDragBox(col.slug, role),
            }"
            :style="{
              gridColumn: i + 2,
              gridRow: rIdx + 3,
              background: fill(col.slug, role),
            }"
            :data-mr-empty="!structureCellFor(col.slug, role) || undefined"
            :data-mr-cell="`${col.slug}|${role}`"
            :aria-pressed="sel.isSelected(col.slug, role)"
            :tabindex="cellTabindex(col.slug, role)"
            :title="cellLabel(col.slug, role)"
            :aria-label="cellLabel(col.slug, role)"
            @mousedown="sel.onCellPointerDown(col.slug, role, $event)"
            @keydown="sel.onCellKeydown(col.slug, role, $event)"
          />
        </template>
      </div>

      <p v-else-if="noMatchesData" class="mr-loading" data-mr-no-data>
        At least 1 match must be played to display data.
      </p>

      <p v-else-if="filteredEmpty" class="mr-loading">
        No maps match your filters.
        <button type="button" class="mr-clear" data-mr-clear @click="cfg.reset()">
          Clear filters
        </button>
      </p>

      <p v-else class="mr-loading">
        Map reference data unavailable.
      </p>
    </div>

    <!-- Selection readout. The slot is ALWAYS present (active bar or a faint
         prompt) at a fixed height, so selecting a cell swaps content in place and
         never shifts the widget or the content below it. -->
    <div v-if="sel.count.value > 0" class="mr-selection" data-mr-selection-bar>
      <span class="mr-sel-stats" data-mr-selection-stats>
        <strong>{{ sel.count.value }}</strong> cell{{ sel.count.value === 1 ? '' : 's' }}
        <span aria-hidden="true">·</span>
        {{ selectionStats.wins }}–{{ selectionStats.losses }}–{{ selectionStats.draws }}
        <template v-if="selectionStats.winrate !== null"> · {{ selectionStats.winrate }}% WR</template>
        · {{ selectionStats.total }} game{{ selectionStats.total === 1 ? '' : 's' }}
      </span>
      <span class="mr-sel-actions">
        <span v-if="!sel.isRectangular.value" class="mr-sel-hint" data-mr-hull-note>
          filters to every map × role in your selection
        </span>
        <button type="button" class="mr-sel-filter" data-mr-filter-selection @click="filterToSelection">
          Filter set to selection
        </button>
        <button type="button" class="mr-sel-clear" data-mr-selection-clear @click="sel.clear()">
          Clear
        </button>
      </span>
    </div>
    <p v-else class="mr-selection mr-selection-empty" data-mr-selection-empty>
      Select a cell, role, or map to compare combined stats
    </p>

    <MapRoleConfigPopover
      :open="configOpen"
      :anchor="configAnchor"
      @close="configOpen = false"
    />
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

/* Reset — clears this band's maps × roles filter without a scroll to the chips. */
.mr-reset {
  appearance: none;
  margin-left: 0.4rem;
  border: 1px solid var(--accent);
  border-radius: 2px;
  background: transparent;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 0.22rem 0.5rem;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.mr-reset:hover { background: var(--accent); color: var(--primary-text-on-accent, var(--bg)); }
.mr-reset:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.mr-window-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.mr-window-btn.active {
  background: var(--accent);
  color: var(--primary-text-on-accent);
}

/* Gear — opens the band's display-filter popover. An accent dot in the
   corner signals when a filter is active. */
.mr-gear {
  position: relative;
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.4rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
  color: var(--text-faint);
  font-size: 0.78rem;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
}
.mr-gear:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.mr-gear:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.mr-gear-active {
  color: var(--accent);
  border-color: var(--accent);
}

.mr-gear-active::after {
  content: '';
  position: absolute;
  top: -3px;
  right: -3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1.5px var(--surface);
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

  /* grid-template-rows bound inline — the role-row count follows the
     gear's role filter. */
  gap: 2px;
  align-items: stretch;
  width: 100%;
}

.mr-corner {
  grid-column: 1;
  grid-row: 1 / span 2;
}

.mr-modehead {
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
.mr-modehead:hover { color: var(--accent); }

.mr-modehead:focus-visible {
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

/* Empty cells are still clickable (a click resets the filter, drag can start /
   stop on them) — they just don't get the data-cell hover pop. */
.mr-cell:not(.mr-empty):hover {
  transform: scale(1.12);
  box-shadow: 0 0 0 1px var(--accent);
  z-index: 1;
}

.mr-cell:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  z-index: 1;
}

/* A selected cell — solid accent ring + glow. Selecting a cell / row / column /
   box highlights it and feeds the combined readout; the "Filter to selection"
   button applies it (selecting no longer live-narrows the set). */
.mr-cell.selected {
  box-shadow:
    0 0 0 2px var(--accent),
    0 0 6px var(--accent-glow, color-mix(in srgb, var(--accent) 45%, transparent));
  z-index: 1;
}

/* Live drag-box preview — a lighter inset ring than a committed selection so the
   sweep reads as "about to select" without competing with the solid ring. */
.mr-cell.in-drag-box {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 60%, transparent);
  z-index: 1;
}

/* A hairline before the first column of each game-mode group so the eye
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

.mr-clear {
  appearance: none;
  margin-left: 0.5rem;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.15rem 0.5rem;
  border-radius: 2px;
  cursor: pointer;
}
.mr-clear:hover { color: var(--text); background: color-mix(in srgb, var(--accent-soft) 55%, var(--accent)); }
.mr-clear:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

@media (width <= 720px) {
  .mr-legend { display: none; }
}

/* ─── Selection: row/column label buttons + the combined-stats bar ─── */

/* The col + row labels became selection buttons; strip UA chrome (the existing
   .mr-collabel / .mr-rowhead type rules keep their look) and add a hover cue. */
:where(button.mr-collabel, button.mr-rowhead) {
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
}

.mr-collabel:hover,
.mr-rowhead:hover { color: var(--accent); }

.mr-collabel:focus-visible,
.mr-rowhead:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  color: var(--accent);
}

.mr-selection {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.5rem 0.9rem;
  margin: 0.5rem 0 0;

  /* Reserve the active row's height so the empty ↔ active swap never shifts the
     widget or the content below it. */
  min-height: 2.4rem;
  box-sizing: border-box;
  padding: 0.4rem 0.55rem;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

/* The reserved-but-empty slot: same box, dashed + faint, a centered prompt. Kept
   to a single line (nowrap + ellipsis) so it stays exactly the active bar's height
   on narrow widths — a wrapped 2-line prompt would re-introduce the shift. */
.mr-selection-empty {
  justify-content: center;
  border-style: dashed;
  border-color: var(--border);
  background: transparent;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.03em;
  font-style: italic;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mr-sel-stats {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mr-sel-stats strong { color: var(--accent); font-weight: 700; }

.mr-sel-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  margin-left: auto;
}

.mr-sel-hint {
  font-family: var(--mono);
  font-size: 0.58rem;
  color: var(--text-faint);
  font-style: italic;
  max-width: 14rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mr-sel-filter,
.mr-sel-clear {
  appearance: none;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 0.22rem 0.6rem;
  border-radius: 2px;
  cursor: pointer;
}

.mr-sel-filter {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--primary-text-on-accent, var(--bg));
  font-weight: 700;
}

.mr-sel-filter:hover { background: color-mix(in srgb, var(--accent) 85%, var(--text)); }

.mr-sel-clear {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
}

.mr-sel-clear:hover { border-color: var(--accent); color: var(--text); }

.mr-sel-filter:focus-visible,
.mr-sel-clear:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
