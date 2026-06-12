<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDossier } from '../composables/useDossier'
import { useNarrow } from '../composables/useNarrow'
import { useOWData } from '../composables/useOWData'
import { useWidgetConfig } from '../composables/useWidgetConfig'
import { heroGameModeHeatmapSchema, type HeroGameModeHeatmapConfig } from '../dashboard/widgets'
import WidgetConfigPopover from './WidgetConfigPopover.vue'

// HERO × GAME-MODE — winrate-by-(hero, game-mode) band.
//
// A full-width dossier section (sibling of Campaign Log + Geography):
// rows are the top-N most-played heroes in the narrowed set, columns
// are the canonical 6 game modes. Each cell's tone reads winrate
// (green → amber → red); cell opacity reads volume so the eye lands on
// the cells that carry weight. Clicking a cell narrows the active set
// to that (hero, gameMode) pair.
//
// Header furniture mirrors Geography: a trailing-window picker
// (1M/3M/6M/12M) feeds the dossier helper, and an inline gear opens the
// shared WidgetConfigPopover (heroes-to-show + min-matches). Config
// persists under the same key the widget used, so prior settings carry
// over.

const dossier = useDossier()
const narrow  = useNarrow()
const ow      = useOWData()
const { config } = useWidgetConfig<HeroGameModeHeatmapConfig>(
  'hero-game-mode-heatmap',
  heroGameModeHeatmapSchema,
)

// Inline gear popover. WidgetConfigPopover only reads { id, eyebrow,
// config } off the def, so a minimal object keeps this out of the grid
// widget registry while reusing the schema-driven form.
const configDef = {
  id:      'hero-game-mode-heatmap',
  eyebrow: 'Hero × Game-Mode',
  config:  heroGameModeHeatmapSchema,
}
const configOpen = ref(false)
const configAnchor = ref<DOMRect | null>(null)
function toggleConfig(e: MouseEvent) {
  configAnchor.value = (e.currentTarget as HTMLElement).getBoundingClientRect()
  configOpen.value = !configOpen.value
}
const configIsDefault = computed(() => {
  const d = heroGameModeHeatmapSchema.defaults()
  return config.value.heroLimit === d.heroLimit && config.value.minMatches === d.minMatches
})

// Trailing time-window toggle (1M/3M/6M/12M), mirroring Campaign Log +
// Geography. Persisted so the choice survives reloads; default 6M to
// match the sibling rows.
const WINDOWS = [1, 3, 6, 12] as const
type WindowKey = (typeof WINDOWS)[number]
const WINDOW_STORAGE_KEY = 'recall.heroModeWindowMonths'
function loadWindow(): WindowKey {
  try {
    const n = Number(localStorage.getItem(WINDOW_STORAGE_KEY))
    if ((WINDOWS as readonly number[]).includes(n)) return n as WindowKey
  } catch (_) { /* swallow */ }
  return 6
}
const windowMonths = ref<WindowKey>(loadWindow())
function pickWindow(m: WindowKey) {
  windowMonths.value = m
  try { localStorage.setItem(WINDOW_STORAGE_KEY, String(m)) } catch (_) { /* swallow */ }
}

const cells = dossier.heroGameModeCounts(() => ({
  heroLimit:    config.value.heroLimit,
  minMatches:   config.value.minMatches,
  windowMonths: windowMonths.value,
}))

// Pivot the flat cell list into a 2-D structure keyed by hero so the
// template can render a row per hero + a column per game mode. The
// column order matches the canonical game-mode slug order the dossier
// helper emits.
const rows = computed(() => {
  const byHero = new Map<string, typeof cells.value>()
  for (const c of cells.value) {
    const arr = byHero.get(c.hero) ?? []
    arr.push(c)
    byHero.set(c.hero, arr)
  }
  return [...byHero.entries()].map(([hero, cs]) => ({ hero, cells: cs }))
})

const columnHeaders = computed(() => rows.value[0]?.cells.map((c) => c.gameMode) ?? [])

// Empty-state gate. When the narrowed window carries fewer total
// decisive matches than `minMatches`, the heatmap surfaces are
// statistically noisy — better to invite the user to play more or
// widen the window than to render bars that flap on every new match.
const decisiveTotal = computed(() => {
  let n = 0
  for (const c of cells.value) n += c.wins + c.losses
  return n
})
const belowFloor = computed(() => decisiveTotal.value < config.value.minMatches)

// Winrate → CSS class. Three buckets (sub-40%, neutral, 60%+) so the
// visual reads at a glance. `none` paints the empty-cell surface tone.
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
  // toggle, so a second click un-narrows.
  narrow.pickHero(hero)
  narrow.pickGameMode(gameMode)
}

const heroLabel = (h: string) => ow.heroDisplayName(h) || h
</script>

<template>
  <section class="hero-mode-band" aria-labelledby="hm-eyebrow">
    <header class="hm-head">
      <span id="hm-eyebrow" class="hm-eyebrow">Hero × Game-Mode</span>
      <h3 class="hm-title">
        Winrate by hero × game-mode
      </h3>

      <div class="hm-window" role="group" aria-label="Time window">
        <button
          v-for="m in WINDOWS"
          :key="m"
          type="button"
          class="hm-window-btn"
          :class="{ active: windowMonths === m }"
          :aria-pressed="windowMonths === m"
          :title="`Last ${m} month${m === 1 ? '' : 's'}`"
          @click="pickWindow(m)"
        >
          {{ m }}M
        </button>
      </div>

      <button
        type="button"
        class="hm-gear"
        :class="{ 'hm-gear-active': !configIsDefault }"
        data-widget-config-trigger
        data-hero-mode-config-trigger
        :aria-label="configIsDefault ? 'Configure the Hero × Game-Mode band' : 'Hero × Game-Mode settings are customised'"
        :aria-expanded="configOpen"
        title="Heroes to show + min matches"
        @click="toggleConfig"
      >
        <span aria-hidden="true">⚙</span>
      </button>

      <ul class="hm-legend" aria-label="Cell-colour legend">
        <li><span class="hm-swatch hm-loss" /> Losing</li>
        <li><span class="hm-swatch hm-mixed" /> Mixed</li>
        <li><span class="hm-swatch hm-win" /> Winning</li>
      </ul>
    </header>

    <p v-if="belowFloor" class="heatmap-empty">
      Need {{ config.minMatches }}+ decisive matches in this window to
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

    <WidgetConfigPopover
      :open="configOpen"
      :def="configDef"
      :anchor="configAnchor"
      @close="configOpen = false"
    />
  </section>
</template>

<style scoped>
.hero-mode-band {
  padding: 0.7rem 1.1rem 0.75rem;
  border: 1px solid var(--border);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 4%, transparent) 0%, transparent 42%),
    var(--surface);
  border-radius: 2px;
}

.hm-head {
  display: flex;
  align-items: baseline;
  gap: 1.1rem;
  margin-bottom: 0.6rem;
  flex-wrap: wrap;
}

.hm-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.hm-title {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 1.15rem;
  font-weight: 400;
  letter-spacing: 0.03em;
  margin: 0;
  color: var(--text);
  text-transform: capitalize;
}

.hm-window {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
}

.hm-window-btn {
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
.hm-window-btn:last-child { border-right: 0; }
.hm-window-btn:hover { color: var(--text); }

.hm-window-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.hm-window-btn.active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

/* Gear — opens the schema-driven config popover. An accent dot in the
   corner signals when the config differs from the defaults. */
.hm-gear {
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
.hm-gear:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.hm-gear:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.hm-gear-active {
  color: var(--accent);
  border-color: var(--accent);
}

.hm-gear-active::after {
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

.hm-legend {
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

.hm-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.hm-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, currentcolor 25%, transparent);
}
.hm-win { background: var(--win); }
.hm-loss { background: var(--loss); }
.hm-mixed { background: color-mix(in srgb, var(--win) 50%, var(--loss)); }

/* ─── Heatmap grid (migrated from the former widget) ─────────────── */
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

@media (width <= 720px) {
  .hm-legend { display: none; }
}
</style>
