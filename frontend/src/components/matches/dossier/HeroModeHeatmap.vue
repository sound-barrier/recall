<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useMapRoleSelection, type MapRoleCoord } from '@/composables/matches/useMapRoleSelection'
import { heatmapCellClass, heatmapCellOpacity } from '@/match/match-heatmap-helpers'

// The Hero × Game-Mode band's root level: a heroes × game-modes win-rate heatmap
// (hue by win-rate band, opacity by volume), or a floor-gate empty state.
//
// HYBRID interaction: a PLAIN click drills into that hero×mode's maps (emit
// `cell`); Ctrl/⌘ + Shift add a spreadsheet-style SELECTION — cells, hero rows,
// game-mode columns — for a combined-stats readout + a "Filter to selection"
// button (emit `filter`). Same engine as Geography (game modes are the columns,
// heroes the rows), gated behind modifiers so the drill survives on plain click.
interface HeatmapCell {
  gameMode: string
  total: number
  winrate: number
  wins: number
  losses: number
  draws: number
}
interface HeatmapRow {
  hero: string
  cells: HeatmapCell[]
}

const props = defineProps<{
  rows: HeatmapRow[]
  columnHeaders: string[]
  belowFloor: boolean
  minMatches: number
  decisiveTotal: number
  heroLabel: (hero: string) => string
}>()

const emit = defineEmits<{
  cell: [hero: string, gameMode: string]
  filter: [sel: { heroes: string[]; gameModes: string[] }]
}>()

// Populated cells keyed `gameMode|hero` → drives selectability + the combined stats.
const cellData = computed(() => {
  const m = new Map<string, HeatmapCell>()
  for (const row of props.rows) {
    for (const c of row.cells) if (c.total > 0) m.set(`${c.gameMode}|${row.hero}`, c)
  }
  return m
})

const gridRef = ref<HTMLElement | null>(null)

function cellFromPoint(x: number, y: number): MapRoleCoord | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-hm-cell]')
  const k = el?.dataset.hmCell
  if (!k) return null
  const i = k.lastIndexOf('|')
  return { map: k.slice(0, i), role: k.slice(i + 1) } // map = gameMode, role = hero
}

const sel = useMapRoleSelection({
  columns: () => props.columnHeaders,            // game modes
  roles:   () => props.rows.map((r) => r.hero),  // heroes
  isSelectable: (mode, hero) => cellData.value.has(`${mode}|${hero}`),
  cellFromPoint,
})

// Mirror the engine's roving focus onto the DOM (keyboard selection via headers).
watch(() => sel.focused.value, (f) => {
  if (!f) return
  nextTick(() => gridRef.value?.querySelector<HTMLElement>(`[data-hm-cell="${f.map}|${f.role}"]`)?.focus())
})

function headerMods(e: MouseEvent): { ctrl: boolean; shift: boolean } {
  return { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }
}

// Plain click drills; a modifier click selects instead (the hybrid contract).
function onCellClick(hero: string, cell: HeatmapCell, e: MouseEvent) {
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    sel.clickCell(cell.gameMode, hero, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })
    return
  }
  emit('cell', hero, cell.gameMode)
}

// Combined W/L/D + win-rate over the exact selected cells.
const selectionStats = computed(() => {
  let wins = 0; let losses = 0; let draws = 0; let total = 0
  for (const k of sel.selected.value) {
    const c = cellData.value.get(k)
    if (c) { wins += c.wins; losses += c.losses; draws += c.draws; total += c.total }
  }
  const decided = wins + losses
  return { wins, losses, draws, total, winrate: decided ? Math.round((wins / decided) * 100) : null }
})

// Headers stay lit while their dimension is in the selection (Excel-style): a
// game-mode column header when that mode is in the hull, a hero row header when
// that hero is.
const selectedModes  = computed(() => new Set(sel.hullMaps.value))
const selectedHeroes = computed(() => new Set(sel.hullRoles.value))

// A Ctrl/Shift selection LIVE-filters (no button) — push the selection's
// rectangular hull (heroes × game-modes) up to the band, which owns the narrow.
// The root grid reads the full dossier, so this only narrows the match list (the
// grid stays a stable surface, like Geography + the Campaign Log heatmap).
watch(() => sel.selected.value, () => {
  emit('filter', { heroes: sel.hullRoles.value, gameModes: sel.hullMaps.value })
})

// The band's header Reset / external-clear sync clears the pending selection here.
// Guarded so clearing an already-empty selection can't loop with the watch above.
defineExpose({ clearSelection: () => { if (sel.count.value > 0) sel.clear() } })
</script>

<template>
  <p v-if="decisiveTotal === 0" class="heatmap-empty" data-hm-no-data>
    At least 1 match must be played to display data.
  </p>
  <p v-else-if="belowFloor" class="heatmap-empty">
    Need {{ minMatches }}+ decisive matches in this window to
    surface patterns. You have {{ decisiveTotal }}.
  </p>
  <template v-else>
    <div
      ref="gridRef"
      class="heatmap-grid"
      role="grid"
      :aria-label="`Hero by game-mode heatmap, ${rows.length} heroes × ${columnHeaders.length} game modes — click a cell to drill in, Ctrl/Shift-click to select`"
      @mousedown.self="sel.clear()"
      @keydown.esc.prevent="sel.clear()"
    >
      <div class="heatmap-row heatmap-header" role="row">
        <span class="heatmap-corner" role="columnheader" aria-label="Hero" />
        <button
          v-for="t in columnHeaders"
          :key="t"
          type="button"
          class="heatmap-colhead"
          :class="{ 'header-selected': selectedModes.has(t) }"
          role="columnheader"
          :data-hm-col="t"
          :title="`Select the ${t} column`"
          :aria-label="`Select all heroes on ${t}`"
          :aria-pressed="selectedModes.has(t)"
          @click="sel.selectColumn(t, headerMods($event))"
        >
          {{ t }}
        </button>
      </div>
      <div
        v-for="row in rows"
        :key="row.hero"
        class="heatmap-row"
        role="row"
      >
        <button
          type="button"
          class="heatmap-rowhead"
          :class="{ 'header-selected': selectedHeroes.has(row.hero) }"
          role="rowheader"
          :data-hm-row="row.hero"
          :aria-label="`Select all game modes for ${heroLabel(row.hero)}`"
          :aria-pressed="selectedHeroes.has(row.hero)"
          @click="sel.selectRow(row.hero, headerMods($event))"
        >
          {{ heroLabel(row.hero) }}
        </button>
        <button
          v-for="cell in row.cells"
          :key="cell.gameMode"
          type="button"
          class="heatmap-cell"
          :class="[heatmapCellClass(cell), {
            'hm-selected': sel.isSelected(cell.gameMode, row.hero),
            'in-drag-box': sel.isInDragBox(cell.gameMode, row.hero),
          }]"
          :style="{ opacity: heatmapCellOpacity(cell) }"
          :disabled="cell.total === 0"
          :data-hm-cell="`${cell.gameMode}|${row.hero}`"
          :aria-pressed="sel.isSelected(cell.gameMode, row.hero)"
          :title="cell.total === 0
            ? `${heroLabel(row.hero)} on ${cell.gameMode}: no matches`
            : `${heroLabel(row.hero)} on ${cell.gameMode}: ${cell.wins}-${cell.losses}-${cell.draws} (${cell.winrate}% winrate). Click to drill into maps; Ctrl/Shift-click to select.`"
          :aria-label="cell.total === 0
            ? `${heroLabel(row.hero)} on ${cell.gameMode}: no matches`
            : `${heroLabel(row.hero)} on ${cell.gameMode}: ${cell.winrate}% winrate over ${cell.total} matches. Click to drill into maps.`"
          @click="onCellClick(row.hero, cell, $event)"
          @keydown.enter.prevent="emit('cell', row.hero, cell.gameMode)"
          @keydown.space.prevent="emit('cell', row.hero, cell.gameMode)"
        >
          <span v-if="cell.total > 0" class="cell-rate">{{ cell.winrate }}%</span>
          <span v-if="cell.total > 0" class="cell-vol">{{ cell.total }}</span>
        </button>
      </div>
    </div>

    <!-- Selection readout (stats only — selecting live-filters, no button). The
         slot is reserved (active stats or a faint prompt) so it never shifts the
         match list below — consistent with Geography + the Campaign Log. -->
    <div v-if="sel.count.value > 0" class="hm-selection" data-hm-selection-bar>
      <span class="hm-sel-stats" data-hm-selection-stats>
        <strong>{{ sel.count.value }}</strong> cell{{ sel.count.value === 1 ? '' : 's' }}
        <span aria-hidden="true">·</span>
        {{ selectionStats.wins }}–{{ selectionStats.losses }}–{{ selectionStats.draws }}
        <template v-if="selectionStats.winrate !== null"> · {{ selectionStats.winrate }}% WR</template>
        · {{ selectionStats.total }} game{{ selectionStats.total === 1 ? '' : 's' }}
      </span>
      <span v-if="!sel.isRectangular.value" class="hm-sel-hint" data-hm-hull-note>
        filtering every hero × mode in your selection
      </span>
    </div>
    <p v-else class="hm-selection hm-selection-empty" data-hm-selection-empty>
      Ctrl/Shift-click a cell, hero, or mode to compare — plain click drills in
    </p>
  </template>
</template>

<style scoped>
/* ─── Root heatmap grid ─────────────────────────────────────────── */
.heatmap-empty {
  margin: 0.6rem 0 0.1rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}

.heatmap-grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 0.4rem;
}

.heatmap-row {
  display: grid;
  grid-template-columns: 6rem repeat(6, 1fr);
  gap: 2px;
  align-items: stretch;
}

.heatmap-header {
  font-family: var(--mono);
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.heatmap-corner {
  display: block;
}

/* Column + row headers are now selection buttons; strip UA chrome, keep the look. */
:where(button.heatmap-colhead, button.heatmap-rowhead) {
  appearance: none;
  border: 0;
  background: none;
  cursor: pointer;
}

.heatmap-colhead {
  text-align: center;
  padding: 0.1rem 0.2rem;
  color: inherit;
  font: inherit;
}

.heatmap-rowhead {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 0.95rem;
  letter-spacing: 0.03em;
  color: var(--text);
  padding-right: 0.4rem;
  display: flex;
  align-items: center;
  text-transform: capitalize;
}

.heatmap-colhead:hover,
.heatmap-rowhead:hover { color: var(--accent); }

.heatmap-colhead:focus-visible,
.heatmap-rowhead:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
  color: var(--accent);
}

/* A header whose hero / game-mode is part of the current selection — stays lit. */
.heatmap-colhead.header-selected,
.heatmap-rowhead.header-selected {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  border-radius: 2px;
}

.heatmap-cell {
  appearance: none;
  border: none;
  border-radius: 2px;
  padding: 0.25rem 0.2rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 0.05rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text);
  min-height: 2.2rem;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.heatmap-cell:not(:disabled):hover {
  transform: scale(1.04);
  box-shadow: 0 0 0 1px var(--accent);
}

.heatmap-cell:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* A modifier-selected cell — solid accent ring (distinct from the hover glow). */
.heatmap-cell.hm-selected {
  box-shadow: 0 0 0 2px var(--accent), 0 0 6px color-mix(in srgb, var(--accent) 45%, transparent);
  z-index: 1;
}

.heatmap-cell.in-drag-box {
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 60%, transparent);
  z-index: 1;
}

.heatmap-cell.cell-empty {
  background: var(--surface-2);
  cursor: default;
}

.heatmap-cell.cell-win  { background: var(--win,  #2ecc71); color: var(--bg); }
.heatmap-cell.cell-mid  { background: var(--neutral, #95a5a6); color: var(--bg); }
.heatmap-cell.cell-loss { background: var(--loss, #e74c3c); color: var(--bg); }
.heatmap-cell.cell-draw { background: var(--draw, #b59c30); color: var(--bg); }

.cell-rate {
  font-size: 0.7rem;
  line-height: 1;
}

.cell-vol {
  font-size: 0.5rem;
  opacity: 0.8;
  line-height: 1;
}

/* ─── Selection readout (mirrors the Geography band + Campaign Log) ── */
.hm-selection {
  display: flex;
  align-items: center;
  gap: 0.5rem 0.9rem;
  margin: 0.6rem 0 0;

  /* Reserve the active row's height so the empty ↔ active swap never shifts the
     match list below. */
  min-height: 2.1rem;
  box-sizing: border-box;
  padding: 0.4rem 0.55rem;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

/* The reserved-but-empty slot: same box, dashed + faint, a single-line prompt. */
.hm-selection-empty {
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

.hm-sel-stats {
  flex: 1 1 auto;
  min-width: 0;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hm-sel-stats strong { color: var(--accent); font-weight: 700; }

.hm-sel-hint {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 0.58rem;
  color: var(--text-faint);
  font-style: italic;
  max-width: 18rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
