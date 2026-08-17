<script setup lang="ts">
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { recentMatchesSchema, type RecentMatchesConfig } from '@/dashboard/widgets'
import { resultJudgment } from '@/match/trends/match-heatmap-helpers'

const dossier = useDossier()
const { config } = useWidgetConfig<RecentMatchesConfig>('recent-5-matches', recentMatchesSchema)
const results = dossier.recentResults(() => ({ count: config.value.count }))

type PillResult = 'victory' | 'defeat' | 'draw'

// The shared result tint (styles/verdict-tint.css) — the same three classes
// the Current-streak KPI wears. The pill keeps its own class for the plate
// (border + soft fill) and geometry only.
const RESULT_TINT: Record<PillResult, string> = {
  victory: 'tint-win',
  defeat:  'tint-loss',
  draw:    'tint-draw',
}
const RESULT_LETTER: Record<PillResult, string> = { victory: 'W', defeat: 'L', draw: 'D' }
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Recent matches</span>
  </header>
  <div v-if="results.length > 0" class="recent-pills" :data-recent-count="results.length">
    <span
      v-for="(r, idx) in results"
      :key="idx"
      class="recent-pill"
      :class="[`recent-pill-${r}`, RESULT_TINT[r]]"
      role="img"
      :aria-label="resultJudgment(r)"
      :title="r"
    >
      {{ RESULT_LETTER[r] }}
    </span>
  </div>
  <p v-else class="recent-empty">
    No decisive matches yet
  </p>
</template>

<style scoped>
/* Pills sit in a flex row matching the other breakdown rows' inner
   density. Newest-first reads left-to-right; the glyph color comes from
   the shared .tint-* classes, these rules own only the plate. */
.recent-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.1rem 0;
}

.recent-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.7rem;
  height: 1.7rem;
  padding: 0 0.45rem;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  font-family: var(--mono);
  font-size: var(--type-md);
  font-weight: 700;
  letter-spacing: 0.05em;
  user-select: none;
}

/* One plate recipe, three results. The draw pill used to reach for a bare
   --draw border and a hand-rolled 12% wash (with a --text-dim fallback for
   a token that has always existed), which made it the odd one out; it now
   wears the same -line / -soft pair as the other two. */
.recent-pill-victory {
  border-color: var(--win-line);
  background: var(--win-soft);
}

.recent-pill-defeat {
  border-color: var(--loss-line);
  background: var(--loss-soft);
}

.recent-pill-draw {
  border-color: var(--draw-line);
  background: var(--draw-soft);
}

.recent-empty {
  margin: 0;
  padding: 0.45rem 0;
  font-size: var(--type-md);
  font-style: italic;
  color: var(--text-faint);
}
</style>
