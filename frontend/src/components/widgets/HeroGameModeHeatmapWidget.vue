<script setup lang="ts">
import { computed } from 'vue'
import { useDossier } from '../../composables/useDossier'
import { useNarrow } from '../../composables/useNarrow'
import { useOWData } from '../../composables/useOWData'
import { useWidgetConfig } from '../../composables/useWidgetConfig'
import { heroGameModeHeatmapSchema, type HeroGameModeHeatmapConfig } from '../../dashboard/widgets'

// Hero × game-mode heatmap. Rows are the top-N most-played heroes
// in the narrowed set; columns are the canonical 6 game modes
// (control / escort / flashpoint / hybrid / push / clash). Each
// cell's tone reads winrate (green → amber → red); cell opacity
// reads volume so the eye lands on the cells that carry weight.
// Clicking a cell narrows the active set to that (hero, gameMode)
// pair so the user can drill into the matches that produced the
// surface signal without leaving the page.

const dossier = useDossier()
const narrow  = useNarrow()
const ow      = useOWData()
const { config } = useWidgetConfig<HeroGameModeHeatmapConfig>(
  'hero-game-mode-heatmap',
  heroGameModeHeatmapSchema,
)

const cells = dossier.heroGameModeCounts(() => ({
  heroLimit:  config.value.heroLimit,
  minMatches: config.value.minMatches,
}))

// Pivot the flat cell list into a 2-D structure keyed by hero so
// the template can render `<row>` per hero + `<col>` per type. The
// column order matches the canonical game-mode slug order produced
// by the dossier helper.
const rows = computed(() => {
  const byHero = new Map<string, typeof cells.value>()
  for (const c of cells.value) {
    const arr = byHero.get(c.hero) ?? []
    arr.push(c)
    byHero.set(c.hero, arr)
  }
  return [...byHero.entries()].map(([hero, cs]) => ({ hero, cells: cs }))
})

const columnHeaders = computed(() => {
  // Read the column headers off the first row — the dossier helper
  // emits cells in a stable game-mode order, so any row suffices.
  return rows.value[0]?.cells.map((c) => c.gameMode) ?? []
})

// Empty-state gate. When the narrowed set carries fewer total
// decisive matches than `minMatches`, the heatmap surfaces are
// statistically noisy — better to show a small banner inviting the
// user to play more or relax their narrow than to render bars that
// flap on every new match.
const decisiveTotal = computed(() => {
  let n = 0
  for (const c of cells.value) n += c.wins + c.losses
  return n
})
const belowFloor = computed(() => decisiveTotal.value < config.value.minMatches)

// Winrate → CSS class. Three buckets (sub-40%, neutral, 60%+) so
// the visual reads at a glance without needing to recall a
// gradient legend. `none` paints the empty-cell surface tone.
function cellClass(c: { total: number; winrate: number; wins: number; losses: number }) {
  if (c.total === 0)            return 'cell-empty'
  if (c.wins + c.losses === 0)  return 'cell-draw'   // total > 0 but all draws
  if (c.winrate >= 60)          return 'cell-win'
  if (c.winrate <= 40)          return 'cell-loss'
  return 'cell-mid'
}

// Cell opacity scales with play volume — caps at total = 10 so the
// brightest cell isn't hostage to a single grinding marathon.
function cellOpacity(c: { total: number }) {
  if (c.total === 0) return undefined
  return String(Math.min(0.45 + (c.total / 10) * 0.55, 1))
}

function onCellClick(hero: string, gameMode: string) {
  // Narrow into the matches that produced this cell. Both pickers
  // toggle, so a second click un-narrows. The dossier re-aggregates
  // on the next computed tick — no manual refresh needed.
  narrow.pickHero(hero)
  narrow.pickGameMode(gameMode)
}

const heroLabel = (h: string) => ow.heroDisplayName(h) || h
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Hero × game-mode</span>
  </header>

  <p v-if="belowFloor" class="heatmap-empty">
    Need {{ config.minMatches }}+ decisive matches to surface
    patterns. You have {{ decisiveTotal }}.
  </p>

  <div v-else class="heatmap-grid" role="grid" :aria-label="`Hero by game-mode heatmap, ${rows.length} heroes × ${columnHeaders.length} game modes`">
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
        :class="cellClass(cell)"
        :style="{ opacity: cellOpacity(cell) }"
        :disabled="cell.total === 0"
        :title="cell.total === 0
          ? `${heroLabel(row.hero)} on ${cell.gameMode}: no matches`
          : `${heroLabel(row.hero)} on ${cell.gameMode}: ${cell.wins}-${cell.losses}-${cell.draws} (${cell.winrate}% winrate)`"
        :aria-label="cell.total === 0
          ? `${heroLabel(row.hero)} on ${cell.gameMode}: no matches`
          : `${heroLabel(row.hero)} on ${cell.gameMode}: ${cell.winrate}% winrate over ${cell.total} matches. Click to narrow.`"
        @click="onCellClick(row.hero, cell.gameMode)"
      >
        <span v-if="cell.total > 0" class="cell-rate">{{ cell.winrate }}%</span>
        <span v-if="cell.total > 0" class="cell-vol">{{ cell.total }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
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
