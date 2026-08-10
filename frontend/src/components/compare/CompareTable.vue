<script setup lang="ts">
import type { ComparisonRow, ComparisonSection } from '@/match/match-compare-helpers'

// The A / B / Δ evidence table shared by both Compare modes. Sections render
// as labeled tbody groups; the winning column of a judged row is tinted.
// When `drillable` marks a cell, it becomes a button that emits `drill` — the
// Form mode routes that into a Matches narrow (window + dimension); the
// Seasons mode leaves the table inert.

const props = defineProps<{
  sections: ComparisonSection[]
  labelA: string
  labelB: string
  drillable?: (row: ComparisonRow, col: 'a' | 'b') => boolean
}>()

const emit = defineEmits<{
  drill: [rowKey: string, col: 'a' | 'b']
}>()

function canDrill(row: ComparisonRow, col: 'a' | 'b'): boolean {
  return props.drillable ? props.drillable(row, col) : false
}

function onCell(row: ComparisonRow, col: 'a' | 'b') {
  if (canDrill(row, col)) emit('drill', row.key, col)
}

function deltaClass(r: ComparisonRow) {
  return {
    'is-improved': r.outcome === 'improved',
    'is-regressed': r.outcome === 'regressed',
    'is-muted': r.outcome === 'neutral' || r.outcome === 'even' || r.outcome === null,
  }
}
</script>

<template>
  <table class="compare-table" aria-label="Comparison metrics">
    <thead>
      <tr>
        <th scope="col" class="compare-metric-head">
          Metric
        </th>
        <th scope="col">
          {{ labelA }}
        </th>
        <th scope="col">
          {{ labelB }}
        </th>
        <th scope="col" class="compare-delta-head">
          Δ&nbsp;(B&nbsp;vs&nbsp;A)
        </th>
      </tr>
    </thead>
    <tbody v-for="section in sections" :key="section.title" :data-compare-section="section.title">
      <tr class="compare-section-row">
        <th scope="colgroup" colspan="4" class="compare-section-head">
          {{ section.title }}
        </th>
      </tr>
      <tr v-for="r in section.rows" :key="r.key" :data-compare-row="r.key">
        <th scope="row" class="compare-metric">
          {{ r.label }}
        </th>
        <!-- Drillable cells keep their native table semantics (and the row-
             header association) by nesting a real <button>; the button's name
             carries the action + metric + column, not just the value. -->
        <td class="compare-a" :class="{ 'is-winner': r.outcome === 'regressed' }">
          <button
            v-if="canDrill(r, 'a')"
            type="button"
            class="compare-cell-btn"
            :aria-label="`Show matches — ${r.label}, ${labelA}: ${r.aDisplay}`"
            @click="onCell(r, 'a')"
          >
            {{ r.aDisplay }}
          </button>
          <template v-else>
            {{ r.aDisplay }}
          </template>
        </td>
        <td class="compare-b" :class="{ 'is-winner': r.outcome === 'improved' }">
          <button
            v-if="canDrill(r, 'b')"
            type="button"
            class="compare-cell-btn"
            :aria-label="`Show matches — ${r.label}, ${labelB}: ${r.bDisplay}`"
            @click="onCell(r, 'b')"
          >
            {{ r.bDisplay }}
          </button>
          <template v-else>
            {{ r.bDisplay }}
          </template>
        </td>
        <td class="compare-delta" :class="deltaClass(r)">
          <span v-if="r.delta">{{ r.delta }}</span>
          <span v-else class="compare-dash" aria-hidden="true">·</span>
          <span
            v-if="r.lowSample"
            class="compare-lown"
            title="Fewer than 5 decisive matches in one window — treat the rate as noisy"
          >n&lt;5</span>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.compare-table {
  width: 100%;
  margin-top: 1rem;
  border-collapse: collapse;
  font-size: var(--type-lg);
}

.compare-table th,
.compare-table td {
  padding: 0.42rem 0.6rem;
  border-bottom: 1px solid var(--border);
  text-align: right;
}

.compare-table thead th {
  font-family: var(--mono);
  font-size: var(--type-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
  border-bottom: 1px solid var(--border);
  vertical-align: bottom;
}

.compare-metric-head,
.compare-metric {
  text-align: left;
}

.compare-section-head {
  padding: 1.1rem 0.6rem 0.35rem;
  text-align: left;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;

  /* --accent-text is the theme-aware accent-for-text token (dark orange in Day,
     bright in dark themes) — the raw --accent orange is sub-AA on light surfaces. */
  color: var(--accent-text);
  border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
}

.compare-metric {
  font-weight: 500;
  color: var(--text-dim);
}

.compare-a,
.compare-b {
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.compare-a.is-winner,
.compare-b.is-winner {
  background: color-mix(in srgb, var(--win) 14%, transparent);
  font-weight: 600;
}

/* The nested drill button inherits the cell's typography wholesale so a
   drillable cell reads identically to an inert one until hovered. */
.compare-cell-btn {
  appearance: none;
  display: block;
  width: 100%;
  margin: -0.42rem -0.6rem;
  padding: 0.42rem 0.6rem;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-variant-numeric: inherit;
  text-align: right;
  cursor: pointer;
}

.compare-cell-btn:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.compare-cell-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.compare-delta {
  font-family: var(--mono);
  font-size: var(--type-md);
  white-space: nowrap;
}

.compare-delta.is-improved {
  color: var(--win);
}

.compare-delta.is-regressed {
  color: var(--loss);
}

.compare-delta.is-muted {
  color: var(--text-faint);
}

.compare-dash {
  color: var(--text-faint);
}

.compare-lown {
  display: inline-block;
  margin-left: 0.3rem;
  padding: 0 0.28rem;
  border-radius: var(--radius);

  /* Soft-loss fill + line carries the "warning" semantic, but the TEXT is the
     high-contrast --text so it clears WCAG-AA on every theme — a --loss-colored
     glyph on the loss tint falls to ~3.9:1 at this size in the Day theme. */
  background: var(--loss-soft);
  color: var(--text);
  border: 1px solid var(--loss-line);
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.02em;
}

@media (width <= 560px) {
  .compare-table {
    font-size: var(--type-md);
  }

  .compare-table th,
  .compare-table td {
    padding: 0.38rem 0.4rem;
  }
}
</style>
