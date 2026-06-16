<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useNarrow } from '@/composables/matches/useNarrow'
import { useOWData } from '@/composables/shared/useOWData'
import { useWindowMonths } from '@/composables/matches/useWindowMonths'
import { useDrillNav } from '@/composables/matches/useDrillNav'
import { heatmapCellClass, heatmapCellOpacity } from '@/match/match-heatmap-helpers'
import HeroModeHeatmap from '@/components/matches/dossier/HeroModeHeatmap.vue'
import HeroModeMatches from '@/components/matches/dossier/HeroModeMatches.vue'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { heroGameModeHeatmapSchema, type HeroGameModeHeatmapConfig } from '@/dashboard/widgets'
import WidgetConfigPopover from '@/components/dashboard/WidgetConfigPopover.vue'

// HERO × GAME-MODE — a drill-down winrate explorer.
//
// A full-width dossier section (sibling of Campaign Log + Geography)
// with a navigation STACK:
//
//   depth 0 (root)  — top-N heroes × the 6 canonical game modes.
//   depth 1 (maps)  — after clicking a (hero, mode) cell: that hero's
//                     winrate on every map of that game mode.
//   depth 2 (matches) — after clicking a map: that map's recent matches.
//
// Each drill ALSO narrows the whole matches view (pickHero/pickGameMode/
// pickMap), so the list below reflects the drill. A "Go back" button pops
// one level at a time and reverts only the picks THIS band applied (never
// a dimension the user had already filtered). A reconciliation watcher
// truncates the stack if the user clears those filters from the rail.
//
// Only the root level applies the statistical floor ("need N+ decisive
// matches"); drill levels always render their slice + keep Go-back
// reachable, so a sparse drill can never strand the user.
//
// Header furniture mirrors Geography: a 1M/3M/6M/12M trailing-window
// picker feeds every level's aggregate, and an inline gear (root only)
// opens the shared WidgetConfigPopover (heroes-to-show + min-matches).

const dossier = useDossier()
const narrow  = useNarrow()
const ow      = useOWData()
const { config } = useWidgetConfig<HeroGameModeHeatmapConfig>(
  'hero-game-mode-heatmap',
  heroGameModeHeatmapSchema,
)

const GAME_MODE_LABEL: Record<string, string> = {
  control: 'Control', escort: 'Escort', flashpoint: 'Flashpoint',
  hybrid: 'Hybrid', push: 'Push', clash: 'Clash',
}
const gameModeLabel = (g: string) => GAME_MODE_LABEL[g] ?? g
const heroLabel = (h: string) => ow.heroDisplayName(h) || h
const mapLabel  = (m: string) => ow.mapDisplayName(m) || m

// ── Config gear (root level only) ──
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

// ── Trailing-window picker (all levels) ──
const { WINDOW_MONTHS: WINDOWS, windowMonths, pickWindow } = useWindowMonths('recall.heroModeWindowMonths')

// ── Drill stack ──
const { drillStack, depth, topFrame, drillToMaps, drillToMatches, goBack, goToDepth } = useDrillNav(narrow)

// ── Level 0 (root): hero × game-mode ──
const cells = dossier.heroGameModeCounts(() => ({
  heroLimit:    config.value.heroLimit,
  minMatches:   config.value.minMatches,
  windowMonths: windowMonths.value,
}))
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
const decisiveTotal = computed(() => {
  let n = 0
  for (const c of cells.value) n += c.wins + c.losses
  return n
})
const belowFloor = computed(() => decisiveTotal.value < config.value.minMatches)

// ── Level 1 (maps): the drilled hero across the mode's maps ──
const mapCells = dossier.mapCounts(() => ({ windowMonths: windowMonths.value }))
const mapTiles = computed(() => {
  if (depth.value !== 1) return []
  return mapCells.value
    .slice()
    .sort((a, b) => b.total - a.total || a.map.localeCompare(b.map))
    .map((c) => ({ slug: c.map, display: mapLabel(c.map), cell: c }))
})

// ── Level 2 (matches): the drilled map's recent games ──
const matchRows = dossier.recentMatches(() => ({ count: 12, windowMonths: windowMonths.value }))

// ── Shared cell colour/opacity (root grid + map tiles) ──
function onRootCell(hero: string, gameMode: string) {
  drillToMaps(hero, gameMode)
}

// ── Header: breadcrumb + per-level title ──
const breadcrumb = computed(() => {
  const crumbs: { label: string; depth: number }[] = [{ label: 'Hero × Game-Mode', depth: 0 }]
  drillStack.value.forEach((f, i) => {
    crumbs.push({
      label: f.level === 'maps'
        ? `${heroLabel(f.hero)} × ${gameModeLabel(f.gameMode)}`
        : mapLabel(f.map ?? ''),
      depth: i + 1,
    })
  })
  return crumbs
})
const levelTitle = computed(() => {
  const f = topFrame.value
  if (!f) return 'Winrate by hero × game-mode'
  return f.level === 'maps'
    ? `${heroLabel(f.hero)} × ${gameModeLabel(f.gameMode)} maps`
    : `${mapLabel(f.map ?? '')} · recent matches`
})
</script>

<template>
  <section class="hero-mode-band" aria-labelledby="hm-eyebrow">
    <header class="hm-head">
      <nav v-if="depth > 0" class="hm-crumbs" aria-label="Drill path">
        <button
          type="button"
          class="hm-back"
          data-hero-mode-back
          @click="goBack"
        >
          ‹ Go back
        </button>
        <ol class="hm-crumb-list">
          <li v-for="c in breadcrumb" :key="c.depth" class="hm-crumb-item">
            <button
              v-if="c.depth < depth"
              type="button"
              class="hm-crumb"
              @click="goToDepth(c.depth)"
            >
              {{ c.label }}
            </button>
            <span v-else class="hm-crumb hm-crumb-current" aria-current="step">{{ c.label }}</span>
            <span v-if="c.depth < depth" class="hm-crumb-sep" aria-hidden="true">›</span>
          </li>
        </ol>
      </nav>
      <span v-else id="hm-eyebrow" class="hm-eyebrow">Hero × Game-Mode</span>

      <h3 class="hm-title">
        {{ levelTitle }}
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
        v-if="depth === 0"
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

      <ul v-if="depth <= 1" class="hm-legend" aria-label="Cell-colour legend">
        <li><span class="hm-swatch hm-loss" /> Losing</li>
        <li><span class="hm-swatch hm-mixed" /> Mixed</li>
        <li><span class="hm-swatch hm-win" /> Winning</li>
      </ul>
    </header>

    <!-- Fixed-height body: drilling/going-back never resizes the band (so
       the matches list below never shifts); a level that overflows scrolls
       inside this pane instead. -->
    <div class="hm-body">
      <!-- Level 0 — root hero × game-mode grid (keeps the floor gate). -->
      <HeroModeHeatmap
        v-if="depth === 0"
        :rows="rows"
        :column-headers="columnHeaders"
        :below-floor="belowFloor"
        :min-matches="config.minMatches"
        :decisive-total="decisiveTotal"
        :hero-label="heroLabel"
        @cell="onRootCell"
      />

      <!-- Level 1 — the drilled hero across the game-mode's maps. -->
      <div v-else-if="depth === 1" class="hm-maps" data-hero-mode-maps>
        <button
          v-for="t in mapTiles"
          :key="t.slug"
          type="button"
          class="hm-map-tile"
          :class="heatmapCellClass(t.cell)"
          :style="{ opacity: heatmapCellOpacity(t.cell) }"
          :title="`${t.display}: ${t.cell.wins}-${t.cell.losses}-${t.cell.draws} (${t.cell.winrate}% winrate). Click for recent matches.`"
          :aria-label="`${t.display}: ${t.cell.winrate}% winrate over ${t.cell.total} matches. Click for recent matches.`"
          @click="drillToMatches(t.slug)"
        >
          <span class="hm-map-name">{{ t.display }}</span>
          <span class="hm-map-rate">{{ t.cell.winrate }}%</span>
          <span class="hm-map-vol">{{ t.cell.wins }}–{{ t.cell.losses }}<template v-if="t.cell.draws">–{{ t.cell.draws }}</template></span>
        </button>
        <p v-if="mapTiles.length === 0" class="hm-drill-empty">
          No maps in this window.
        </p>
      </div>

      <!-- Level 2 — the drilled map's recent matches. -->
      <HeroModeMatches v-else :match-rows="matchRows" :map-label="mapLabel" />
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

/* Breadcrumb + Go-back (drill levels). */
.hm-crumbs {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.hm-back {
  appearance: none;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 0.2rem 0.55rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
.hm-back:hover { background: color-mix(in srgb, var(--accent-soft) 55%, var(--accent)); color: var(--text); }
.hm-back:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.hm-crumb-list {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.hm-crumb-item { display: inline-flex; align-items: center; gap: 0.3rem; }

.hm-crumb {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: var(--text-faint);
  cursor: pointer;
}
.hm-crumb:hover { color: var(--accent); }
.hm-crumb:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.hm-crumb-current { color: var(--accent); font-weight: 700; }
.hm-crumb-sep { color: var(--text-faint); }

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

/* Gear — root-level config popover. Accent dot when non-default. */
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

/* Fixed-height level body — a constant, comfortable height across every
   drill level so navigating the stack never resizes the band (and never
   shifts the matches list below it). A level taller than this scrolls in
   place; a shorter one (sparse root, recent-match list) simply leaves the
   reserved space. */
.hm-body {
  height: clamp(15rem, 36vh, 19rem);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.hm-body::-webkit-scrollbar { width: 8px; }
.hm-body::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
.hm-body::-webkit-scrollbar-thumb:hover { background: var(--accent); }
.hm-body::-webkit-scrollbar-track { background: transparent; }

/* ─── Level 1 — map tiles ───────────────────────────────────────── */
.hm-maps {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
  gap: 4px;
  margin-top: 0.4rem;
}

.hm-map-tile {
  appearance: none;
  border: none;
  border-radius: 2px;
  padding: 0.4rem 0.5rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  min-height: 3.1rem;
  color: var(--bg);
  text-align: left;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.hm-map-tile:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px var(--accent);
}

.hm-map-tile:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.hm-map-tile.cell-win  { background: var(--win,  #2ecc71); }
.hm-map-tile.cell-mid  { background: var(--neutral, #95a5a6); }
.hm-map-tile.cell-loss { background: var(--loss, #e74c3c); }
.hm-map-tile.cell-draw { background: var(--draw, #b59c30); }
.hm-map-tile.cell-empty { background: var(--surface-2); color: var(--text-faint); cursor: default; }

.hm-map-name {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-size: 0.92rem;
  letter-spacing: 0.02em;
  line-height: 1.05;
}

.hm-map-rate {
  font-family: var(--mono);
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
}

.hm-map-vol {
  font-family: var(--mono);
  font-size: 0.56rem;
  opacity: 0.85;
  line-height: 1;
}

/* ─── Level 2 — recent matches list ─────────────────────────────── */
.hm-drill-empty {
  margin: 0.6rem 0 0.1rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}

@media (width <= 720px) {
  .hm-legend { display: none; }
}
</style>
