<script setup lang="ts">
import { heatmapCellClass, heatmapCellOpacity } from '@/match-heatmap-helpers'

// The Hero × Game-Mode band's root level: a heroes × game-modes win-rate
// heatmap (hue by win-rate band, opacity by volume), or a floor-gate empty
// state when there aren't enough decisive matches yet. Extracted from
// MatchHeroModeBand; clicking a populated cell emits `cell` so the band
// drills into that hero×mode's maps.
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

defineProps<{
  rows: HeatmapRow[]
  columnHeaders: string[]
  belowFloor: boolean
  minMatches: number
  decisiveTotal: number
  heroLabel: (hero: string) => string
}>()

defineEmits<{
  cell: [hero: string, gameMode: string]
}>()
</script>

<template>
  <p v-if="belowFloor" class="heatmap-empty">
    Need {{ minMatches }}+ decisive matches in this window to
    surface patterns. You have {{ decisiveTotal }}.
  </p>
  <div
    v-else
    class="heatmap-grid"
    role="grid"
    :aria-label="`Hero by game-mode heatmap, ${rows.length} heroes × ${columnHeaders.length} game modes`"
  >
    <div class="heatmap-row heatmap-header" role="row">
      <span class="heatmap-corner" role="columnheader" aria-label="Hero" />
      <span v-for="t in columnHeaders" :key="t" class="heatmap-colhead" role="columnheader">
        {{ t }}
      </span>
    </div>
    <div
      v-for="row in rows"
      :key="row.hero"
      class="heatmap-row"
      role="row"
    >
      <span class="heatmap-rowhead" role="rowheader">{{ heroLabel(row.hero) }}</span>
      <button
        v-for="cell in row.cells"
        :key="cell.gameMode"
        type="button"
        class="heatmap-cell"
        :class="heatmapCellClass(cell)"
        :style="{ opacity: heatmapCellOpacity(cell) }"
        :disabled="cell.total === 0"
        :title="cell.total === 0
          ? `${heroLabel(row.hero)} on ${cell.gameMode}: no matches`
          : `${heroLabel(row.hero)} on ${cell.gameMode}: ${cell.wins}-${cell.losses}-${cell.draws} (${cell.winrate}% winrate). Click to drill into maps.`"
        :aria-label="cell.total === 0
          ? `${heroLabel(row.hero)} on ${cell.gameMode}: no matches`
          : `${heroLabel(row.hero)} on ${cell.gameMode}: ${cell.winrate}% winrate over ${cell.total} matches. Click to drill into maps.`"
        @click="$emit('cell', row.hero, cell.gameMode)"
      >
        <span v-if="cell.total > 0" class="cell-rate">{{ cell.winrate }}%</span>
        <span v-if="cell.total > 0" class="cell-vol">{{ cell.total }}</span>
      </button>
    </div>
  </div>
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

.heatmap-colhead {
  text-align: center;
  padding: 0.1rem 0.2rem;
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

</style>
