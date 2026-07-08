<script setup lang="ts">
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { heroDisciplineSchema, type HeroDisciplineConfig } from '@/dashboard/widgets'

// Hero pool — the heroes with enough meaningful decisive games to count as
// the player's identity, the in-pool vs out-of-pool split, and what each
// reach outside the pool actually cost ("ana · 1W–6L").

const dossier = useDossier()
const { config } = useWidgetConfig<HeroDisciplineConfig>('hero-pool', heroDisciplineSchema)

const analysis = dossier.heroPool(() => ({ thresholdPct: config.value.thresholdPct }))

function record(row: { wins: number; losses: number }): string {
  return `${row.wins}W–${row.losses}L`
}
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Hero pool</span>
  </header>
  <!-- .breakdown-empty, not .bd-placeholder: the latter is the INVISIBLE
       height-filler class the top-N widgets use (visibility: hidden). -->
  <p v-if="analysis.pool.length === 0" class="breakdown-empty">
    A hero joins your pool after 5+ meaningful decisive games
    (10% of your games once your history grows).
  </p>
  <ul v-else>
    <li v-for="hero in analysis.pool" :key="hero.key" data-pool-hero>
      <span class="bd-name">{{ hero.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: hero.winrate + '%' }" />
        <span class="bd-time">{{ hero.total }}x</span>
      </span>
      <span class="bd-stats">{{ hero.winrate }}%</span>
    </li>
    <li data-pool-split="pure">
      <span class="bd-name">In pool</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: analysis.split.pure.winrate + '%' }" />
        <span class="bd-time">{{ analysis.split.pure.games }}x</span>
      </span>
      <span class="bd-stats">{{ analysis.split.pure.winrate }}%</span>
    </li>
    <li data-pool-split="out">
      <span class="bd-name">Out of pool</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: analysis.split.out.winrate + '%' }" />
        <span class="bd-time">{{ analysis.split.out.games }}x</span>
      </span>
      <span class="bd-stats">{{ analysis.split.out.winrate }}%</span>
    </li>
    <li v-for="hero in analysis.outHeroes" :key="hero.key" data-pool-out-hero>
      <span class="bd-name">↳ {{ hero.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: hero.winrate + '%' }" />
        <span class="bd-time">{{ record(hero) }}</span>
      </span>
      <span class="bd-stats">{{ hero.winrate }}%</span>
      <span
        v-if="hero.lowSample"
        data-low-sample
        class="bd-low-n"
        :title="`Only ${hero.total} matches on this hero — treat this rate as noisy`"
      >n&lt;5</span>
    </li>
  </ul>
</template>

<style scoped>
.breakdown-empty {
  margin: 0;
  padding: 0.45rem 0;
  font-size: 0.78rem;
  font-style: italic;
  color: var(--text-faint);
}
</style>
