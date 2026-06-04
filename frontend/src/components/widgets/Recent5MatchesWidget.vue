<script setup lang="ts">
import { useDossier } from '../../composables/useDossier'
import { useWidgetConfig } from '../../composables/useWidgetConfig'
import { recentMatchesSchema, type RecentMatchesConfig } from '../../dashboard/widgets'

const dossier = useDossier()
const { config } = useWidgetConfig<RecentMatchesConfig>('recent-5-matches', recentMatchesSchema)
const results = dossier.recentResults(() => ({ count: config.value.count }))
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Recent matches</span>
  </header>
  <div v-if="results.length > 0" class="recent-pills" :data-recent-count="results.length">
    <span
      v-for="(r, idx) in results"
      :key="idx"
      class="recent-pill"
      :class="`recent-pill-${r}`"
      :title="r"
    >
      {{ r === 'victory' ? 'W' : r === 'defeat' ? 'L' : 'D' }}
    </span>
  </div>
  <p v-else class="recent-empty">
    No decisive matches yet
  </p>
</template>

<style scoped>
/* Pills sit in a flex row matching the other breakdown rows' inner
   density. Newest-first reads left-to-right; per-result colour comes
   from the existing --win / --loss / --draw palette tokens so the
   widget stays palette-consistent across themes. */
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
  border-radius: 2px;
  border: 1px solid var(--border);
  font-family: var(--mono);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  user-select: none;
}

.recent-pill-victory {
  color: var(--win);
  border-color: var(--win-line, var(--win));
  background: var(--win-soft, color-mix(in srgb, var(--win) 12%, transparent));
}

.recent-pill-defeat {
  color: var(--loss);
  border-color: var(--loss-line, var(--loss));
  background: var(--loss-soft, color-mix(in srgb, var(--loss) 12%, transparent));
}

.recent-pill-draw {
  color: var(--draw, var(--text-dim));
  border-color: var(--draw, var(--text-faint));
  background: color-mix(in srgb, var(--draw, var(--text-faint)) 12%, transparent);
}

.recent-empty {
  margin: 0;
  padding: 0.45rem 0;
  font-size: 0.78rem;
  font-style: italic;
  color: var(--text-faint);
}
</style>
