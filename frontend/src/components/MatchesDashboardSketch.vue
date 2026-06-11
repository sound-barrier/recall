<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MatchRecord } from '../api'

// NOTE: this file is a static dev-build sketch of the Analysis tab's
// future analytics layout. The PRODUCTION dashboard customization
// surface — registry-driven widgets, hide/show, drag-reorder — lives
// in `dashboard/widgets.ts` + `components/DashboardWidget.vue` +
// `components/widgets/*.vue`. Don't wire this sketch into that path.
//
// SKETCH — the Analysis tab's analytics-first dashboard layout
// (Phase E in ROADMAP.md → "Analysis tab"). Charts are placeholder
// SVG sketches
// so we can iterate on placement before wiring real data. The
// floating "drill-in" drawer maps to the existing MatchDetailPanel
// flow via `@open-match`, so the per-match deep-inspection surface
// the user built for the Matches tab is reachable from here too.
//
// What lives where:
//   - Scope bar (top): one row of compact filter triggers + reset.
//   - KPI tiles: four headline numbers (Winrate, Sample, Streak, KDA).
//   - Headline chart: winrate over time, with an Insights column on
//     the right that previews where Phase F's coaching cards land.
//   - Hero rotation + K/D trend (two-up).
//   - Campaign Log (calendar heatmap + sparkline) at its proper
//     dashboard size.
//   - Map × Role + Time-of-day (two-up).
//   - Hero-pool diversity (full-width strip).
//   - Floating drawer trigger → slide-out match list → click a row
//     to open the existing detail panel (chev affordance + emit).

const props = defineProps<{
  // Full record list — the dashboard reads this directly. The
  // drawer surfaces the top-N most recent.
  records: MatchRecord[]
  // Currently-selected match key, if the side panel is open. Lets
  // the drawer row highlight which match the panel is anchored to.
  selectedMatchKey: string
}>()

const emit = defineEmits<{
  // Click a drawer row → open the side panel for that match. Routes
  // through App.vue's selection composable so the existing
  // MatchDetailPanel + lightbox + cheatsheet plumbing all work here
  // unchanged.
  'open-match': [matchKey: string]
}>()

// Drawer is closed by default; the floating FAB toggles it.
const drawerOpen = ref(false)

// Top-N most-recent matches for the drawer preview. Sketch only —
// the real implementation will scope to whatever chart the user
// last clicked.
const drawerMatches = computed(() =>
  [...props.records]
    .sort((a, b) => (b.data?.finished_at ?? '').localeCompare(a.data?.finished_at ?? ''))
    .slice(0, 8),
)

function openMatch(matchKey: string) {
  emit('open-match', matchKey)
}

const kpiTiles = [
  { eyebrow: 'Winrate', value: '58%', delta: '↑ 5% vs prior 30d', tone: 'positive' },
  { eyebrow: 'Matches', value: '142', delta: '28-day window', tone: 'neutral' },
  { eyebrow: 'Streak',  value: 'W4',  delta: 'peak 7 this scope', tone: 'positive' },
  { eyebrow: 'Avg K/D', value: '2.4', delta: '→ flat',           tone: 'neutral' },
] as const

const insightCards = [
  {
    severity: 'concern',
    title: 'Lúcio WR drift',
    narrative: 'Down 65% → 48% over the last 30 days. Worst on Volskaya (1W / 5L).',
    sampleSize: 22,
  },
  {
    severity: 'concern',
    title: 'Post-23:00 tilt',
    narrative: 'WR is 41% vs 58% daytime baseline (n=18).',
    sampleSize: 18,
  },
  {
    severity: 'positive',
    title: 'Tank off-role surprise',
    narrative: '64% WR on tank vs 51% on main role. Worth more queue time.',
    sampleSize: 11,
  },
] as const
</script>

<template>
  <section class="dashboard-sketch" aria-label="Matches dashboard sketch">
    <!-- ─── Scope bar ────────────────────────────────────────── -->
    <header class="scope-bar">
      <span class="scope-eyebrow">Scope</span>
      <div class="scope-controls">
        <button class="scope-chip active" type="button">
          <span class="chip-eyebrow">Range</span>
          <span class="chip-value">Last 6 months</span>
        </button>
        <button class="scope-chip" type="button">
          <span class="chip-eyebrow">Hero</span>
          <span class="chip-value">All heroes <span class="chip-meta">·</span> <span class="chip-meta">29</span></span>
        </button>
        <button class="scope-chip" type="button">
          <span class="chip-eyebrow">Map</span>
          <span class="chip-value">All maps <span class="chip-meta">·</span> <span class="chip-meta">24</span></span>
        </button>
        <button class="scope-chip" type="button">
          <span class="chip-eyebrow">Role</span>
          <span class="chip-value">All roles</span>
        </button>
        <button class="scope-chip" type="button">
          <span class="chip-eyebrow">Result</span>
          <span class="chip-value">All</span>
        </button>
      </div>
      <button class="scope-reset" type="button" title="Reset scope">
        × Reset
      </button>
    </header>

    <!-- ─── KPI tiles ────────────────────────────────────────── -->
    <ul class="kpi-grid">
      <li
        v-for="t in kpiTiles"
        :key="t.eyebrow"
        class="kpi-tile"
        :class="`tone-${t.tone}`"
      >
        <span class="kpi-eyebrow">{{ t.eyebrow }}</span>
        <span class="kpi-value">{{ t.value }}</span>
        <span class="kpi-delta">{{ t.delta }}</span>
      </li>
    </ul>

    <!-- ─── Headline chart + Insights column ─────────────────── -->
    <div class="dashboard-row split-headline">
      <article class="panel chart-panel">
        <header class="panel-head">
          <span class="panel-eyebrow">Headline</span>
          <h3 class="panel-title">
            Winrate over time
          </h3>
          <div class="panel-actions">
            <button class="panel-btn">
              Daily
            </button>
            <button class="panel-btn active">
              Weekly
            </button>
            <button class="panel-btn">
              Monthly
            </button>
          </div>
        </header>
        <svg viewBox="0 0 520 160" class="placeholder-svg" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="wrt-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.42" />
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1="120" x2="520" y2="120" stroke="var(--text-faint)" stroke-width="0.4" stroke-dasharray="3 4" />
          <line x1="0" y1="80" x2="520" y2="80" stroke="var(--text-faint)" stroke-width="0.3" stroke-dasharray="3 4" />
          <line x1="0" y1="40" x2="520" y2="40" stroke="var(--text-faint)" stroke-width="0.3" stroke-dasharray="3 4" />
          <path d="M 0 90 L 40 78 L 80 96 L 120 70 L 160 82 L 200 60 L 240 72 L 280 55 L 320 70 L 360 48 L 400 56 L 440 38 L 480 50 L 520 30" fill="none" stroke="var(--accent)" stroke-width="1.8" />
          <path d="M 0 90 L 40 78 L 80 96 L 120 70 L 160 82 L 200 60 L 240 72 L 280 55 L 320 70 L 360 48 L 400 56 L 440 38 L 480 50 L 520 30 L 520 160 L 0 160 Z" fill="url(#wrt-fill)" />
          <g class="sketch-dots">
            <circle cx="120" cy="70" r="2.5" fill="var(--accent)" />
            <circle cx="280" cy="55" r="2.5" fill="var(--accent)" />
            <circle cx="440" cy="38" r="2.5" fill="var(--accent)" />
          </g>
        </svg>
        <footer class="panel-foot">
          <span class="foot-meta">14 weeks · 142 matches</span>
          <button class="ghost-link">
            View matches behind this chart →
          </button>
        </footer>
      </article>

      <aside class="insights-column" aria-label="Coaching insights (Phase F preview)">
        <header class="insights-head">
          <span class="insights-eyebrow">Insights · F preview</span>
          <span class="insights-meta">{{ insightCards.length }} flagged</span>
        </header>
        <ul class="insights-list">
          <li
            v-for="c in insightCards"
            :key="c.title"
            class="insight-card"
            :class="`severity-${c.severity}`"
          >
            <span class="severity-stripe" aria-hidden="true" />
            <div class="insight-body">
              <h4 class="insight-title">
                {{ c.title }}
              </h4>
              <p class="insight-narrative">
                {{ c.narrative }}
              </p>
              <div class="insight-actions">
                <span class="insight-sample">n = {{ c.sampleSize }}</span>
                <button class="insight-link">
                  View chart →
                </button>
                <button class="insight-link secondary">
                  View matches
                </button>
              </div>
            </div>
          </li>
        </ul>
      </aside>
    </div>

    <!-- ─── Hero rotation + K/D trend ────────────────────────── -->
    <div class="dashboard-row two-up">
      <article class="panel chart-panel">
        <header class="panel-head">
          <span class="panel-eyebrow">Composition</span>
          <h3 class="panel-title">
            Hero rotation
          </h3>
        </header>
        <svg viewBox="0 0 520 140" class="placeholder-svg" preserveAspectRatio="none" aria-hidden="true">
          <g fill="var(--accent)" opacity="0.85">
            <path d="M 0 100 L 50 92 L 100 95 L 150 88 L 200 80 L 250 85 L 300 72 L 350 78 L 400 70 L 450 75 L 500 68 L 520 70 L 520 140 L 0 140 Z" />
          </g>
          <g fill="var(--win)" opacity="0.55">
            <path d="M 0 60 L 50 55 L 100 62 L 150 50 L 200 48 L 250 52 L 300 40 L 350 44 L 400 38 L 450 42 L 500 36 L 520 38 L 520 100 L 500 100 L 450 95 L 400 100 L 350 98 L 300 100 L 250 105 L 200 100 L 150 108 L 100 100 L 50 105 L 0 95 Z" />
          </g>
          <g fill="var(--loss)" opacity="0.45">
            <path d="M 0 20 L 50 25 L 100 18 L 150 22 L 200 28 L 250 22 L 300 18 L 350 22 L 400 18 L 450 20 L 500 22 L 520 18 L 520 60 L 500 55 L 450 55 L 400 58 L 350 50 L 300 60 L 250 52 L 200 58 L 150 50 L 100 62 L 50 55 L 0 60 Z" />
          </g>
        </svg>
        <footer class="panel-foot">
          <span class="foot-legend">
            <span><span class="legend-dot" style="background:var(--accent)" /> Lúcio</span>
            <span><span class="legend-dot" style="background:var(--win)" /> Kiriko</span>
            <span><span class="legend-dot" style="background:var(--loss)" /> Mercy</span>
          </span>
        </footer>
      </article>

      <article class="panel chart-panel">
        <header class="panel-head">
          <span class="panel-eyebrow">Output</span>
          <h3 class="panel-title">
            K/D trend
          </h3>
        </header>
        <svg viewBox="0 0 520 140" class="placeholder-svg" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="70" x2="520" y2="70" stroke="var(--text-faint)" stroke-width="0.4" stroke-dasharray="3 4" />
          <path d="M 0 80 L 40 70 L 80 86 L 120 60 L 160 72 L 200 52 L 240 64 L 280 45 L 320 60 L 360 40 L 400 48 L 440 32 L 480 42 L 520 28" fill="none" stroke="var(--win)" stroke-width="1.8" />
          <g fill="var(--win)">
            <circle cx="40" cy="70" r="2.2" />
            <circle cx="200" cy="52" r="2.2" />
            <circle cx="360" cy="40" r="2.2" />
            <circle cx="520" cy="28" r="2.2" />
          </g>
        </svg>
        <footer class="panel-foot">
          <span class="foot-meta">14-week trailing trend</span>
        </footer>
      </article>
    </div>

    <!-- ─── Campaign Log slot (existing widget keeps its place) ─ -->
    <article class="panel campaign-slot">
      <header class="panel-head">
        <span class="panel-eyebrow">Calendar</span>
        <h3 class="panel-title">
          Campaign log
        </h3>
        <span class="panel-meta">heatmap + brushable sparkline · 6M default</span>
      </header>
      <div class="campaign-placeholder">
        <div class="campaign-heatmap-stub">
          <div class="stub-row">
            <span v-for="i in 26" :key="`r0-${i}`" class="stub-cell" :style="{ background: `color-mix(in srgb, var(--win) ${(i * 4) % 100}%, var(--loss))`, opacity: 0.85 }" />
          </div>
          <div class="stub-row">
            <span v-for="i in 26" :key="`r1-${i}`" class="stub-cell" :style="{ background: `color-mix(in srgb, var(--win) ${(i * 7) % 100}%, var(--loss))`, opacity: 0.75 }" />
          </div>
          <div class="stub-row">
            <span v-for="i in 26" :key="`r2-${i}`" class="stub-cell stub-empty" />
          </div>
          <div class="stub-row">
            <span v-for="i in 26" :key="`r3-${i}`" class="stub-cell" :style="{ background: `color-mix(in srgb, var(--win) ${(i * 11) % 100}%, var(--loss))`, opacity: 0.6 }" />
          </div>
          <div class="stub-row">
            <span v-for="i in 26" :key="`r4-${i}`" class="stub-cell stub-empty" />
          </div>
          <div class="stub-row">
            <span v-for="i in 26" :key="`r5-${i}`" class="stub-cell" :style="{ background: `color-mix(in srgb, var(--win) ${(i * 13) % 100}%, var(--loss))`, opacity: 0.7 }" />
          </div>
          <div class="stub-row">
            <span v-for="i in 26" :key="`r6-${i}`" class="stub-cell" :style="{ background: `color-mix(in srgb, var(--win) ${(i * 17) % 100}%, var(--loss))`, opacity: 0.4 }" />
          </div>
        </div>
        <svg viewBox="0 0 420 96" class="campaign-sparkline-stub" preserveAspectRatio="none" aria-hidden="true">
          <g fill="var(--accent)">
            <rect v-for="i in 91" :key="`spk-${i}`" :x="i * 4.4" :y="40 + ((i * 17) % 32)" width="3" :height="50 - ((i * 17) % 32)" :opacity="0.4 + ((i * 7) % 60) / 100" />
          </g>
        </svg>
      </div>
    </article>

    <!-- ─── Map × Role + Time of day ─────────────────────────── -->
    <div class="dashboard-row two-up">
      <article class="panel chart-panel">
        <header class="panel-head">
          <span class="panel-eyebrow">Geography</span>
          <h3 class="panel-title">
            Map × role performance
          </h3>
        </header>
        <div class="map-role-stub">
          <div v-for="r in 3" :key="`mr-${r}`" class="map-role-row">
            <span class="map-role-label">{{ ['Support', 'Tank', 'DPS'][r - 1] }}</span>
            <span
              v-for="c in 12"
              :key="`mr-${r}-${c}`"
              class="map-role-cell"
              :style="{ background: `color-mix(in srgb, var(--win) ${(c * r * 9) % 100}%, var(--loss))`, opacity: 0.4 + ((c * r) % 6) / 10 }"
            />
          </div>
          <div class="map-role-axis">
            <span v-for="m in 12" :key="`mlx-${m}`">{{ ['Lijiang','Rialto','Junkertown','Numbani','Oasis','Hanaoka','Aatlis','Esperança','Hollywood','Eichenwalde','Push','Hybrid'][m - 1] }}</span>
          </div>
        </div>
      </article>

      <article class="panel chart-panel">
        <header class="panel-head">
          <span class="panel-eyebrow">Cadence</span>
          <h3 class="panel-title">
            Time of day
          </h3>
        </header>
        <svg viewBox="0 0 520 140" class="placeholder-svg" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="70" x2="520" y2="70" stroke="var(--text-faint)" stroke-width="0.4" stroke-dasharray="3 4" />
          <g fill="var(--accent)">
            <rect v-for="i in 24" :key="`tod-${i}`" :x="i * 21" :y="100 - (Math.abs(Math.sin(i / 24 * Math.PI * 2) * 60))" width="14" :height="Math.abs(Math.sin(i / 24 * Math.PI * 2) * 60)" :opacity="0.4 + ((i * 11) % 50) / 100" />
          </g>
        </svg>
        <footer class="panel-foot">
          <span class="foot-meta">0 → 23 hour bucket · WR-coloured</span>
        </footer>
      </article>
    </div>

    <!-- ─── Hero pool diversity ──────────────────────────────── -->
    <article class="panel chart-panel">
      <header class="panel-head">
        <span class="panel-eyebrow">Pool</span>
        <h3 class="panel-title">
          Hero diversity
        </h3>
        <span class="panel-meta">% playtime · top-8 displayed</span>
      </header>
      <ul class="hero-pool-bars">
        <li v-for="(h, i) in ['Lúcio','Kiriko','Mercy','Juno','Ana','Brigitte','Illari','Moira']" :key="h">
          <span class="hero-pool-name">{{ h }}</span>
          <div class="hero-pool-bar">
            <span class="hero-pool-fill" :style="{ width: (52 - i * 6) + '%' }" />
          </div>
          <span class="hero-pool-pct">{{ 52 - i * 6 }}%</span>
        </li>
      </ul>
    </article>

    <!-- ─── Drawer trigger ───────────────────────────────────── -->
    <button
      class="match-drawer-fab"
      type="button"
      :aria-label="`${drawerOpen ? 'Close' : 'Open'} match list drawer`"
      :aria-expanded="drawerOpen"
      @click="drawerOpen = !drawerOpen"
    >
      <span class="fab-eyebrow">Drill into</span>
      <span class="fab-label">{{ records.length }} matches {{ drawerOpen ? '↓' : '→' }}</span>
    </button>

    <!-- ─── Match drawer ─────────────────────────────────────── -->
    <transition name="drawer">
      <aside
        v-if="drawerOpen"
        class="match-drawer"
        role="region"
        aria-label="Match drill-down drawer"
      >
        <header class="drawer-head">
          <span class="drawer-eyebrow">Match drill-down</span>
          <span class="drawer-meta">Top {{ drawerMatches.length }} most-recent · click a row to open the side panel</span>
          <button class="drawer-close" type="button" aria-label="Close drawer" @click="drawerOpen = false">
            ×
          </button>
        </header>
        <ul v-if="drawerMatches.length" class="drawer-list">
          <li
            v-for="rec in drawerMatches"
            :key="rec.match_key"
            class="drawer-row"
            :class="{ selected: rec.match_key === selectedMatchKey, [`result-${rec.data?.result || 'unknown'}`]: true }"
            @click="openMatch(rec.match_key)"
          >
            <span class="drawer-result-strip" aria-hidden="true" />
            <span class="drawer-map">{{ rec.data?.map || 'unknown' }}</span>
            <span class="drawer-hero">{{ rec.data?.hero || '—' }}</span>
            <span class="drawer-stats">
              {{ rec.data?.eliminations ?? '—' }} / {{ rec.data?.assists ?? '—' }} / {{ rec.data?.deaths ?? '—' }}
            </span>
            <span class="drawer-result">{{ rec.data?.result || '—' }}</span>
            <span class="drawer-chev" aria-hidden="true">›</span>
          </li>
        </ul>
        <p v-else class="drawer-empty">
          No matches in scope — parse some screenshots first.
        </p>
      </aside>
    </transition>
  </section>
</template>

<style scoped>
.dashboard-sketch {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.55rem 0 6rem; /* tail-pad for the floating drawer fab */
  position: relative;
}

/* ─── Scope bar ────────────────────────────────────────────── */

.scope-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem 1.1rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, transparent) 0%, transparent 50%),
    var(--surface);
  position: sticky;
  top: 0;
  z-index: 4;
}

.scope-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.scope-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.scope-chip {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.32rem 0.55rem;
  display: inline-flex;
  flex-direction: column;
  gap: 0.05rem;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
  text-align: left;
}

.scope-chip:hover {
  border-color: var(--accent-soft);
}

.scope-chip.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 9%, var(--surface-2));
}

.chip-eyebrow {
  font-family: var(--mono);
  font-size: 0.52rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.chip-value {
  font-family: var(--mono);
  font-size: 0.74rem;
  font-weight: 600;
  color: var(--text);
}

.chip-meta {
  color: var(--text-faint);
  font-weight: 400;
  margin-left: 0.18rem;
}

.scope-reset {
  margin-left: auto;
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.32rem 0.6rem;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  font-weight: 600;
}

.scope-reset:hover {
  color: var(--loss);
  border-color: var(--loss);
}

/* ─── KPI tiles ────────────────────────────────────────────── */

.kpi-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.6rem;
}

.kpi-tile {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.85rem 1.05rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background:
    linear-gradient(150deg, color-mix(in srgb, var(--accent) 4%, transparent), transparent 60%),
    var(--surface);
  position: relative;
}

.kpi-tile::before {
  content: '';
  position: absolute;
  left: 0; top: 0;
  width: 3px; height: 100%;
  background: var(--text-faint);
  opacity: 0.7;
}
.kpi-tile.tone-positive::before { background: var(--win); }
.kpi-tile.tone-neutral::before  { background: var(--text-faint); }
.kpi-tile.tone-concern::before  { background: var(--loss); }

.kpi-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.kpi-value {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 2.1rem;
  letter-spacing: 0.01em;
  color: var(--text);
  line-height: 1;
}

.kpi-delta {
  font-family: var(--mono);
  font-size: 0.66rem;
  color: var(--text-dim);
}

/* ─── Panel base ───────────────────────────────────────────── */

.panel {
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface);
  padding: 0.65rem 1rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.panel-head {
  display: flex;
  align-items: baseline;
  gap: 0.85rem;
}

.panel-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.panel-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1.15rem;
  letter-spacing: 0.01em;
  color: var(--text);
  margin: 0;
  text-transform: uppercase;
}

.panel-meta,
.foot-meta {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}

.panel-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
}

.panel-btn {
  appearance: none;
  background: transparent;
  border: 0;
  border-right: 1px solid var(--border);
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  font-weight: 600;
  text-transform: uppercase;
  padding: 0.22rem 0.5rem;
  cursor: pointer;
}
.panel-btn:last-child { border-right: 0; }

.panel-btn.active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--accent);
}

.panel-foot {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  border-top: 1px dashed color-mix(in srgb, var(--border) 60%, transparent);
  padding-top: 0.4rem;
}

.ghost-link {
  appearance: none;
  background: transparent;
  border: 0;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.04em;
  color: var(--accent);
  cursor: pointer;
  text-transform: uppercase;
  margin-left: auto;
}

.ghost-link:hover { color: var(--accent-bright, var(--accent)); }

.placeholder-svg {
  width: 100%;
  height: clamp(140px, 22vh, 220px);
  display: block;
}

.foot-legend {
  display: inline-flex;
  align-items: center;
  gap: 0.85rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  text-transform: uppercase;
}

.foot-legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.legend-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 2px;
}

/* ─── Rows ─────────────────────────────────────────────────── */

.dashboard-row {
  display: grid;
  gap: 0.6rem;
}

.dashboard-row.two-up {
  grid-template-columns: 1fr 1fr;
}

.dashboard-row.split-headline {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  align-items: stretch;
}

@media (width <= 1100px) {
  .dashboard-row.two-up,
  .dashboard-row.split-headline {
    grid-template-columns: 1fr;
  }
}

/* ─── Insights column ──────────────────────────────────────── */

.insights-column {
  border: 1px solid var(--border);
  border-radius: 2px;
  background:
    repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 4%, transparent) 0,
      color-mix(in srgb, var(--accent) 4%, transparent) 8px,
      transparent 8px,
      transparent 16px
    ),
    var(--surface);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.65rem 0.85rem 0.9rem;
}

.insights-head {
  display: flex;
  align-items: baseline;
  gap: 0.85rem;
}

.insights-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.insights-meta {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
}

.insights-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.insight-card {
  display: grid;
  grid-template-columns: 4px 1fr;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.severity-stripe {
  width: 4px;
  height: 100%;
  background: var(--text-faint);
}
.severity-concern  .severity-stripe { background: var(--loss); }
.severity-neutral  .severity-stripe { background: var(--text-mute); }
.severity-positive .severity-stripe { background: var(--win); }

.insight-body {
  padding: 0.55rem 0.7rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.insight-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 0.92rem;
  letter-spacing: 0.01em;
  color: var(--text);
  margin: 0;
  text-transform: uppercase;
}

.insight-narrative {
  font-size: 0.78rem;
  color: var(--text-dim);
  margin: 0;
  line-height: 1.35;
}

.insight-actions {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-top: 0.2rem;
}

.insight-sample {
  font-family: var(--mono);
  font-size: 0.58rem;
  color: var(--text-faint);
  letter-spacing: 0.04em;
}

.insight-link {
  appearance: none;
  background: transparent;
  border: 0;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  color: var(--accent);
  cursor: pointer;
  text-transform: uppercase;
  padding: 0;
}

.insight-link.secondary {
  color: var(--text-dim);
}

/* ─── Campaign Log slot ────────────────────────────────────── */

.campaign-slot {
  gap: 0.55rem;
}

.campaign-placeholder {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 1.2rem;
  align-items: center;
}

.campaign-heatmap-stub {
  display: grid;
  gap: 2px;
}

.stub-row {
  display: grid;
  grid-template-columns: repeat(26, 14px);
  gap: 2px;
}

.stub-cell {
  width: 14px;
  height: 14px;
  border-radius: 2px;
  border: 0.5px solid color-mix(in srgb, var(--text) 8%, transparent);
}

.stub-cell.stub-empty {
  background: color-mix(in srgb, var(--surface-2) 92%, var(--border));
}

.campaign-sparkline-stub {
  width: 100%;
  height: 90px;
}

@media (width <= 1100px) {
  .campaign-placeholder {
    grid-template-columns: 1fr;
  }
}

/* ─── Map × Role stub ──────────────────────────────────────── */

.map-role-stub {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0.3rem 0;
}

.map-role-row {
  display: grid;
  grid-template-columns: 70px repeat(12, 1fr);
  gap: 4px;
  align-items: center;
}

.map-role-label {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  color: var(--text-faint);
  text-transform: uppercase;
}

.map-role-cell {
  height: 30px;
  border-radius: 2px;
  border: 0.5px solid color-mix(in srgb, var(--text) 8%, transparent);
}

.map-role-axis {
  display: grid;
  grid-template-columns: 70px repeat(12, 1fr);
  gap: 4px;
  margin-top: 0.4rem;
}

.map-role-axis span {
  font-family: var(--mono);
  font-size: 0.5rem;
  letter-spacing: 0.05em;
  color: var(--text-faint);
  text-align: center;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.map-role-axis span:first-child {
  visibility: hidden;
}

/* ─── Hero pool ────────────────────────────────────────────── */

.hero-pool-bars {
  list-style: none;
  margin: 0;
  padding: 0.2rem 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hero-pool-bars li {
  display: grid;
  grid-template-columns: 80px 1fr 40px;
  align-items: center;
  gap: 0.65rem;
}

.hero-pool-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.hero-pool-bar {
  background: var(--surface-2);
  height: 14px;
  border-radius: 2px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.hero-pool-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 50%, var(--win)));
}

.hero-pool-pct {
  font-family: var(--mono);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  text-align: right;
}

/* ─── Floating drawer trigger ──────────────────────────────── */

.match-drawer-fab {
  position: fixed;
  right: 2rem;
  bottom: 2rem;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  padding: 0.6rem 1.1rem;
  border: 1px solid var(--accent);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, transparent), transparent 60%),
    var(--surface);
  border-radius: 2px;
  cursor: pointer;
  box-shadow: 0 18px 40px -16px rgb(0 0 0 / 50%);
  z-index: 6;
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.match-drawer-fab:hover {
  transform: translateY(-2px);
  box-shadow: 0 22px 48px -16px rgb(0 0 0 / 60%);
}

.fab-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}

.fab-label {
  font-family: var(--display);
  font-style: italic;
  font-size: 1rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text);
}

/* ─── Match drill-down drawer ──────────────────────────────── */

.match-drawer {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: min(480px, 100vw);
  background: var(--surface);
  border-left: 1px solid var(--accent);
  box-shadow: -24px 0 60px -16px rgb(0 0 0 / 60%);
  z-index: 7;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drawer-head {
  display: flex;
  align-items: baseline;
  gap: 0.85rem;
  padding: 0.85rem 1rem 0.65rem;
  border-bottom: 1px solid var(--border);
  background:
    repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 4%, transparent) 0,
      color-mix(in srgb, var(--accent) 4%, transparent) 6px,
      transparent 6px,
      transparent 12px
    ),
    var(--surface);
}

.drawer-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.drawer-meta {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}

.drawer-close {
  margin-left: auto;
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  width: 1.6rem;
  height: 1.6rem;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.drawer-close:hover {
  color: var(--loss);
  border-color: var(--loss);
}

.drawer-list {
  list-style: none;
  margin: 0;
  padding: 0.4rem 0;
  overflow-y: auto;
}

.drawer-row {
  display: grid;
  grid-template-columns: 4px 1fr auto auto auto 1.1rem;
  align-items: center;
  gap: 0.7rem;
  padding: 0.45rem 0.85rem 0.5rem;
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  transition: background 140ms ease;
}

.drawer-row:hover {
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}

.drawer-row.selected {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: var(--accent);
}

.drawer-result-strip {
  width: 4px;
  height: 30px;
  background: var(--text-faint);
  border-radius: 2px;
}
.drawer-row.result-victory .drawer-result-strip { background: var(--win); }
.drawer-row.result-defeat  .drawer-result-strip { background: var(--loss); }
.drawer-row.result-draw    .drawer-result-strip { background: var(--draw, var(--text-mute)); }

.drawer-map {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--text);
}

.drawer-hero {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  text-transform: lowercase;
}

.drawer-stats {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.drawer-result {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.drawer-chev {
  font-family: var(--mono);
  font-size: 1rem;
  color: var(--text-faint);
}

.drawer-row:hover .drawer-chev { color: var(--accent); }

.drawer-empty {
  margin: 0;
  padding: 1.2rem 1rem;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.78rem;
  text-align: center;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: transform 220ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
}

@media (prefers-reduced-motion: reduce) {
  .scope-chip,
  .match-drawer-fab,
  .panel,
  .insight-card,
  .drawer-row,
  .drawer-enter-active,
  .drawer-leave-active {
    transition: none;
  }
}
</style>
