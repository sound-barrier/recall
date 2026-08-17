<script setup lang="ts">
import { computed } from 'vue'

import { formatPivotCell, type PivotResult, type PivotTally } from '@/match/pivot/pivot-aggregate'
import { heatmapCellClass, heatmapCellJudgment, heatmapCellOpacity } from '@/match/trends/match-heatmap-helpers'

// Renders a PivotResult as a crosstab: row-dimension headers down the
// left, column-dimension groups across the top (each split into one
// sub-column per value spec), with row / column / grand margins. Win-rate
// value cells carry the SHARED verdict tint (heatmapCellClass) so a 53%
// here means what a 53% means on the dossier bands. Pure presentation;
// all the math arrives pre-computed.
const props = defineProps<{ result: PivotResult }>()

// A cell the grid has no bucket for. Reads as the `empty` band, which is
// what a missing row/column intersection honestly is.
const NO_MATCHES: PivotTally = { total: 0, wins: 0, losses: 0, records: 0 }

const r = computed(() => props.result)
const leadCols = computed(() => Math.max(r.value.rowFields.length, 1))

// One header group per column key, plus a trailing Total group when there
// is an actual column dimension. `col` indexes into the cells/colTotals;
// 'total' reads the row/grand margins.
const groups = computed(() => {
  const g = r.value.colKeys.map((k, ci) => ({ label: k.join(' / ') || 'All', col: ci as number | 'total' }))
  if (r.value.colFields.length > 0) g.push({ label: 'Total', col: 'total' })
  return g
})

const rowLabelHeaders = computed(() => (r.value.rowFields.length > 0 ? r.value.rowFieldLabels : ['']))

function rowCells(rowKey: string[]): string[] {
  return r.value.rowFields.length > 0 ? rowKey : ['All']
}

function cellAt(rowIndex: number, col: number | 'total', v: number): number | null {
  if (col === 'total') return r.value.rowTotals[rowIndex]?.[v] ?? null
  return r.value.cells[rowIndex]?.[col]?.[v] ?? null
}

function grandAt(col: number | 'total', v: number): number | null {
  if (col === 'total') return r.value.grandTotals[v] ?? null
  return r.value.colTotals[col]?.[v] ?? null
}

function fmt(value: number | null, v: number): string {
  return formatPivotCell(value, r.value.values[v]?.agg ?? 'count')
}

function tallyAt(rowIndex: number, col: number | 'total'): PivotTally {
  if (col === 'total') return r.value.tallies.rows[rowIndex] ?? NO_MATCHES
  return r.value.tallies.cells[rowIndex]?.[col] ?? NO_MATCHES
}

function grandTallyAt(col: number | 'total'): PivotTally {
  if (col === 'total') return r.value.tallies.grand
  return r.value.tallies.cols[col] ?? NO_MATCHES
}

// What one value cell renders as. `heat` is null for the aggregations that
// record VOLUME rather than judging it (count, sum, average, K/D) — a tint
// there would claim a verdict the number never made.
interface CellView {
  text: string
  heat: string | null
  volume: string | undefined
  // Accessible name; undefined leaves the printed number to speak for
  // itself. A tinted cell is the one case where color is the only cue, so
  // it appends the shared judgment word (WCAG 1.4.1).
  name: string | undefined
}

// The spoken half of the cell. A tint that carries a verdict must say that
// verdict out loud (WCAG 1.4.1), but only when there is one to say.
function cellName(text: string, value: number | null, tally: PivotTally): string | undefined {
  // The engine's `empty` band keys off W/L/D counts, so a bucket whose
  // records never produced a result reads as `empty` and would speak "no
  // matches" — contradicting the Matches column right beside it. Records
  // present but nothing decided: claim nothing.
  if (tally.total === 0 && tally.records > 0) return undefined
  const judgment = heatmapCellJudgment(tally)
  return value === null ? judgment : `${text} — ${judgment}`
}

function viewOf(value: number | null, tally: PivotTally, v: number): CellView {
  const text = fmt(value, v)
  if (r.value.values[v]?.agg !== 'winRate') return { text, heat: null, volume: undefined, name: undefined }
  return {
    text,
    heat: heatmapCellClass(tally),
    volume: heatmapCellOpacity(tally),
    name: cellName(text, value, tally),
  }
}

function rowViews(rowIndex: number, col: number | 'total'): CellView[] {
  const tally = tallyAt(rowIndex, col)
  return r.value.values.map((_spec, v) => viewOf(cellAt(rowIndex, col, v), tally, v))
}

function grandViews(col: number | 'total'): CellView[] {
  const tally = grandTallyAt(col)
  return r.value.values.map((_spec, v) => viewOf(grandAt(col, v), tally, v))
}
</script>

<template>
  <div class="pivot-crosstab-scroll">
    <table class="pivot-crosstab" :aria-label="`Pivot over ${r.recordCount} matches`">
      <thead>
        <tr>
          <th :colspan="leadCols" class="ct-corner" scope="col">
            {{ r.colFieldLabels.join(' / ') }}
          </th>
          <th
            v-for="(g, gi) in groups"
            :key="gi"
            :colspan="r.values.length"
            scope="colgroup"
            class="ct-group"
            :class="{ 'ct-group-total': g.col === 'total' }"
          >
            {{ g.label }}
          </th>
        </tr>
        <tr>
          <th v-for="(lbl, i) in rowLabelHeaders" :key="`rl-${i}`" scope="col" class="ct-rowlabel">
            {{ lbl }}
          </th>
          <template v-for="(g, gi) in groups" :key="`vg-${gi}`">
            <th
              v-for="(vlbl, v) in r.valueLabels"
              :key="`v-${gi}-${v}`"
              scope="col"
              class="ct-vlabel"
              :class="{ 'ct-vlabel-total': g.col === 'total' }"
            >
              {{ vlbl }}
            </th>
          </template>
        </tr>
      </thead>

      <tbody>
        <tr v-for="(rowKey, ri) in r.rowKeys" :key="ri" class="ct-row">
          <th v-for="(cellLabel, ci) in rowCells(rowKey)" :key="`rh-${ci}`" scope="row" class="ct-rowhead">
            {{ cellLabel }}
          </th>
          <template v-for="(g, gi) in groups" :key="`g-${ri}-${gi}`">
            <td
              v-for="(cv, v) in rowViews(ri, g.col)"
              :key="`c-${ri}-${gi}-${v}`"
              class="ct-cell"
              :class="{ 'ct-cell-total': g.col === 'total' }"
              :aria-label="cv.name"
            >
              <span v-if="cv.heat" class="ct-heat" :class="cv.heat" :style="{ '--ct-heat-volume': cv.volume }" />
              {{ cv.text }}
            </td>
          </template>
        </tr>
      </tbody>

      <tfoot>
        <tr class="ct-grand">
          <th :colspan="leadCols" scope="row" class="ct-rowhead ct-grand-label">
            Total
          </th>
          <template v-for="(g, gi) in groups" :key="`gt-${gi}`">
            <td
              v-for="(cv, v) in grandViews(g.col)"
              :key="`gc-${gi}-${v}`"
              class="ct-cell ct-cell-grand"
              :class="{ 'ct-cell-total': g.col === 'total' }"
              :aria-label="cv.name"
            >
              <span v-if="cv.heat" class="ct-heat" :class="cv.heat" :style="{ '--ct-heat-volume': cv.volume }" />
              {{ cv.text }}
            </td>
          </template>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<style scoped>
.pivot-crosstab-scroll {
  overflow: auto;
  max-height: 60vh;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.pivot-crosstab {
  border-collapse: collapse;
  font-family: var(--mono);
  font-size: var(--type-sm);
  font-variant-numeric: tabular-nums;
}

.pivot-crosstab th,
.pivot-crosstab td {
  padding: 0.3rem 0.6rem;
  border: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
  white-space: nowrap;
}

/* Sticky header band + first row-header column so labels stay visible
   while scrolling a big crosstab. */
.pivot-crosstab thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--surface-2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--type-3xs);
  font-weight: 700;
  color: var(--text-faint);
}

.ct-corner {
  text-align: left;
  color: var(--text-dim);
}

.ct-group { text-align: center; color: var(--identity-accent); }
.ct-group-total { color: var(--text); }
.ct-rowlabel { text-align: left; color: var(--text-faint); }
.ct-vlabel { text-align: right; }
.ct-vlabel-total { color: var(--text); }

.ct-rowhead {
  text-align: left;
  font-weight: 700;
  color: var(--identity-accent);
  background: color-mix(in srgb, var(--surface-2) 60%, transparent);
}

.ct-cell {
  position: relative;
  z-index: 0;
  text-align: right;
  color: var(--text);
}

/* The verdict tint, painted BEHIND the number rather than on the cell.
   The heatmap bands are bare colored plates and carry --bg text on a
   full-strength fill; a crosstab cell's whole job is to be read, so the
   fill sits on its own layer (z-index -1 inside .ct-cell's stacking
   context) and the digits stay at full --text.

   The color itself comes from the shared .cell-* classes in
   styles/judgment.css — nothing is redeclared here, so the tint cannot
   drift from the bands. --ct-heat-volume is heatmapCellOpacity's volume
   ramp (0.45 at one match → 1 by ten); 0.35 is the surface's dilution
   ceiling, the same weight the old hand-rolled color-mix capped at and
   the point where --text still clears AA on the strongest tint of every
   theme (worst case: --win under Dark on --surface-3, 4.8:1). */
.ct-heat {
  position: absolute;
  inset: 0;
  z-index: -1;
  opacity: calc(var(--ct-heat-volume, 1) * 0.35);
  pointer-events: none;
}

.ct-cell-total { font-weight: 700; }

.ct-row:hover td { background: color-mix(in srgb, var(--accent) 5%, transparent); }

.ct-grand th,
.ct-grand td {
  border-top: 2px solid var(--border-strong);
  font-weight: 700;
}

.ct-grand-label { color: var(--text); }
</style>
