<script setup lang="ts">
import { computed } from 'vue'

import { formatPivotCell, type PivotResult } from '@/match/pivot-aggregate'

// Renders a PivotResult as a crosstab: row-dimension headers down the
// left, column-dimension groups across the top (each split into one
// sub-column per value spec), with row / column / grand margins. Win-rate
// value cells carry a heat-map tint — red below 50%, green above — so a
// glance reads strength without parsing the numbers. Pure presentation;
// all the math arrives pre-computed.
const props = defineProps<{ result: PivotResult }>()

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

// Heat-map for win-rate cells only: 0 at 50% (neutral), ramping to a
// capped 35% tint of --win above and --loss below — AA-safe on every
// theme since text stays at full --text.
function cellStyle(value: number | null, v: number): Record<string, string> | undefined {
  if (value === null || r.value.values[v]?.agg !== 'winRate') return undefined
  const pct = Math.max(0, Math.min(100, value))
  const alpha = Math.round((Math.abs(pct - 50) / 50) * 35)
  const tone = pct >= 50 ? 'var(--win)' : 'var(--loss)'
  return { background: `color-mix(in srgb, ${tone} ${alpha}%, transparent)` }
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
              v-for="(_v, v) in r.values"
              :key="`c-${ri}-${gi}-${v}`"
              class="ct-cell"
              :class="{ 'ct-cell-total': g.col === 'total' }"
              :style="cellStyle(cellAt(ri, g.col, v), v)"
            >
              {{ fmt(cellAt(ri, g.col, v), v) }}
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
              v-for="(_v, v) in r.values"
              :key="`gc-${gi}-${v}`"
              class="ct-cell ct-cell-grand"
              :class="{ 'ct-cell-total': g.col === 'total' }"
              :style="cellStyle(grandAt(g.col, v), v)"
            >
              {{ fmt(grandAt(g.col, v), v) }}
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
  font-size: 0.7rem;
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
  font-size: 0.54rem;
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
  text-align: right;
  color: var(--text);
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
