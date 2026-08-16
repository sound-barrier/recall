<script setup lang="ts">
import type { HeroPlay } from '@/api-client'
import { DEFAULT_COACH_LABELS, type CoachLabels } from '@/components/coach/coach-room-props'

// How the match was split across heroes. The share rides on the FILL
// element as aria-valuenow (a progressbar makes its children
// presentational, and the track carries the visible play time); the
// name is identity-only, because the row already prints the number in
// text beside the bar. A hero with no recorded share stays
// indeterminate rather than claiming 0%.

withDefaults(defineProps<{
  heroes: HeroPlay[]
  labels?: CoachLabels
}>(), { labels: () => DEFAULT_COACH_LABELS })
</script>

<template>
  <ul v-if="heroes.length" class="hero-split" aria-label="Heroes played">
    <li v-for="play in heroes" :key="play.hero" class="hs-row">
      <span class="hs-name">{{ labels.hero(play.hero) }}</span>
      <span class="hs-bar">
        <span
          class="hs-fill"
          role="progressbar"
          :aria-label="`${play.hero} share`"
          :aria-valuenow="play.percent_played"
          aria-valuemin="0"
          aria-valuemax="100"
          :style="{ width: `${play.percent_played ?? 0}%` }"
        />
        <span v-if="play.play_time" class="hs-time">{{ play.play_time }}</span>
      </span>
      <span class="hs-pct">{{ play.percent_played == null ? '—' : `${play.percent_played}%` }}</span>
    </li>
  </ul>
</template>

<style scoped>
.hero-split {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hs-row {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr) 3rem;
  gap: 0.6rem;
  align-items: center;
}

.hs-name {
  font-size: var(--type-md);
  color: var(--text-dim);
  text-transform: capitalize;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hs-bar {
  position: relative;
  display: flex;
  align-items: center;
  height: 1.1rem;
  padding: 0 0.4rem;
  background: var(--surface-3);
  border-radius: var(--radius);
  overflow: hidden;
}

.hs-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent-soft);
  border-right: 1px solid var(--accent);
}

.hs-time {
  position: relative;
  font-family: var(--mono);
  font-size: var(--type-3xs);
  color: var(--text-dim);
  font-feature-settings: "tnum";
}

.hs-pct {
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text);
  text-align: right;
  font-feature-settings: "tnum";
}
</style>
