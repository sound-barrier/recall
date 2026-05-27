<script setup lang="ts">
import { computed } from 'vue'
import type { MatchRecord } from '../api'
import {
  tallyWLD,
  avgGameLengthMinutes,
  formatMinutesAsClock,
  modeOf,
} from '../match-helpers'
import { useOWData } from '../composables/useOWData'

// "Filtered Intel" panel. Renders aggregate stats across the
// currently-filtered match set: win-rate %, W/L/D breakdown, average
// match length, top hero, top map. Sits between the FilterRail and
// the match list so the user always sees "what's true about this
// view" without scrolling. Recomputes reactively on every filter
// change since every input is a computed off the same `records` ref
// that drives the list itself.
//
// Aesthetic — preserves the project's tactical-HUD identity: mono
// eyebrows, Big Noodle for the win-rate numeral (the headline), and
// the existing W/L/D palette tokens (`--win` / `--loss` / `--draw`)
// for the mini-bar breakdown. No new colors.

const ow = useOWData()

const props = defineProps<{
  // Records AFTER all filters are applied — this is what we
  // summarise. The total record count is passed separately so we
  // can render "N of M" instead of just "N".
  filtered: MatchRecord[]
  totalCount: number
  // When true, leaver-tagged matches are excluded from the W/L/D
  // tally. Matches how MatchGroupSection's per-group tally honors
  // the same preference, so the headline number doesn't disagree
  // with the per-group readout further down the page.
  skipAnnotatedFromTally: boolean
}>()

const tally = computed(() => tallyWLD(props.filtered, props.skipAnnotatedFromTally))

const totalCounted = computed(() => tally.value.w + tally.value.l + tally.value.d)

const winRatePct = computed(() => {
  const t = totalCounted.value
  if (t === 0) return null
  return Math.round((tally.value.w / t) * 100)
})

// Three percentage stops drive the headline color so the win-rate
// readout shifts from loss-red (< 40%) through neutral (40–55%) to
// win-green (> 55%). Doesn't redefine a palette — taps existing
// --win / --loss / --text-dim tokens.
const winRateTone = computed<'low' | 'mid' | 'high'>(() => {
  const v = winRatePct.value
  if (v === null) return 'mid'
  if (v < 40)  return 'low'
  if (v > 55)  return 'high'
  return 'mid'
})

// Bar-segment widths — w / l / d as a fraction of the total
// counted matches. Renders as a horizontal stacked bar so the
// W/L/D distribution reads at a glance even before the numbers
// register. Zero-protected so an unfiltered empty set doesn't
// produce NaN%.
const barSegments = computed(() => {
  const t = totalCounted.value
  if (t === 0) return { w: 0, l: 0, d: 0 }
  return {
    w: (tally.value.w / t) * 100,
    l: (tally.value.l / t) * 100,
    d: (tally.value.d / t) * 100,
  }
})

const avgLength = computed(() =>
  formatMinutesAsClock(avgGameLengthMinutes(props.filtered)),
)

// Top-hero across the filtered set. Uses the PRIMARY hero only
// (data.hero) rather than crawling heroes_played[*] — the primary
// is the most-played in that match, so it's the right grain for a
// "what hero do you play" page-level summary. modeOf returns null
// for an empty / hero-less set; we render that as "—".
const topHero = computed(() => modeOf(props.filtered, r => r.data?.hero?.toLowerCase() || null))
const topHeroLabel = computed(() => topHero.value ? ow.heroDisplayName(topHero.value.value) : '—')

const topMap = computed(() => modeOf(props.filtered, r => r.data?.map?.toLowerCase() || null))
const topMapLabel = computed(() => topMap.value ? ow.mapDisplayName(topMap.value.value) : '—')

// "N of M matches" eyebrow text. Avoids "1 matches" with proper
// pluralisation; renders the unfiltered scenario as just "N" to
// keep the line compact when nothing is filtered.
const headlineLabel = computed(() => {
  const n = props.filtered.length
  const m = props.totalCount
  if (n === m) return `${m} ${m === 1 ? 'match' : 'matches'}`
  return `${n} / ${m}`
})
</script>

<template>
  <section class="agg-stats" :class="`tone-${winRateTone}`" aria-label="Aggregate statistics across the filtered match set">
    <header class="agg-stats-head">
      <span class="agg-stats-eyebrow">Filtered Intel</span>
      <span class="agg-stats-headline">{{ headlineLabel }}</span>
    </header>

    <div class="agg-stats-grid">
      <!-- Headline cell — win-rate % in a big display number with the
           W/L/D distribution bar directly under it. Empty filter set
           renders an em-dash instead of "0%" so the panel doesn't
           lie about a denominator that doesn't exist. -->
      <div class="agg-cell agg-cell-headline">
        <span class="agg-headline-label">Win Rate</span>
        <span class="agg-headline-value">
          <template v-if="winRatePct === null">
            —
          </template>
          <template v-else>
            <span class="agg-headline-num">{{ winRatePct }}</span><span class="agg-headline-unit">%</span>
          </template>
        </span>
        <!-- Decorative stacked bar — the W/L/D triple below carries
             the same info to assistive tech, so the bar itself stays
             aria-hidden rather than carrying a (semantically meaningless
             on a div) aria-label. -->
        <div
          v-if="totalCounted > 0"
          class="agg-headline-bar"
          aria-hidden="true"
        >
          <span class="agg-bar-seg agg-bar-w" :style="{ width: barSegments.w + '%' }" />
          <span class="agg-bar-seg agg-bar-l" :style="{ width: barSegments.l + '%' }" />
          <span class="agg-bar-seg agg-bar-d" :style="{ width: barSegments.d + '%' }" />
        </div>
      </div>

      <!-- W/L/D triple — each in its own cell with the matching
           palette token. The numbers are tabular-nums so they line up
           across a stat-grid without jitter. -->
      <div class="agg-cell agg-cell-tally">
        <div class="agg-pair">
          <span class="agg-pair-num agg-pair-w">{{ tally.w }}</span>
          <span class="agg-pair-label">W</span>
        </div>
        <div class="agg-pair">
          <span class="agg-pair-num agg-pair-l">{{ tally.l }}</span>
          <span class="agg-pair-label">L</span>
        </div>
        <div class="agg-pair">
          <span class="agg-pair-num agg-pair-d">{{ tally.d }}</span>
          <span class="agg-pair-label">D</span>
        </div>
      </div>

      <div class="agg-cell agg-cell-detail">
        <div class="agg-detail-row">
          <span class="agg-detail-label">Avg Length</span>
          <span class="agg-detail-value mono">{{ avgLength }}</span>
        </div>
        <div class="agg-detail-row">
          <span class="agg-detail-label">Top Hero</span>
          <span class="agg-detail-value">
            <span class="agg-detail-primary">{{ topHeroLabel }}</span>
            <span v-if="topHero" class="agg-detail-count">×{{ topHero.count }}</span>
          </span>
        </div>
        <div class="agg-detail-row">
          <span class="agg-detail-label">Top Map</span>
          <span class="agg-detail-value">
            <span class="agg-detail-primary">{{ topMapLabel }}</span>
            <span v-if="topMap" class="agg-detail-count">×{{ topMap.count }}</span>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* "Filtered Intel" aggregate panel. Lives above the match list and
   reads as a HUD instrument cluster — bold headline number on the
   left, structured detail on the right, the whole panel wrapped in
   a thin accent border that brightens when the filter narrows the
   result set hard (low / mid / high tone). */

.agg-stats {
  --tone: var(--border);

  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 1.1rem;
  padding: 0.9rem 1rem 1rem;
  background: var(--surface);
  border: 1px solid var(--tone);
  border-left-width: 3px;
  border-radius: 2px;

  /* Subtle scanner-line shimmer at the top edge of the panel — same
     "instrument-readout" gesture the FilterRail::after uses, just
     smaller. CSS-only, no JS. */
  overflow: hidden;
  animation: agg-stats-in 240ms ease both;
}

.agg-stats::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent 0%, var(--tone) 30%, var(--tone) 70%, transparent 100%);
  opacity: 0.6;
}

.agg-stats.tone-low  { --tone: var(--loss); }
.agg-stats.tone-mid  { --tone: var(--border-strong); }
.agg-stats.tone-high { --tone: var(--win); }

@keyframes agg-stats-in {
  from { opacity: 0; transform: translateY(-3px); }
  to   { opacity: 1; transform: translateY(0); }
}

.agg-stats-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.8rem;
}

.agg-stats-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.agg-stats-headline {
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.agg-stats-grid {
  display: grid;
  grid-template-columns: minmax(180px, 1.2fr) auto 1fr;
  gap: 1.6rem;
  align-items: center;
}

/* Headline cell: big win-rate numeral + W/L/D bar */
.agg-cell-headline {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}

.agg-headline-label {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.agg-headline-value {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  line-height: 0.9;
  color: var(--text);
  display: inline-flex;
  align-items: baseline;
  gap: 0.05em;
}

.agg-stats.tone-low  .agg-headline-value { color: var(--loss); }
.agg-stats.tone-high .agg-headline-value { color: var(--win); }

.agg-headline-num {
  font-size: 3rem;
  letter-spacing: -0.02em;
}

.agg-headline-unit {
  font-size: 1.4rem;
  color: var(--text-faint);
  letter-spacing: 0;
}

.agg-headline-bar {
  position: relative;
  display: flex;
  width: 100%;
  height: 4px;
  background: var(--surface-2);
  border-radius: 1px;
  overflow: hidden;
}

.agg-bar-seg {
  height: 100%;
  display: block;
  transition: width 220ms ease;
}

.agg-bar-w { background: var(--win); }
.agg-bar-l { background: var(--loss); }
.agg-bar-d { background: var(--draw); }

/* W/L/D triple — three columns of (number, eyebrow). Numbers carry
   the win/loss/draw palette so the column reads at a glance. */
.agg-cell-tally {
  display: grid;
  grid-template-columns: repeat(3, auto);
  gap: 1.2rem;
}

.agg-pair {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.18rem;
}

.agg-pair-num {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 1.6rem;
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
}

.agg-pair-label {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.agg-pair-w { color: var(--win); }
.agg-pair-l { color: var(--loss); }
.agg-pair-d { color: var(--draw); }

/* Detail column — three label-value rows for avg length / top hero
   / top map. Density set so the column doesn't overflow the
   panel height when the headline numerals are visible. */
.agg-cell-detail {
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
  font-size: 0.78rem;
  min-width: 0;
}

.agg-detail-row {
  display: grid;
  grid-template-columns: 6em 1fr;
  gap: 0.6rem;
  align-items: baseline;
}

.agg-detail-label {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.agg-detail-value {
  color: var(--text);
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  min-width: 0;
}

.agg-detail-primary {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 0.95rem;
  text-transform: uppercase;
  letter-spacing: 0.01em;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.agg-detail-count {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.agg-detail-value .mono {
  font-family: var(--mono);
  font-size: 0.88rem;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
}

/* Narrow viewport — collapse the 3-column grid into a single
   stacked column so the headline reads first, then the W/L/D
   triple, then the detail rows. Sub-680 the agg-stats-head also
   stacks its label above the count instead of side-by-side. */
@media (width <= 880px) {
  .agg-stats-grid {
    grid-template-columns: 1fr;
    gap: 0.9rem;
  }

  .agg-cell-tally {
    justify-content: start;
    gap: 1.6rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agg-stats { animation: none; }
  .agg-bar-seg { transition: none; }
}

[data-theme="light"] .agg-stats {
  background: var(--surface-2);
}
[data-theme="light"] .agg-headline-value { color: var(--text); }
[data-theme="light"] .agg-stats.tone-low  .agg-headline-value { color: var(--loss); }
[data-theme="light"] .agg-stats.tone-high .agg-headline-value { color: var(--win); }
</style>
